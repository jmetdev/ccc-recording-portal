"""OIDC (Keycloak) bearer-token verification and user resolution.

Verifies RS256 tokens against the issuer's JWKS (cached for an hour) and maps
the subject to a portal user: by ``oidc_subject``, then by email (linking the
subject), then — if ``OIDC_AUTO_PROVISION`` — by creating the user inside the
tenant named by the configured tenant claim. IdP role names that match portal
role names within that tenant are attached on every login.
"""

import secrets
import time

import httpx
from fastapi import HTTPException, status
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models import Role, Tenant, User, user_roles

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
        # Key rotation: refetch once before giving up.
        _jwks_cache["expires"] = 0.0
        jwks = await _get_jwks()
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == header.get("kid")), None)
        if key is None:
            raise unauthorized
    # Audience is only enforced when OIDC_AUDIENCE is set explicitly: Keycloak
    # access tokens carry aud=account by default, so requiring the client id
    # would need an audience mapper on every realm. Configure one and set
    # OIDC_AUDIENCE to harden production deployments.
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


def _claim_roles(claims: dict) -> list[str]:
    # Keycloak default mappers: realm_access.roles, or a flat "roles" claim.
    # Cognito puts group membership in "cognito:groups".
    realm = claims.get("realm_access") or {}
    roles = realm.get("roles") or claims.get("roles") or claims.get("cognito:groups") or []
    return [r for r in roles if isinstance(r, str)]


async def _tenant_for_claims(db: AsyncSession, claims: dict) -> Tenant:
    org_id = claims.get(settings.oidc_org_claim)
    if org_id:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.webex_org_id == org_id, Tenant.is_active.is_(True)))
        ).scalar_one_or_none()
        if tenant is not None:
            return tenant

    tenant_slug = claims.get(settings.oidc_tenant_claim) or settings.default_tenant_slug
    tenant = (
        await db.execute(select(Tenant).where(Tenant.slug == tenant_slug, Tenant.is_active.is_(True)))
    ).scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=403, detail=f"Unknown tenant: {tenant_slug}")
    return tenant


async def resolve_oidc_user(db: AsyncSession, token: str) -> User:
    claims = await verify_oidc_token(token)
    sub = claims.get("sub")
    email = claims.get("email")
    if not sub:
        raise HTTPException(status_code=401, detail="Token missing subject")

    from app.core.rbac import load_user  # avoid import cycle at module load

    result = await db.execute(select(User).where(User.oidc_subject == sub))
    user = result.scalar_one_or_none()
    if user is None and email:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is not None:
            user.oidc_subject = sub
            await db.commit()
    if user is not None:
        return await load_user(db, user.id)

    if not settings.oidc_auto_provision or not email:
        raise HTTPException(status_code=403, detail="User not provisioned")

    tenant = await _tenant_for_claims(db, claims)

    username = claims.get("preferred_username") or email.split("@")[0]
    user = User(
        tenant_id=tenant.id,
        email=email,
        username=username,
        # SSO users never log in with a local password.
        password_hash=hash_password(secrets.token_urlsafe(32)),
        is_active=True,
        oidc_subject=sub,
    )
    db.add(user)
    await db.flush()

    role_names = _claim_roles(claims)
    if role_names:
        roles = (
            await db.execute(
                select(Role).where(Role.tenant_id == tenant.id, Role.name.in_(role_names))
            )
        ).scalars().all()
        for role in roles:
            await db.execute(user_roles.insert().values(user_id=user.id, role_id=role.id))
    await db.commit()
    return await load_user(db, user.id)
