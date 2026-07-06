from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import get_current_user, user_permissions
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    is_token_type,
    verify_password,
)
from app.models import Role, User
from app.schemas import TokenResponse, UserOut
from app.services.audit import record_audit

router = APIRouter(prefix="/auth", tags=["auth"])


def serialize_user(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        username=user.username,
        is_active=user.is_active,
        is_superadmin=user.is_superadmin,
        tenant_id=user.tenant_id,
        group_id=user.group_id,
        roles=[r.name for r in user.roles],
        permissions=sorted(user_permissions(user)),
    )


async def _find_login_user(db: AsyncSession, identifier: str) -> User | None:
    """Resolve a login identifier: email (globally unique) or username.

    Usernames are only unique per tenant; if the same username exists in more
    than one tenant the caller must log in with their email instead.
    """
    opts = selectinload(User.roles).selectinload(Role.permissions)
    if "@" in identifier:
        result = await db.execute(select(User).options(opts).where(User.email == identifier))
        return result.scalar_one_or_none()
    result = await db.execute(select(User).options(opts).where(User.username == identifier))
    users = result.scalars().all()
    if len(users) > 1:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Ambiguous username; log in with your email address",
        )
    return users[0] if users else None


@router.post("/token", response_model=TokenResponse)
async def login(
    request: Request,
    form: OAuth2PasswordRequestForm = Depends(),
    db: AsyncSession = Depends(get_db),
):
    user = await _find_login_user(db, form.username)
    if not user or not verify_password(form.password, user.password_hash):
        if user:
            await record_audit(
                db,
                tenant_id=user.tenant_id,
                action="auth.login_failed",
                resource_type="user",
                resource_id=user.id,
                request=request,
                commit=True,
            )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User inactive")
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="auth.login",
        user=user,
        resource_type="user",
        resource_id=user.id,
        request=request,
        commit=True,
    )
    sub = str(user.id)
    return TokenResponse(
        access_token=create_access_token(sub, tenant_id=user.tenant_id),
        refresh_token=create_refresh_token(sub),
    )


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return serialize_user(user)


class SsoConfigOut(BaseModel):
    enabled: bool
    issuer: str | None = None
    client_id: str | None = None


class SsoExchangeIn(BaseModel):
    token: str


@router.get("/sso/config", response_model=SsoConfigOut)
async def sso_config():
    """Public: tells the login page whether/where to start the OIDC flow."""
    if not settings.oidc_enabled:
        return SsoConfigOut(enabled=False)
    return SsoConfigOut(
        enabled=True,
        issuer=settings.oidc_issuer.rstrip("/"),
        client_id=settings.oidc_client_id,
    )


@router.post("/sso/exchange", response_model=TokenResponse)
async def sso_exchange(body: SsoExchangeIn, request: Request, db: AsyncSession = Depends(get_db)):
    """Trade a verified IdP access token for portal-issued JWTs.

    The SPA completes the PKCE code flow against Keycloak, then exchanges here
    so the rest of the app (REST, websockets, refresh) runs on one local token
    format that always carries the tenant claim.
    """
    if not settings.oidc_enabled:
        raise HTTPException(status_code=404, detail="SSO not enabled")
    from app.core.oidc import resolve_oidc_user

    user = await resolve_oidc_user(db, body.token)
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="User inactive")
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="auth.login_sso",
        user=user,
        resource_type="user",
        resource_id=user.id,
        request=request,
        commit=True,
    )
    sub = str(user.id)
    return TokenResponse(
        access_token=create_access_token(sub, tenant_id=user.tenant_id),
        refresh_token=create_refresh_token(sub),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(token: str, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(token)
        if not is_token_type(payload, "refresh"):
            raise HTTPException(status_code=401, detail="Invalid refresh token")
        user_id = payload.get("sub")
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid refresh token") from exc

    result = await db.execute(select(User).where(User.id == int(user_id)))
    user = result.scalar_one_or_none()
    if not user or not user.is_active:
        raise HTTPException(status_code=401, detail="User not found")
    sub = str(user.id)
    return TokenResponse(
        access_token=create_access_token(sub, tenant_id=user.tenant_id),
        refresh_token=create_refresh_token(sub),
    )
