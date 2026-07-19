"""OIDC (Keycloak) bearer-token verification.

Unlike the recording backend, this service has no local user table — it only
verifies the token against the realm's JWKS and hands back the claims. Tenant
resolution and superadmin recognition read directly off those claims.
"""

import time

import httpx
from fastapi import HTTPException, status
from jose import JWTError, jwt

from app.core.config import settings

_jwks_cache: dict = {"jwks": None, "expires": 0.0}


async def _get_jwks() -> dict:
    now = time.time()
    if _jwks_cache["jwks"] and _jwks_cache["expires"] > now:
        return _jwks_cache["jwks"]
    issuer = settings.oidc_issuer.rstrip("/")
    async with httpx.AsyncClient(timeout=10) as client:
        conf = (await client.get(f"{issuer}/.well-known/openid-configuration")).json()
        jwks = (await client.get(conf["jwks_uri"])).json()
    _jwks_cache["jwks"] = jwks
    _jwks_cache["expires"] = now + 3600
    return jwks


async def verify_oidc_token(token: str) -> dict:
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        header = jwt.get_unverified_header(token)
    except JWTError:
        raise unauthorized from None
    jwks = await _get_jwks()
    key = next((k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid")), None)
    if key is None:
        _jwks_cache["expires"] = 0.0
        jwks = await _get_jwks()
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid")), None)
        if key is None:
            raise unauthorized
    # Same posture as the recording backend: audience only enforced when
    # OIDC_AUDIENCE is set explicitly (Keycloak access tokens default to
    # aud=account without an audience mapper on the realm).
    audience = settings.oidc_audience
    try:
        return jwt.decode(
            token,
            key,
            algorithms=[header.get("alg", "RS256")],
            audience=audience or None,
            issuer=settings.oidc_issuer.rstrip("/"),
            options={"verify_aud": bool(audience)},
        )
    except JWTError:
        raise unauthorized from None
