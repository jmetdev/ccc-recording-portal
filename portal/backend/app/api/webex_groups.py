"""Admin-facing Control Hub group -> role/group mapping CRUD + manual sync."""

import time

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import require_permission
from app.models import Permission, User, WebexGroupRoleMapping, WebexGroupSyncState
from app.services import group_sync as gs
from app.services import webex_serviceapp as wx
from app.services.audit import record_audit

router = APIRouter(prefix="/tenant/webex", tags=["webex-groups"])

# 60s per-tenant cache: mirrors CloudCoreFax's bot-space cache pattern, avoids
# hammering the Webex Groups API on every settings-page load.
_groups_cache: dict[int, tuple[float, list[dict]]] = {}
_GROUPS_TTL_S = 60


@router.get("/groups")
async def list_groups(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    cached = _groups_cache.get(user.tenant_id)
    if cached and time.monotonic() - cached[0] < _GROUPS_TTL_S:
        return cached[1]
    token = await wx.get_org_token(db, user.tenant_id)
    groups = await wx.list_org_groups(token)
    _groups_cache[user.tenant_id] = (time.monotonic(), groups)
    return groups


class GroupMappingOut(BaseModel):
    id: int
    webex_group_id: str
    webex_group_name: str | None
    role_id: int | None
    group_id: int | None


class GroupMappingCreate(BaseModel):
    webex_group_id: str
    webex_group_name: str | None = None
    role_id: int | None = None
    group_id: int | None = None


@router.get("/group-mappings", response_model=list[GroupMappingOut])
async def list_group_mappings(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    rows = (
        (
            await db.execute(
                select(WebexGroupRoleMapping).where(WebexGroupRoleMapping.tenant_id == user.tenant_id)
            )
        )
        .scalars()
        .all()
    )
    return rows


@router.post("/group-mappings", response_model=GroupMappingOut)
async def create_group_mapping(
    body: GroupMappingCreate,
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    existing = (
        await db.execute(
            select(WebexGroupRoleMapping).where(
                WebexGroupRoleMapping.tenant_id == user.tenant_id,
                WebexGroupRoleMapping.webex_group_id == body.webex_group_id,
            )
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail="This Webex group is already mapped")
    mapping = WebexGroupRoleMapping(tenant_id=user.tenant_id, **body.model_dump())
    db.add(mapping)
    await db.flush()
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        user=user,
        action="webex_group_mapping.create",
        resource_type="webex_group_role_mapping",
        resource_id=mapping.id,
        detail=body.model_dump(),
        request=request,
    )
    await db.commit()
    await db.refresh(mapping)
    return mapping


@router.delete("/group-mappings/{mapping_id}")
async def delete_group_mapping(
    mapping_id: int,
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    mapping = (
        await db.execute(
            select(WebexGroupRoleMapping).where(
                WebexGroupRoleMapping.id == mapping_id, WebexGroupRoleMapping.tenant_id == user.tenant_id
            )
        )
    ).scalar_one_or_none()
    if mapping is None:
        raise HTTPException(status_code=404, detail="Mapping not found")
    await db.delete(mapping)
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        user=user,
        action="webex_group_mapping.delete",
        resource_type="webex_group_role_mapping",
        resource_id=mapping_id,
        request=request,
    )
    await db.commit()
    return {"status": "ok"}


@router.get("/group-mappings/sync-state")
async def sync_state(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    state = (
        await db.execute(
            select(WebexGroupSyncState).where(WebexGroupSyncState.tenant_id == user.tenant_id)
        )
    ).scalar_one_or_none()
    if state is None:
        return {"last_synced_at": None, "last_sync_status": None, "last_sync_error": None}
    return {
        "last_synced_at": state.last_synced_at,
        "last_sync_status": state.last_sync_status,
        "last_sync_error": state.last_sync_error,
    }


@router.post("/group-mappings/sync-now")
async def sync_now(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    changed = await gs.sync_tenant(db, user.tenant_id)
    return {"changed": changed}
