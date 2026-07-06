import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")

CONNECTOR_TOKEN_PREFIX = "ccck_"


def generate_connector_token() -> tuple[str, str]:
    """Return (plaintext_token, sha256_hex). Plaintext is shown exactly once."""
    token = CONNECTOR_TOKEN_PREFIX + secrets.token_urlsafe(32)
    return token, hash_connector_token(token)


def hash_connector_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def create_access_token(subject: str, extra: dict[str, Any] | None = None, tenant_id: int | None = None) -> str:
    if tenant_id is not None:
        extra = {**(extra or {}), "tid": tenant_id}
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    payload = {"sub": subject, "exp": expire, "type": "access"}
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def create_refresh_token(subject: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(days=settings.refresh_token_expire_days)
    payload = {"sub": subject, "exp": expire, "type": "refresh"}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])


def is_token_type(payload: dict[str, Any], expected: str) -> bool:
    return payload.get("type") == expected
