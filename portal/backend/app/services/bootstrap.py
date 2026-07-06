from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import hash_password
from app.models import (
    Group,
    Permission,
    RecordedExtension,
    Role,
    RolePermission,
    Tenant,
    User,
    user_roles,
)


async def bootstrap(db: AsyncSession) -> None:
    tenant = (
        await db.execute(select(Tenant).where(Tenant.slug == settings.default_tenant_slug))
    ).scalar_one_or_none()
    if not tenant:
        tenant = Tenant(slug=settings.default_tenant_slug, name="Default Tenant", is_active=True)
        db.add(tenant)
        await db.flush()

    group = (
        await db.execute(select(Group).where(Group.name == "Default", Group.tenant_id == tenant.id))
    ).scalar_one_or_none()
    if not group:
        group = Group(name="Default", tenant_id=tenant.id)
        db.add(group)
        await db.flush()

    admin_role = (
        await db.execute(select(Role).where(Role.name == "admin", Role.tenant_id == tenant.id))
    ).scalar_one_or_none()
    if not admin_role:
        admin_role = Role(name="admin", description="Full access", tenant_id=tenant.id)
        db.add(admin_role)
        await db.flush()
        for perm in Permission:
            db.add(RolePermission(role_id=admin_role.id, permission=perm))

    viewer_role = (
        await db.execute(select(Role).where(Role.name == "viewer", Role.tenant_id == tenant.id))
    ).scalar_one_or_none()
    if not viewer_role:
        viewer_role = Role(name="viewer", description="Group-scoped call viewer", tenant_id=tenant.id)
        db.add(viewer_role)
        await db.flush()
        for perm in [Permission.VIEW_GROUP_CALLS, Permission.MANAGE_TAGS, Permission.VIEW_TRANSCRIPTS]:
            db.add(RolePermission(role_id=viewer_role.id, permission=perm))

    admin = (await db.execute(select(User).where(User.email == settings.admin_email))).scalar_one_or_none()
    if not admin:
        admin = User(
            tenant_id=tenant.id,
            email=settings.admin_email,
            username="admin",
            password_hash=hash_password(settings.admin_password),
            group_id=group.id,
            is_active=True,
            is_superadmin=True,
        )
        db.add(admin)
        await db.flush()
        await db.execute(user_roles.insert().values(user_id=admin.id, role_id=admin_role.id))
    elif not admin.is_superadmin:
        # The bootstrap admin is the platform operator.
        admin.is_superadmin = True

    ext = (
        await db.execute(
            select(RecordedExtension).where(
                RecordedExtension.extension == "1034", RecordedExtension.tenant_id == tenant.id
            )
        )
    ).scalar_one_or_none()
    if not ext:
        ext = RecordedExtension(
            tenant_id=tenant.id,
            extension="1034",
            label="CUCM BIB Recording",
            enabled=True,
        )
        ext.groups = [group]
        db.add(ext)

    await db.commit()
