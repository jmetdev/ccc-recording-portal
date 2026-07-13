#!/usr/bin/env python3
"""End-to-end smoke test for the v2 connector ingest path.

Registers a synthetic call, uploads a 1-second WAV, and marks it processed —
exercising the DB write path and the S3 media upload without needing a real
FreeSWITCH. Stdlib only (urllib), so it runs anywhere Python 3 is available.

Env:
  PORTAL_URL       e.g. https://dev.cloudcorecollab.com
  CONNECTOR_TOKEN  a per-tenant connector token (ccck_...)
  SMOKE_SOURCE     optional, "cucm" (default) or "webex"

Exit code 0 on success, non-zero on any failure.
"""

import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
import wave


def _wav_bytes(seconds: float = 1.0, rate: int = 8000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(rate * seconds))
    return buf.getvalue()


def _request(method: str, url: str, token: str, *, json_body=None, multipart=None):
    headers = {"Authorization": f"Bearer {token}"}
    data = None
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    elif multipart is not None:
        boundary = uuid.uuid4().hex
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        data = _encode_multipart(multipart["fields"], multipart["file"], boundary)
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = resp.read().decode()
            return resp.status, json.loads(body) if body else {}
    except urllib.error.HTTPError as exc:
        return exc.code, {"error": exc.read().decode()[:500]}


def _encode_multipart(fields: dict, file_part: tuple, boundary: str) -> bytes:
    # file_part = (field_name, filename, content_type, bytes)
    out = io.BytesIO()
    for name, value in fields.items():
        out.write(f"--{boundary}\r\n".encode())
        out.write(f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode())
        out.write(f"{value}\r\n".encode())
    fname, filename, ctype, content = file_part
    out.write(f"--{boundary}\r\n".encode())
    out.write(
        f'Content-Disposition: form-data; name="{fname}"; filename="{filename}"\r\n'.encode()
    )
    out.write(f"Content-Type: {ctype}\r\n\r\n".encode())
    out.write(content)
    out.write(f"\r\n--{boundary}--\r\n".encode())
    return out.getvalue()


def main() -> int:
    portal = os.environ.get("PORTAL_URL", "").rstrip("/")
    token = os.environ.get("CONNECTOR_TOKEN", "")
    source = os.environ.get("SMOKE_SOURCE", "cucm")
    if not portal or not token:
        print("PORTAL_URL and CONNECTOR_TOKEN are required", file=sys.stderr)
        return 2

    refci = f"smoke-{int(time.time())}-{uuid.uuid4().hex[:6]}"
    base = f"{portal}/api/v2"

    status, body = _request(
        "POST", f"{base}/ingest/calls/start", token,
        json_body={"refci": refci, "source": source, "near_addr": "1000", "far_addr": "2000"},
    )
    if status != 200:
        print(f"start failed: {status} {body}", file=sys.stderr)
        return 1
    call_id = body["call_id"]
    print(f"started call {call_id} (refci={refci})")

    status, body = _request(
        "POST", f"{base}/ingest/calls/{call_id}/media", token,
        multipart={
            "fields": {"leg": "mix", "duration_s": "1.0", "sample_rate": "8000", "channels": "1"},
            "file": ("file", "smoke.wav", "audio/wav", _wav_bytes()),
        },
    )
    if status != 200:
        print(f"media upload failed: {status} {body}", file=sys.stderr)
        return 1
    print(f"uploaded media -> {body.get('media_path')} ({body.get('bytes')} bytes)")

    status, body = _request(
        "POST", f"{base}/ingest/calls/complete", token,
        json_body={"refci": refci, "processed": True, "duration_s": 1.0},
    )
    if status != 200:
        print(f"complete failed: {status} {body}", file=sys.stderr)
        return 1

    print(f"SMOKE OK: call {call_id} completed and media landed in S3")
    return 0


if __name__ == "__main__":
    sys.exit(main())
