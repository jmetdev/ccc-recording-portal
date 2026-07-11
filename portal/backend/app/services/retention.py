"""Retention disposition sweep.

Purges calls (and their media) past each tenant's retention window, skipping
anything under legal hold. Runs as a periodic background task and on demand
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
                if result["purged"]:
                    logger.info("retention sweep purged: %s", result["purged"])
        except Exception:  # noqa: BLE001 - the loop must survive transient errors
            logger.exception("retention sweep failed")
