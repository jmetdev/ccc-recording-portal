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
            # ID tokens carry an at_hash claim tying them to the access token
            # issued alongside them; jose refuses to decode without one
            # unless this is disabled. We only use this token to identify the
            # caller, never to validate a paired access token.
            options={"verify_aud": bool(audience), "verify_at_hash": False},
        )
    except JWTError:
        raise unauthorized from None


def _claim_roles(claims: dict) -> list[str]:
    # Keycloak default mappers: realm_access.roles, or a flat "roles" claim.
    # Cognito puts group membership in "cognito:groups".
    realm = claims.get("realm_access") or {}
    roles = realm.get("roles") or claims.get("roles") or claims.get("cognito:groups") or []
    return [r for r in roles if isinstance(r, str)]


async def _suite_tenant_by_org(org_id: str) -> dict | None:
    if not settings.suite_api_url or not settings.suite_internal_token:
        return None
    url = f"{settings.suite_api_url.rstrip('/')}/api/internal/tenants/by-org/{org_id}"
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(url, headers={"x-internal-token": settings.suite_internal_token})
    except httpx.HTTPError:
        return None
    if resp.status_code != 200:
        return None
    return resp.json()


async def _assign_role_if_missing(db: AsyncSession, user_id: int, role_id: int) -> bool:
    existing = (
        await db.execute(
            select(user_roles.c.user_id).where(
                user_roles.c.user_id == user_id, user_roles.c.role_id == role_id
            )
        )
    ).first()
    if existing is not None:
        return False
    await db.execute(user_roles.insert().values(user_id=user_id, role_id=role_id))
    return True


async def _ensure_suite_admin_role(
    db: AsyncSession,
    user: User,
    *,
    claims: dict | None = None,
    org_id: str | None = None,
) -> bool:
    """Grant the tenant's admin role when the caller is the suite-registered admin.

    Suite tenants are created with an ``admin_email``. Webex/Keycloak SSO does
    not carry portal role names, so without this the first sign-in creates a
    user with zero permissions — no Settings, no connector provisioning, and
    403s on live-call endpoints that call ``scoped_call_filter``.
    """
    email = ((claims or {}).get("email") or user.email or "").lower()
    resolved_org = org_id or (claims or {}).get(settings.oidc_org_claim)
    if not resolved_org and user.tenant is not None:
        resolved_org = user.tenant.webex_org_id
    if not email or not resolved_org or user.tenant_id is None:
        return False

    suite_tenant = await _suite_tenant_by_org(str(resolved_org))
    if not suite_tenant:
        return False
    if (suite_tenant.get("admin_email") or "").lower() != email:
        return False

    from app.services.tenancy import seed_tenant_roles

    await seed_tenant_roles(db, user.tenant_id)
    admin_role = (
        await db.execute(select(Role).where(Role.tenant_id == user.tenant_id, Role.name == "admin"))
    ).scalar_one_or_none()
    if admin_role is None:
        return False
    return await _assign_role_if_missing(db, user.id, admin_role.id)


async def _apply_claim_roles(db: AsyncSession, user: User, tenant_id: int, claims: dict) -> bool:
    role_names = _claim_roles(claims)
    if not role_names:
        return False
    roles = (
        await db.execute(select(Role).where(Role.tenant_id == tenant_id, Role.name.in_(role_names)))
    ).scalars().all()
    changed = False
    for role in roles:
        if await _assign_role_if_missing(db, user.id, role.id):
            changed = True
    return changed


async def _tenant_for_claims(db: AsyncSession, claims: dict) -> Tenant:
    org_id = claims.get(settings.oidc_org_claim)
    if org_id:
        tenant = (
            await db.execute(select(Tenant).where(Tenant.webex_org_id == org_id, Tenant.is_active.is_(True)))
        ).scalar_one_or_none()
        if tenant is not None:
            return tenant

        if settings.oidc_org_strict:
            suite_tenant = await _suite_tenant_by_org(org_id)
            if suite_tenant and suite_tenant.get("status") == "active":
                recording_entitlement = next(
                    (e for e in suite_tenant.get("entitlements", []) if e.get("app") == "recording"),
                    None,
                )
                if recording_entitlement and recording_entitlement.get("licensed"):
                    from app.services.tenancy import provision_webex_tenant  # avoid import cycle

                    return await provision_webex_tenant(db, org_id, suite_tenant.get("name"))
            raise HTTPException(
                status_code=403,
                detail={"code": "org_not_provisioned", "org_id": org_id},
            )

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
    linked_subject = False
    if user is None and email:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if user is not None:
            user.oidc_subject = sub
            linked_subject = True

    if user is not None:
        # Heal suite admins who signed in before role assignment existed, and
        # pick up any IdP role claims that appeared since last login.
        changed = await _ensure_suite_admin_role(db, user, claims=claims)
        changed = (await _apply_claim_roles(db, user, user.tenant_id, claims)) or changed
        if linked_subject or changed:
            await db.commit()
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

    await _apply_claim_roles(db, user, tenant.id, claims)
    await _ensure_suite_admin_role(db, user, claims=claims)
    await db.commit()
    return await load_user(db, user.id)


async def ensure_suite_admin_for_user(db: AsyncSession, user: User) -> User:
    """Best-effort heal for an already-authenticated portal session.

    Used by ``/auth/me`` so a suite admin who signed in before role assignment
    existed picks up ``admin`` without forcing another SSO round-trip.
    """
    from app.core.rbac import load_user, user_permissions
    from app.models import Permission

    if user.is_superadmin or Permission.MANAGE_USERS.value in user_permissions(user):
        return user
    if await _ensure_suite_admin_role(db, user):
        await db.commit()
        reloaded = await load_user(db, user.id)
        return reloaded or user
    return user
