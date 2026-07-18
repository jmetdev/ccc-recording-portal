"""Fernet encryption for Webex Service App tokens at rest.

The key comes from CRYPTO_KEY (SSM SecureString in the cloud). In dev, an
empty key falls back to a key derived from jwt_secret so local stacks work
without extra setup — never rely on that in production.
"""

import base64
import hashlib

from cryptography.fernet import Fernet

from app.core.config import settings


def _fernet() -> Fernet:
    key = settings.crypto_key
    if not key:
        digest = hashlib.sha256(settings.jwt_secret.encode()).digest()
        key = base64.urlsafe_b64encode(digest).decode()
    return Fernet(key.encode())


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    return _fernet().decrypt(ciphertext.encode()).decode()
