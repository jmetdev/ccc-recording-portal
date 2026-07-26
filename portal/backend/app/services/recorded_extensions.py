"""Recorded-extension matching for ingest and license enforcement."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import RecordedExtension


def normalize_extension(addr: str | None) -> str | None:
    if not addr:
        return None
    return addr.split("@")[0] if "@" in addr else addr


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


async def count_enabled_extensions(db: AsyncSession, tenant_id: int) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(RecordedExtension)
            .where(RecordedExtension.tenant_id == tenant_id, RecordedExtension.enabled.is_(True))
        )
    ).scalar_one()
