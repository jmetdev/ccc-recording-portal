"""Server-side OAuth login for Webex and Zoom.

Both are OAuth 2.0 authorization-code providers (not OIDC id_token/JWKS), so we
exchange the code for an access token and read the user's identity from the
provider's own "me" endpoint. The provider's org/account id maps to a portal
tenant; the user is provisioned there on first login with the default role.
"""

import base64
import secrets as _secrets
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models import Role, Tenant, User, user_roles

PLACEHOLDER = "REPLACE_ME"
DEFAULT_ROLE = "viewer"
STATE_TTL_S = 600


@dataclass
class Identity:
    subject: str            # stable provider user id, prefixed e.g. "webex:<id>"
    email: str | None
    name: str
    org_key: str | None     # provider org/account id -> tenant mapping


@dataclass
class Provider:
    key: str
    authorize_url: str
    token_url: str
    userinfo_url: str
    token_auth: str          # "body" | "basic"
    client_id: str
    client_secret: str
    scopes: str

    @property
    def enabled(self) -> bool:
        return (
            bool(self.client_id)
            and bool(self.client_secret)
            and PLACEHOLDER not in (self.client_id, self.client_secret)
        )


def _providers() -> dict[str, Provider]:
    return {
        "webex": Provider(
            key="webex",
            authorize_url="https://webexapis.com/v1/authorize",
            token_url="https://webexapis.com/v1/access_token",
            userinfo_url="https://webexapis.com/v1/people/me",
            token_auth="body",
            client_id=settings.webex_client_id,
            client_secret=settings.webex_client_secret,
            scopes=settings.webex_scopes,
        ),
        "zoom": Provider(
            key="zoom",
            authorize_url="https://zoom.us/oauth/authorize",
            token_url="https://zoom.us/oauth/token",
            userinfo_url="https://api.zoom.us/v2/users/me",
            token_auth="basic",
            client_id=settings.zoom_client_id,
            client_secret=settings.zoom_client_secret,
            scopes=settings.zoom_scopes,
        ),
    }


def get_provider(key: str) -> Provider:
    provider = _providers().get(key)
    if provider is None or not provider.enabled:
        raise HTTPException(status_code=404, detail=f"OAuth provider not available: {key}")
    return provider


def enabled_providers() -> list[str]:
    return [k for k, p in _providers().items() if p.enabled]


def redirect_uri(provider_key: str, request_origin: str) -> str:
    base = (settings.public_base_url or request_origin).rstrip("/")
    return f"{base}/api/auth/oauth/{provider_key}/callback"


# ---- signed state (CSRF protection; no server-side storage needed) ----
def make_state(provider_key: str) -> str:
    payload = {
        "typ": "oauth_state",
        "p": provider_key,
        "n": _secrets.token_urlsafe(8),
        "exp": int(time.time()) + STATE_TTL_S,
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_state(state: str, provider_key: str) -> None:
    try:
        claims = jwt.decode(state, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except JWTError:
        raise HTTPException(status_code=400, detail="Invalid OAuth state") from None
    if claims.get("typ") != "oauth_state" or claims.get("p") != provider_key:
        raise HTTPException(status_code=400, detail="OAuth state mismatch")


# ---- token exchange + identity lookup ----
async def exchange_and_fetch(provider: Provider, code: str, redirect: str) -> Identity:
    async with httpx.AsyncClient(timeout=15) as client:
        data = {"grant_type": "authorization_code", "code": code, "redirect_uri": redirect}
        headers: dict[str, str] = {}
        if provider.token_auth == "basic":
            basic = base64.b64encode(
                f"{provider.client_id}:{provider.client_secret}".encode()
            ).decode()
            headers["Authorization"] = f"Basic {basic}"
        else:  # credentials in the body
            data["client_id"] = provider.client_id
            data["client_secret"] = provider.client_secret
        tok = await client.post(provider.token_url, data=data, headers=headers)
        if tok.status_code != 200:
            raise HTTPException(status_code=401, detail=f"{provider.key} token exchange failed")
        access = tok.json().get("access_token")
        if not access:
            raise HTTPException(status_code=401, detail=f"{provider.key} returned no access token")
        me = await client.get(provider.userinfo_url, headers={"Authorization": f"Bearer {access}"})
        if me.status_code != 200:
            raise HTTPException(status_code=401, detail=f"{provider.key} identity lookup failed")
        return _extract(provider.key, me.json())


def _extract(provider_key: str, info: dict) -> Identity:
    if provider_key == "webex":
        emails = info.get("emails") or []
        email = emails[0] if emails else None
        return Identity(
            subject=f"webex:{info.get('id')}",
            email=email,
            name=info.get("displayName") or (email or ""),
            org_key=info.get("orgId"),
        )
    if provider_key == "zoom":
        name = " ".join(x for x in [info.get("first_name"), info.get("last_name")] if x)
        return Identity(
            subject=f"zoom:{info.get('id')}",
            email=info.get("email"),
            name=name or (info.get("email") or ""),
            org_key=info.get("account_id"),
        )
    raise HTTPException(status_code=400, detail="Unknown provider")


# ---- user + tenant resolution ----
async def resolve_user(db: AsyncSession, provider_key: str, ident: Identity) -> User:
    if not ident.email:
        raise HTTPException(status_code=403, detail="Provider did not return an email")
    from app.core.rbac import load_user  # avoid import cycle at module load

    user = (
        await db.execute(select(User).where(User.oidc_subject == ident.subject))
    ).scalar_one_or_none()
    if user is None:
        user = (
            await db.execute(select(User).where(User.email == ident.email))
        ).scalar_one_or_none()
        if user is not None:
            user.oidc_subject = ident.subject
            await db.commit()
    if user is not None:
        if provider_key == "webex":
            from app.services.group_sync import sync_user_groups

            try:
                await sync_user_groups(db, user)
            except Exception:
                pass  # best-effort; never blocks login
        return await load_user(db, user.id)

    tenant = await _tenant_for(db, provider_key, ident.org_key)
    user = User(
        tenant_id=tenant.id,
        email=ident.email,
        username=ident.email.split("@")[0],
        # OAuth users never log in with a local password.
        password_hash=hash_password(_secrets.token_urlsafe(32)),
        is_active=True,
        oidc_subject=ident.subject,
    )
    db.add(user)
    await db.flush()
    role_name = await _initial_role_name(db, provider_key, tenant.id, ident.email)
    role = (
        await db.execute(select(Role).where(Role.tenant_id == tenant.id, Role.name == role_name))
    ).scalar_one_or_none()
    if role is not None:
        await db.execute(user_roles.insert().values(user_id=user.id, role_id=role.id))
    await db.commit()
    return await load_user(db, user.id)


async def _initial_role_name(
    db: AsyncSession, provider_key: str, tenant_id: int, email: str
) -> str:
    """Webex org-admins land as "admin"; everyone else gets DEFAULT_ROLE.

    Best-effort: any failure (Service App not configured/authorized, API
    error) falls back to DEFAULT_ROLE rather than blocking login.
    """
    if provider_key != "webex":
        return DEFAULT_ROLE
    from app.services import webex_serviceapp as wx

    if not wx.serviceapp_enabled():
        return DEFAULT_ROLE
    try:
        token = await wx.get_org_token(db, tenant_id)
        if await wx.person_is_org_admin(token, email):
            return "admin"
    except Exception:
        pass
    return DEFAULT_ROLE


async def _tenant_for(db: AsyncSession, provider_key: str, org_key: str | None) -> Tenant:
    if org_key:
        if provider_key == "webex":
            # Real, indexed correlation column (source of truth) rather than
            # the settings_json convention Zoom still uses below.
            tenant = (
                await db.execute(
                    select(Tenant).where(
                        Tenant.is_active.is_(True), Tenant.webex_org_id == org_key
                    )
                )
            ).scalar_one_or_none()
        else:
            # Tenant.settings_json carries {"zoom_account_id": ...}
            tenant = (
                await db.execute(
                    select(Tenant).where(
                        Tenant.is_active.is_(True),
                        Tenant.settings_json["zoom_account_id"].astext == org_key,
                    )
                )
            ).scalar_one_or_none()
        if tenant is not None:
            return tenant
    # Fallback: the default tenant (dev / single-tenant deployments).
    tenant = (
        await db.execute(
            select(Tenant).where(
                Tenant.slug == settings.default_tenant_slug, Tenant.is_active.is_(True)
            )
        )
    ).scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=403, detail="No tenant mapped for this organization")
    return tenant
