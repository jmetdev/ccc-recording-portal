"""Recorded-user matching for WXC ingest and license enforcement."""

from __future__ import annotations

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Call, RecordedUser, User
from app.services.call_visibility import user_group_ids


from app.services.party_identity import normalize_email


async def match_recorded_user(
    db: AsyncSession, near_addr: str | None, *, tenant_id: int | None = None
) -> RecordedUser | None:
    email = normalize_email(near_addr)
    if not email:
        return None
    stmt = (
        select(RecordedUser)
        .options(selectinload(RecordedUser.groups))
        .where(RecordedUser.email == email, RecordedUser.enabled.is_(True))
    )
    if tenant_id is not None:
        stmt = stmt.where(RecordedUser.tenant_id == tenant_id)
    return (await db.execute(stmt)).scalar_one_or_none()


def group_id_for_recorded_user(user: RecordedUser | None) -> int | None:
    if user and user.groups:
        return user.groups[0].id
    return None


async def portal_user_group_for_email(
    db: AsyncSession, tenant_id: int, email: str
) -> int | None:
    row = (
        await db.execute(
            select(User)
            .options(selectinload(User.groups))
            .where(User.tenant_id == tenant_id, func.lower(User.email) == email.lower())
        )
    ).scalar_one_or_none()
    if row is None:
        return None
    group_ids = user_group_ids(row)
    return group_ids[0] if group_ids else None


async def release_holding_calls_for_email(
    db: AsyncSession,
    *,
    tenant_id: int,
    email: str,
    group_id: int | None = None,
) -> int:
    """Clear holding on WXC calls whose near_addr matches this owner email."""
    normalized = normalize_email(email)
    if not normalized:
        return 0

    calls = (
        await db.execute(
            select(Call).where(
                Call.tenant_id == tenant_id,
                Call.holding.is_(True),
                func.lower(Call.near_addr) == normalized,
            )
        )
    ).scalars().all()

    for call in calls:
        call.holding = False
        if group_id is not None:
            call.group_id = group_id
    return len(calls)


async def count_enabled_recorded_users(db: AsyncSession, tenant_id: int) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(RecordedUser)
            .where(RecordedUser.tenant_id == tenant_id, RecordedUser.enabled.is_(True))
        )
    ).scalar_one()
