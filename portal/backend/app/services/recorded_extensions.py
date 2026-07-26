"""Recorded-extension matching for ingest and license enforcement."""

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Call, RecordedExtension


def normalize_extension(addr: str | None) -> str | None:
    if not addr:
        return None
    return addr.split("@")[0] if "@" in addr else addr


def near_addr_matches_extension(near_addr: str | None, extension: str) -> bool:
    """True when a call's near-end matches a recorded DN (bare or user@host)."""
    ext = normalize_extension(extension)
    if not ext or not near_addr:
        return False
    return near_addr == ext or near_addr.startswith(f"{ext}@")


async def match_recorded_extension(
    db: AsyncSession, near_addr: str | None, *, tenant_id: int | None = None
) -> RecordedExtension | None:
    """Return the enabled recorded extension for the near-end DN, if any."""
    ext = normalize_extension(near_addr)
    if not ext:
        return None
    stmt = (
        select(RecordedExtension)
        .options(selectinload(RecordedExtension.groups))
        .where(RecordedExtension.extension == ext, RecordedExtension.enabled.is_(True))
    )
    if tenant_id is not None:
        stmt = stmt.where(RecordedExtension.tenant_id == tenant_id)
    return (await db.execute(stmt)).scalar_one_or_none()


def group_id_for_extension(ext: RecordedExtension | None) -> int | None:
    if ext and ext.groups:
        return ext.groups[0].id
    return None


async def release_holding_calls_for_extension(
    db: AsyncSession,
    *,
    tenant_id: int,
    extension: str,
    group_id: int | None = None,
) -> int:
    """Clear the holding flag on calls whose near-end matches this DN.

    Calls ingested while the DN was unconfigured sit in the 7-day holding pool.
    Configuring (creating/enabling) an extension rematches those calls so they
    follow the tenant retention policy instead.
    """
    ext = normalize_extension(extension)
    if not ext:
        return 0

    calls = (
        await db.execute(
            select(Call).where(
                Call.tenant_id == tenant_id,
                Call.holding.is_(True),
                or_(Call.near_addr == ext, Call.near_addr.like(f"{ext}@%")),
            )
        )
    ).scalars().all()

    for call in calls:
        call.holding = False
        if group_id is not None:
            call.group_id = group_id
    return len(calls)


async def count_enabled_extensions(db: AsyncSession, tenant_id: int) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(RecordedExtension)
            .where(RecordedExtension.tenant_id == tenant_id, RecordedExtension.enabled.is_(True))
        )
    ).scalar_one()
