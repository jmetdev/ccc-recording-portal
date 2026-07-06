from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.rbac import require_permission, user_permissions
from app.core.security import hash_password
from app.models import (
    Group,
    Job,
    Permission,
    RecordedExtension,
    Role,
    RolePermission,
    User,
    recorded_extension_groups,
    user_roles,
)
from app.schemas import (
    GroupCreate,
    GroupOut,
    RecordedExtensionCreate,
    RecordedExtensionOut,
    RecordedExtensionUpdate,
    RoleCreate,
    RoleOut,
    UserCreate,
    UserOut,
    UserUpdate,
)

router = APIRouter(prefix="/admin", tags=["admin"])


def serialize_role(role: Role) -> RoleOut:
    return RoleOut(
        id=role.id,
        name=role.name,
        description=role.description,
        permissions=[p.permission.value for p in role.permissions],
    )


def serialize_user(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        username=user.username,
        is_active=user.is_active,
        group_id=user.group_id,
        roles=[r.name for r in user.roles],
        permissions=sorted(user_permissions(user)),
    )


def serialize_extension(ext: RecordedExtension) -> RecordedExtensionOut:
    return RecordedExtensionOut(
        id=ext.id,
        extension=ext.extension,
        label=ext.label,
        enabled=ext.enabled,
        group_ids=[g.id for g in ext.groups],
    )


async def set_extension_groups(db: AsyncSession, ext: RecordedExtension, group_ids: list[int]) -> None:
    await db.execute(delete(recorded_extension_groups).where(recorded_extension_groups.c.extension_id == ext.id))
    for group_id in group_ids:
        await db.execute(
            recorded_extension_groups.insert().values(extension_id=ext.id, group_id=group_id)
        )


@router.get("/groups", response_model=list[GroupOut])
async def list_groups(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Group).where(Group.tenant_id == user.tenant_id).order_by(Group.name))
    return result.scalars().all()


@router.post("/groups", response_model=GroupOut)
async def create_group(
    body: GroupCreate,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    group = Group(name=body.name, tenant_id=user.tenant_id)
    db.add(group)
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/groups/{group_id}")
async def delete_group(
    group_id: int,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    group = (
        await db.execute(select(Group).where(Group.id == group_id, Group.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    await db.delete(group)
    await db.commit()
    return {"status": "ok"}


@router.get("/roles", response_model=list[RoleOut])
async def list_roles(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Role)
        .options(selectinload(Role.permissions))
        .where(Role.tenant_id == user.tenant_id)
        .order_by(Role.name)
    )
    return [serialize_role(r) for r in result.scalars().all()]


@router.post("/roles", response_model=RoleOut)
async def create_role(
    body: RoleCreate,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    role = Role(name=body.name, description=body.description, tenant_id=user.tenant_id)
    db.add(role)
    await db.flush()
    for perm in body.permissions:
        db.add(RolePermission(role_id=role.id, permission=Permission(perm.value)))
    await db.commit()
    await db.refresh(role)
    result = await db.execute(select(Role).options(selectinload(Role.permissions)).where(Role.id == role.id))
    return serialize_role(result.scalar_one())


@router.delete("/roles/{role_id}")
async def delete_role(
    role_id: int,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    role = (
        await db.execute(select(Role).where(Role.id == role_id, Role.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    await db.delete(role)
    await db.commit()
    return {"status": "ok"}


@router.get("/users", response_model=list[UserOut])
async def list_users(
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.tenant_id == admin.tenant_id)
    )
    return [serialize_user(u) for u in result.scalars().all()]


@router.post("/users", response_model=UserOut)
async def create_user(
    body: UserCreate,
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    user = User(
        tenant_id=admin.tenant_id,
        email=body.email,
        username=body.username,
        password_hash=hash_password(body.password),
        group_id=body.group_id,
        is_active=body.is_active,
    )
    db.add(user)
    await db.flush()
    for role_id in body.role_ids:
        await db.execute(user_roles.insert().values(user_id=user.id, role_id=role_id))
    await db.commit()
    result = await db.execute(
        select(User).options(selectinload(User.roles).selectinload(Role.permissions)).where(User.id == user.id)
    )
    return serialize_user(result.scalar_one())


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == user_id, User.tenant_id == admin.tenant_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if body.email is not None:
        user.email = body.email
    if body.username is not None:
        user.username = body.username
    if body.password is not None:
        user.password_hash = hash_password(body.password)
    if body.group_id is not None:
        user.group_id = body.group_id
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.role_ids is not None:
        await db.execute(delete(user_roles).where(user_roles.c.user_id == user.id))
        for role_id in body.role_ids:
            await db.execute(user_roles.insert().values(user_id=user.id, role_id=role_id))
    await db.commit()
    result = await db.execute(
        select(User).options(selectinload(User.roles).selectinload(Role.permissions)).where(User.id == user_id)
    )
    return serialize_user(result.scalar_one())


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    user = (
        await db.execute(select(User).where(User.id == user_id, User.tenant_id == admin.tenant_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await db.delete(user)
    await db.commit()
    return {"status": "ok"}


@router.get("/recorded-extensions", response_model=list[RecordedExtensionOut])
async def list_extensions(
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RecordedExtension)
        .options(selectinload(RecordedExtension.groups))
        .where(RecordedExtension.tenant_id == admin.tenant_id)
        .order_by(RecordedExtension.extension)
    )
    return [serialize_extension(e) for e in result.scalars().all()]


@router.post("/recorded-extensions", response_model=RecordedExtensionOut)
async def create_extension(
    body: RecordedExtensionCreate,
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump(exclude={"group_ids"})
    ext = RecordedExtension(**data, tenant_id=admin.tenant_id)
    db.add(ext)
    await db.flush()
    await set_extension_groups(db, ext, body.group_ids)
    await db.commit()
    result = await db.execute(
        select(RecordedExtension)
        .options(selectinload(RecordedExtension.groups))
        .where(RecordedExtension.id == ext.id)
    )
    return serialize_extension(result.scalar_one())


@router.patch("/recorded-extensions/{ext_id}", response_model=RecordedExtensionOut)
async def update_extension(
    ext_id: int,
    body: RecordedExtensionUpdate,
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(RecordedExtension)
        .options(selectinload(RecordedExtension.groups))
        .where(RecordedExtension.id == ext_id, RecordedExtension.tenant_id == admin.tenant_id)
    )
    ext = result.scalar_one_or_none()
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")
    for k, v in body.model_dump(exclude_unset=True, exclude={"group_ids"}).items():
        setattr(ext, k, v)
    if body.group_ids is not None:
        await set_extension_groups(db, ext, body.group_ids)
    await db.commit()
    result = await db.execute(
        select(RecordedExtension)
        .options(selectinload(RecordedExtension.groups))
        .where(RecordedExtension.id == ext_id)
    )
    return serialize_extension(result.scalar_one())


@router.delete("/recorded-extensions/{ext_id}")
async def delete_extension(
    ext_id: int,
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    ext = (
        await db.execute(
            select(RecordedExtension).where(
                RecordedExtension.id == ext_id, RecordedExtension.tenant_id == admin.tenant_id
            )
        )
    ).scalar_one_or_none()
    if not ext:
        raise HTTPException(status_code=404, detail="Extension not found")
    await db.delete(ext)
    await db.commit()
    return {"status": "ok"}


@router.post("/purge-call-data")
async def purge_call_data(
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    """Remove this tenant's calls, recordings, tags, transcripts, and media jobs."""
    from app.models import Call

    await db.execute(delete(Job).where(Job.tenant_id == admin.tenant_id))
    await db.execute(delete(Call).where(Call.tenant_id == admin.tenant_id))
    await db.commit()
    return {"status": "ok"}
