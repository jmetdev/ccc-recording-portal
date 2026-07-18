import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Permission, Role, RolePermission, Tenant

_default_tenant_id: int | None = None


async def get_default_tenant_id(db: AsyncSession) -> int:
    """Tenant that legacy (v1) single-tenant integrations map onto."""
    global _default_tenant_id
    if _default_tenant_id is None:
        result = await db.execute(select(Tenant.id).where(Tenant.slug == settings.default_tenant_slug))
        _default_tenant_id = result.scalar_one()
    return _default_tenant_id


# ---- role seeding + Webex-org-driven tenant provisioning ----
# Mirrors bootstrap.py's admin/viewer role shapes so behavior is unchanged for
# existing tenants, but is idempotent and callable for any tenant (not just
# the default one seeded once at process start).

TENANT_ROLES: dict[str, tuple[str, list[Permission]]] = {
    "admin": ("Full access", list(Permission)),
    "viewer": (
        "Group-scoped call viewer",
        [Permission.VIEW_GROUP_CALLS, Permission.MANAGE_TAGS, Permission.VIEW_TRANSCRIPTS],
    ),
}


async def seed_tenant_roles(db: AsyncSession, tenant_id: int) -> None:
    """Idempotently ensure the standard admin/viewer roles exist for a tenant."""
    for name, (description, perms) in TENANT_ROLES.items():
        role = (
            await db.execute(select(Role).where(Role.tenant_id == tenant_id, Role.name == name))
        ).scalar_one_or_none()
        if role is None:
            role = Role(tenant_id=tenant_id, name=name, description=description)
            db.add(role)
            await db.flush()
            for perm in perms:
                db.add(RolePermission(role_id=role.id, permission=perm))


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")
    return slug or "org"


async def provision_webex_tenant(db: AsyncSession, org_id: str, org_name: str | None) -> Tenant:
    """Get-or-create the tenant for a Webex org_id, seeding its roles either way."""
    tenant = (
        await db.execute(select(Tenant).where(Tenant.webex_org_id == org_id))
    ).scalar_one_or_none()
    if tenant is not None:
        await seed_tenant_roles(db, tenant.id)
        return tenant

    base_slug = _slugify(org_name or org_id[-12:])
    slug = base_slug
    suffix = 2
    while (await db.execute(select(Tenant).where(Tenant.slug == slug))).scalar_one_or_none():
        slug = f"{base_slug}-{suffix}"
        suffix += 1

    tenant = Tenant(
        slug=slug,
        name=org_name or slug,
        webex_org_id=org_id,
        settings_json={"webex_org_id": org_id},
    )
    db.add(tenant)
    await db.flush()
    await seed_tenant_roles(db, tenant.id)
    return tenant
