"""Request-scoped auth dependencies: verified claims, superadmin gate, internal
service-to-service gate.
"""

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.config import settings
from app.core.oidc import verify_oidc_token

_bearer = HTTPBearer(auto_error=True)


async def get_claims(creds: HTTPAuthorizationCredentials = Depends(_bearer)) -> dict:
    return await verify_oidc_token(creds.credentials)


async def require_superadmin(claims: dict = Depends(get_claims)) -> dict:
    email = (claims.get("email") or "").lower()
    if not email or email not in settings.superadmin_email_list:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Superadmin access required")
    return claims


async def require_internal_token(x_internal_token: str = Header(default="")) -> None:
    if not settings.suite_internal_token or x_internal_token != settings.suite_internal_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")
