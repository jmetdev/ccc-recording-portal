"""Retention disposition sweep.

Purges calls (and their media) past each tenant's retention window, skipping
anything under legal hold. Also permanently deletes soft-trashed calls after
the trash recovery window. Runs as a periodic background task and on demand
via the admin API. Every disposition is written to the audit log so records
officers can evidence the retention schedule was applied.
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.models import Call, Tenant
from app.services.audit import record_audit
from app.services.storage import Storage, get_storage

logger = logging.getLogger(__name__)

HOLDING_RETENTION_DAYS = 7
TRASH_RETENTION_DAYS = 30


def purge_call_media(storage: Storage, call: Call) -> int:
    """Delete every recording's media objects for a call. Returns files deleted.

    Shared by the retention sweep and the admin danger-zone purge so both
    paths leave the same disposition: DB rows AND media are removed together.
    """
    deleted = 0
    for rec in call.recordings:
        for key in (rec.media_path, rec.path_m4a, rec.path_wav):
            if not key:
                continue
            try:
                storage.delete(key)
                deleted += 1
            except Exception:  # noqa: BLE001 - keep going on media errors
                logger.warning("purge: failed to delete media %s", key)
    return deleted


async def sweep_expired_calls(db: AsyncSession) -> dict:
    storage = get_storage()
    now = datetime.now(timezone.utc)
    purged: dict[str, int] = {}

    tenants = (
        await db.execute(
            select(Tenant).where(Tenant.retention_days.is_not(None), Tenant.is_active.is_(True))
        )
    ).scalars().all()

    for tenant in tenants:
        cutoff = now - timedelta(days=tenant.retention_days)
        calls = (
            await db.execute(
                select(Call)
                .options(selectinload(Call.recordings))
                .where(
                    Call.tenant_id == tenant.id,
                    Call.legal_hold.is_(False),
                    Call.trashed_at.is_(None),
                    Call.started_at < cutoff,
                )
            )
        ).scalars().all()
        for call in calls:
            purge_call_media(storage, call)
            await record_audit(
                db,
                tenant_id=tenant.id,
                action="retention.purge",
                resource_type="call",
                resource_id=call.id,
                detail={"refci": call.refci, "started_at": str(call.started_at)},
            )
            await db.delete(call)
        if calls:
            purged[tenant.slug] = len(calls)

    await db.commit()
    return {"purged": purged}


async def sweep_holding_calls(db: AsyncSession) -> dict:
    """Purge holding-pool calls older than 7 days (independent of tenant retention)."""
    storage = get_storage()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=HOLDING_RETENTION_DAYS)
    calls = (
        await db.execute(
            select(Call)
            .options(selectinload(Call.recordings))
            .where(
                Call.holding.is_(True),
                Call.legal_hold.is_(False),
                Call.trashed_at.is_(None),
                Call.started_at < cutoff,
            )
        )
    ).scalars().all()
    purged_by_tenant: dict[str, int] = {}
    for call in calls:
        purge_call_media(storage, call)
        tenant = (
            await db.execute(select(Tenant).where(Tenant.id == call.tenant_id))
        ).scalar_one()
        await record_audit(
            db,
            tenant_id=call.tenant_id,
            action="retention.holding_purge",
            resource_type="call",
            resource_id=call.id,
            detail={"refci": call.refci, "started_at": str(call.started_at)},
        )
        await db.delete(call)
        purged_by_tenant[tenant.slug] = purged_by_tenant.get(tenant.slug, 0) + 1

    await db.commit()
    return {"purged": purged_by_tenant}


async def sweep_trashed_calls(db: AsyncSession) -> dict:
    """Permanently delete soft-trashed calls older than the 30-day recovery window."""
    storage = get_storage()
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=TRASH_RETENTION_DAYS)
    calls = (
        await db.execute(
            select(Call)
            .options(selectinload(Call.recordings))
            .where(
                Call.trashed_at.is_not(None),
                Call.trashed_at < cutoff,
                Call.legal_hold.is_(False),
            )
        )
    ).scalars().all()
    purged_by_tenant: dict[str, int] = {}
    for call in calls:
        purge_call_media(storage, call)
        tenant = (
            await db.execute(select(Tenant).where(Tenant.id == call.tenant_id))
        ).scalar_one()
        await record_audit(
            db,
            tenant_id=call.tenant_id,
            action="retention.trash_purge",
            resource_type="call",
            resource_id=call.id,
            detail={
                "refci": call.refci,
                "started_at": str(call.started_at),
                "trashed_at": str(call.trashed_at),
            },
        )
        await db.delete(call)
        purged_by_tenant[tenant.slug] = purged_by_tenant.get(tenant.slug, 0) + 1

    await db.commit()
    return {"purged": purged_by_tenant}


async def retention_sweep_loop() -> None:
    from app.core.database import async_session

    interval = settings.retention_sweep_interval_s
    if interval <= 0:
        return
    while True:
        await asyncio.sleep(interval)
        try:
            async with async_session() as db:
                result = await sweep_expired_calls(db)
                holding_result = await sweep_holding_calls(db)
                trash_result = await sweep_trashed_calls(db)
                if result["purged"]:
                    logger.info("retention sweep purged: %s", result["purged"])
                if holding_result["purged"]:
                    logger.info("holding sweep purged: %s", holding_result["purged"])
                if trash_result["purged"]:
                    logger.info("trash sweep purged: %s", trash_result["purged"])
        except Exception:  # noqa: BLE001 - the loop must survive transient errors
            logger.exception("retention sweep failed")
