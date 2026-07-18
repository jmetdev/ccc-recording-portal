"""Control Hub group -> internal role/group sync.

Admins map specific Webex Control Hub groups to internal Roles and/or
(call-visibility) Groups via the mapping table; this module keeps each
mapped user's actual role/group assignment in step with their live Control
Hub group membership — both on login (sync_user_groups) and via a periodic
job (sync_all_tenants), so someone removed from a Control Hub group loses
access without waiting for their next login.

Depends on webex_serviceapp.list_group_members, which is UNVALIDATED pending
a live-org spike (see docs/webex-service-app.md) — this module's logic is
correct independent of that, but will not do anything useful until the real
Groups API shape is confirmed.
"""

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings

from app.models import (
    Tenant,
    User,
    WebexGroupRoleMapping,
    WebexGroupSyncState,
    user_roles,
)
from app.services import webex_serviceapp as wx

logger = logging.getLogger(__name__)


async def _tenant_has_mappings(db: AsyncSession, tenant_id: int) -> bool:
    return (
        await db.execute(
            select(WebexGroupRoleMapping.id).where(WebexGroupRoleMapping.tenant_id == tenant_id).limit(1)
        )
    ).scalar_one_or_none() is not None


async def sync_user_groups(db: AsyncSession, user: User) -> None:
    """Re-check one user's Control Hub group memberships and update their
    role/group assignment to match. No-op if the tenant has no mappings
    configured or the Service App isn't set up — must never add API calls
    for tenants that haven't opted in."""
    if not wx.serviceapp_enabled():
        return
    if not await _tenant_has_mappings(db, user.tenant_id):
        return

    try:
        token = await wx.get_org_token(db, user.tenant_id)
    except Exception:
        return  # not authorized yet; best-effort, never blocks login

    mappings = (
        (
            await db.execute(
                select(WebexGroupRoleMapping).where(WebexGroupRoleMapping.tenant_id == user.tenant_id)
            )
        )
        .scalars()
        .all()
    )

    matched_role_id: int | None = None
    matched_group_id: int | None = None
    for mapping in mappings:
        try:
            members = await wx.list_group_members(token, mapping.webex_group_id)
        except Exception:
            logger.warning("Group membership lookup failed for %s", mapping.webex_group_id)
            continue
        if user.email in members:
            if mapping.role_id is not None:
                matched_role_id = mapping.role_id
            if mapping.group_id is not None:
                matched_group_id = mapping.group_id

    await db.execute(user_roles.delete().where(user_roles.c.user_id == user.id))
    if matched_role_id is not None:
        await db.execute(user_roles.insert().values(user_id=user.id, role_id=matched_role_id))
    user.group_id = matched_group_id
    await db.commit()


async def sync_tenant(db: AsyncSession, tenant_id: int) -> int | None:
    """Sync one tenant's mapped users. Returns the number of users whose
    group assignment changed, or None if the tenant has no mappings /
    isn't authorized (a no-op, not an error)."""
    mappings = (
        (
            await db.execute(
                select(WebexGroupRoleMapping).where(WebexGroupRoleMapping.tenant_id == tenant_id)
            )
        )
        .scalars()
        .all()
    )
    if not mappings or not wx.serviceapp_enabled():
        return None

    state = (
        await db.execute(select(WebexGroupSyncState).where(WebexGroupSyncState.tenant_id == tenant_id))
    ).scalar_one_or_none()
    if state is None:
        state = WebexGroupSyncState(tenant_id=tenant_id)
        db.add(state)

    try:
        token = await wx.get_org_token(db, tenant_id)
    except Exception as exc:
        state.last_sync_status = "error"
        state.last_sync_error = str(exc)
        await db.commit()
        return None

    # Fetch each mapped group's members once; assemble email -> (role_id, group_id).
    assignment: dict[str, tuple[int | None, int | None]] = {}
    try:
        for mapping in mappings:
            members = await wx.list_group_members(token, mapping.webex_group_id)
            for email in members:
                role_id, group_id = assignment.get(email, (None, None))
                assignment[email] = (
                    mapping.role_id if mapping.role_id is not None else role_id,
                    mapping.group_id if mapping.group_id is not None else group_id,
                )
    except Exception as exc:
        state.last_sync_status = "error"
        state.last_sync_error = str(exc)
        await db.commit()
        return None

    users = (await db.execute(select(User).where(User.tenant_id == tenant_id))).scalars().all()
    changed = 0
    for user in users:
        role_id, group_id = assignment.get(user.email, (None, None))
        await db.execute(user_roles.delete().where(user_roles.c.user_id == user.id))
        if role_id is not None:
            await db.execute(user_roles.insert().values(user_id=user.id, role_id=role_id))
        if user.group_id != group_id:
            user.group_id = group_id
            changed += 1

    state.last_synced_at = datetime.now(timezone.utc)
    state.last_sync_status = "ok"
    state.last_sync_error = None
    await db.commit()
    return changed


async def sync_all_tenants(db: AsyncSession) -> dict:
    """Periodic job: sync every active tenant with mappings configured."""
    summary: dict[str, int] = {}
    tenants = (await db.execute(select(Tenant).where(Tenant.is_active.is_(True)))).scalars().all()
    for tenant in tenants:
        changed = await sync_tenant(db, tenant.id)
        if changed is not None:
            summary[tenant.slug] = changed
    return {"tenants_synced": summary}


async def group_sync_loop() -> None:
    from app.core.database import async_session

    interval = settings.group_sync_interval_s
    if interval <= 0:
        return
    while True:
        await asyncio.sleep(interval)
        try:
            async with async_session() as db:
                result = await sync_all_tenants(db)
                if any(result["tenants_synced"].values()):
                    logger.info("group sync updated: %s", result["tenants_synced"])
        except Exception:  # noqa: BLE001 - the loop must survive transient errors
            logger.exception("group sync failed")
