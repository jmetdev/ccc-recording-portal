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
    User,
    user_roles,
)


async def bootstrap(db: AsyncSession) -> None:
    group = (await db.execute(select(Group).where(Group.name == "Default"))).scalar_one_or_none()
    if not group:
        group = Group(name="Default")
        db.add(group)
        await db.flush()

    admin_role = (await db.execute(select(Role).where(Role.name == "admin"))).scalar_one_or_none()
    if not admin_role:
        admin_role = Role(name="admin", description="Full access")
        db.add(admin_role)
        await db.flush()
        for perm in Permission:
            db.add(RolePermission(role_id=admin_role.id, permission=perm))

    viewer_role = (await db.execute(select(Role).where(Role.name == "viewer"))).scalar_one_or_none()
    if not viewer_role:
        viewer_role = Role(name="viewer", description="Group-scoped call viewer")
        db.add(viewer_role)
        await db.flush()
        for perm in [Permission.VIEW_GROUP_CALLS, Permission.MANAGE_TAGS, Permission.VIEW_TRANSCRIPTS]:
            db.add(RolePermission(role_id=viewer_role.id, permission=perm))

    admin = (await db.execute(select(User).where(User.email == settings.admin_email))).scalar_one_or_none()
    if not admin:
        admin = User(
            email=settings.admin_email,
            username="admin",
            password_hash=hash_password(settings.admin_password),
            group_id=group.id,
            is_active=True,
        )
        db.add(admin)
        await db.flush()
        await db.execute(user_roles.insert().values(user_id=admin.id, role_id=admin_role.id))

    ext = (await db.execute(select(RecordedExtension).where(RecordedExtension.extension == "1034"))).scalar_one_or_none()
    if not ext:
        db.add(
            RecordedExtension(
                extension="1034",
                label="CUCM BIB Recording",
                enabled=True,
                group_id=group.id,
            )
        )

    await db.commit()
