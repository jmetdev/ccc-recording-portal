"""Media storage abstraction.

Keys are tenant-prefixed relative paths (``tenants/<id>/calls/<id>/<leg>.<ext>``
for connector uploads; legacy on-host recordings keep their original relative
paths). The local backend maps keys under ``recordings_dir``; the S3 backend
serves playback via presigned URLs so audio bytes never proxy through the API.
"""

import os
from abc import ABC, abstractmethod
from collections.abc import Iterator
from functools import lru_cache
from typing import BinaryIO

from app.core.config import settings

CHUNK = 64 * 1024


class Storage(ABC):
    @abstractmethod
    def exists(self, key: str) -> bool: ...

    @abstractmethod
    def size(self, key: str) -> int: ...

    @abstractmethod
    def iter_range(self, key: str, start: int, length: int) -> Iterator[bytes]: ...

    @abstractmethod
    def save_stream(self, key: str, fileobj: BinaryIO) -> int:
        """Store fileobj under key, returning bytes written."""

    @abstractmethod
    def delete(self, key: str) -> None: ...

    def local_path(self, key: str) -> str | None:
        """Filesystem path for the key, if the backend has one."""
        return None

    def presigned_url(self, key: str, mime: str | None = None) -> str | None:
        """Direct-download URL for the key, if the backend supports it."""
        return None


def _safe_key(key: str) -> str:
    key = key.lstrip("/")
    if ".." in key.split("/"):
        raise ValueError(f"Unsafe storage key: {key}")
    return key


class LocalStorage(Storage):
    def __init__(self, root: str):
        self.root = root

    def _full(self, key: str) -> str:
        return os.path.join(self.root, _safe_key(key))

    def exists(self, key: str) -> bool:
        return os.path.isfile(self._full(key))

    def size(self, key: str) -> int:
        return os.path.getsize(self._full(key))

    def iter_range(self, key: str, start: int, length: int) -> Iterator[bytes]:
        full = self._full(key)

        def gen():
            with open(full, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(CHUNK, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        return gen()

    def save_stream(self, key: str, fileobj: BinaryIO) -> int:
        full = self._full(key)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        written = 0
        with open(full, "wb") as out:
            while True:
                chunk = fileobj.read(CHUNK)
                if not chunk:
                    break
                out.write(chunk)
                written += len(chunk)
        return written

    def delete(self, key: str) -> None:
        full = self._full(key)
        if os.path.isfile(full):
            os.remove(full)

    def local_path(self, key: str) -> str | None:
        full = self._full(key)
        return full if os.path.isfile(full) else None


class S3Storage(Storage):
    def __init__(self, bucket: str, prefix: str = "", region: str = "", endpoint_url: str = ""):
        import boto3  # deferred so local deployments don't need it installed

        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.client = boto3.client(
            "s3",
            region_name=region or None,
            endpoint_url=endpoint_url or None,
        )

    def _key(self, key: str) -> str:
        key = _safe_key(key)
        return f"{self.prefix}/{key}" if self.prefix else key

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=self._key(key))
            return True
        except self.client.exceptions.ClientError:
            return False

    def size(self, key: str) -> int:
        head = self.client.head_object(Bucket=self.bucket, Key=self._key(key))
        return head["ContentLength"]

    def iter_range(self, key: str, start: int, length: int) -> Iterator[bytes]:
        end = start + length - 1
        obj = self.client.get_object(
            Bucket=self.bucket, Key=self._key(key), Range=f"bytes={start}-{end}"
        )
        return obj["Body"].iter_chunks(CHUNK)

    def save_stream(self, key: str, fileobj: BinaryIO) -> int:
        s3_key = self._key(key)
        self.client.upload_fileobj(fileobj, self.bucket, s3_key)
        return self.size(key)

    def delete(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=self._key(key))

    def presigned_url(self, key: str, mime: str | None = None) -> str | None:
        params = {"Bucket": self.bucket, "Key": self._key(key)}
        if mime:
            params["ResponseContentType"] = mime
        return self.client.generate_presigned_url(
            "get_object", Params=params, ExpiresIn=settings.s3_presign_expire_s
        )


@lru_cache(maxsize=1)
def get_storage() -> Storage:
    if settings.storage_backend == "s3":
        return S3Storage(
            bucket=settings.s3_bucket,
            prefix=settings.s3_prefix,
            region=settings.s3_region,
            endpoint_url=settings.s3_endpoint_url,
        )
    return LocalStorage(settings.recordings_dir)


def connector_media_key(tenant_id: int, call_id: int, leg: str, filename: str) -> str:
    ext = os.path.splitext(filename)[1].lstrip(".").lower() or "bin"
    return f"tenants/{tenant_id}/calls/{call_id}/{leg}.{ext}"
