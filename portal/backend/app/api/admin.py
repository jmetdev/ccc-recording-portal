from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.rbac import require_permission, user_permissions
from app.core.security import hash_password
from app.models import (
    Call,
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
from app.services.audit import record_audit
from app.services.retention import purge_call_media
from app.services.storage import get_storage

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
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    group = Group(name=body.name, tenant_id=user.tenant_id)
    db.add(group)
    await db.flush()
    await record_audit(
        db, tenant_id=user.tenant_id, user=user, action="admin.group_create",
        resource_type="group", resource_id=group.id, detail={"name": group.name}, request=request,
    )
    await db.commit()
    await db.refresh(group)
    return group


@router.delete("/groups/{group_id}")
async def delete_group(
    group_id: int,
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    group = (
        await db.execute(select(Group).where(Group.id == group_id, Group.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    await record_audit(
        db, tenant_id=user.tenant_id, user=user, action="admin.group_delete",
        resource_type="group", resource_id=group.id, detail={"name": group.name}, request=request,
    )
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
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    role = Role(name=body.name, description=body.description, tenant_id=user.tenant_id)
    db.add(role)
    await db.flush()
    for perm in body.permissions:
        db.add(RolePermission(role_id=role.id, permission=Permission(perm.value)))
    await record_audit(
        db, tenant_id=user.tenant_id, user=user, action="admin.role_create",
        resource_type="role", resource_id=role.id,
        detail={"name": role.name, "permissions": [p.value for p in body.permissions]}, request=request,
    )
    await db.commit()
    await db.refresh(role)
    result = await db.execute(select(Role).options(selectinload(Role.permissions)).where(Role.id == role.id))
    return serialize_role(result.scalar_one())


@router.delete("/roles/{role_id}")
async def delete_role(
    role_id: int,
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    role = (
        await db.execute(select(Role).where(Role.id == role_id, Role.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not role:
        raise HTTPException(status_code=404, detail="Role not found")
    await record_audit(
        db, tenant_id=user.tenant_id, user=user, action="admin.role_delete",
        resource_type="role", resource_id=role.id, detail={"name": role.name}, request=request,
    )
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
    request: Request,
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
    await record_audit(
        db, tenant_id=admin.tenant_id, user=admin, action="admin.user_create",
        resource_type="user", resource_id=user.id,
        detail={"email": user.email, "username": user.username}, request=request,
    )
    await db.commit()
    result = await db.execute(
        select(User).options(selectinload(User.roles).selectinload(Role.permissions)).where(User.id == user.id)
    )
    return serialize_user(result.scalar_one())


@router.patch("/users/{user_id}", response_model=UserOut)
async def update_user(
    user_id: int,
    body: UserUpdate,
    request: Request,
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
    changed: list[str] = []
    if body.email is not None:
        user.email = body.email
        changed.append("email")
    if body.username is not None:
        user.username = body.username
        changed.append("username")
    if body.password is not None:
        user.password_hash = hash_password(body.password)
        changed.append("password")
    if body.group_id is not None:
        user.group_id = body.group_id
        changed.append("group_id")
    if body.is_active is not None:
        user.is_active = body.is_active
        changed.append("is_active")
    if body.role_ids is not None:
        await db.execute(delete(user_roles).where(user_roles.c.user_id == user.id))
        for role_id in body.role_ids:
            await db.execute(user_roles.insert().values(user_id=user.id, role_id=role_id))
        changed.append("role_ids")
    await record_audit(
        db, tenant_id=admin.tenant_id, user=admin, action="admin.user_update",
        resource_type="user", resource_id=user.id, detail={"changed": changed}, request=request,
    )
    await db.commit()
    result = await db.execute(
        select(User).options(selectinload(User.roles).selectinload(Role.permissions)).where(User.id == user_id)
    )
    return serialize_user(result.scalar_one())


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    request: Request,
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    user = (
        await db.execute(select(User).where(User.id == user_id, User.tenant_id == admin.tenant_id))
    ).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    await record_audit(
        db, tenant_id=admin.tenant_id, user=admin, action="admin.user_delete",
        resource_type="user", resource_id=user.id,
        detail={"email": user.email, "username": user.username}, request=request,
    )
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
    request: Request,
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    data = body.model_dump(exclude={"group_ids"})
    ext = RecordedExtension(**data, tenant_id=admin.tenant_id)
    db.add(ext)
    await db.flush()
    await set_extension_groups(db, ext, body.group_ids)
    await record_audit(
        db, tenant_id=admin.tenant_id, user=admin, action="admin.extension_create",
        resource_type="recorded_extension", resource_id=ext.id,
        detail={"extension": ext.extension}, request=request,
    )
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
    request: Request,
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
    changed = list(body.model_dump(exclude_unset=True, exclude={"group_ids"}).keys())
    for k, v in body.model_dump(exclude_unset=True, exclude={"group_ids"}).items():
        setattr(ext, k, v)
    if body.group_ids is not None:
        await set_extension_groups(db, ext, body.group_ids)
        changed.append("group_ids")
    await record_audit(
        db, tenant_id=admin.tenant_id, user=admin, action="admin.extension_update",
        resource_type="recorded_extension", resource_id=ext.id,
        detail={"extension": ext.extension, "changed": changed}, request=request,
    )
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
    request: Request,
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
    await record_audit(
        db, tenant_id=admin.tenant_id, user=admin, action="admin.extension_delete",
        resource_type="recorded_extension", resource_id=ext.id,
        detail={"extension": ext.extension}, request=request,
    )
    await db.delete(ext)
    await db.commit()
    return {"status": "ok"}


@router.post("/purge-call-data")
async def purge_call_data(
    admin: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    """Permanently delete this tenant's calls: DB rows, media files, tags,
    transcripts, and pending media jobs. Irreversible — mirrors the retention
    sweep's disposition (media + metadata together) and is audited the same way.
    """
    storage = get_storage()
    calls = (
        await db.execute(
            select(Call).options(selectinload(Call.recordings)).where(Call.tenant_id == admin.tenant_id)
        )
    ).scalars().all()
    call_ids = [c.id for c in calls]

    files_deleted = sum(purge_call_media(storage, call) for call in calls)

    job_filter = Job.tenant_id == admin.tenant_id
    if call_ids:
        job_filter = or_(job_filter, Job.payload["call_id"].as_integer().in_(call_ids))
    await db.execute(delete(Job).where(job_filter))

    for call in calls:
        await db.delete(call)

    await record_audit(
        db,
        tenant_id=admin.tenant_id,
        user=admin,
        action="admin.purge_call_data",
        resource_type="tenant",
        resource_id=admin.tenant_id,
        detail={"calls_deleted": len(calls), "files_deleted": files_deleted},
    )
    await db.commit()
    return {"status": "ok", "calls_deleted": len(calls), "files_deleted": files_deleted}
