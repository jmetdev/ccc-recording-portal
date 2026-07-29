"""User group membership helpers."""

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User, user_groups


async def set_user_groups(db: AsyncSession, user_id: int, group_ids: list[int]) -> None:
    await db.execute(delete(user_groups).where(user_groups.c.user_id == user_id))
    for group_id in group_ids:
        await db.execute(user_groups.insert().values(user_id=user_id, group_id=group_id))


async def sync_user_primary_group(db: AsyncSession, user: User, group_ids: list[int]) -> None:
    """Mirror first group into legacy users.group_id for compatibility."""
    user.group_id = group_ids[0] if group_ids else None
    await set_user_groups(db, user.id, group_ids)


async def load_user_group_ids(db: AsyncSession, user_id: int) -> list[int]:
    rows = (
        await db.execute(select(user_groups.c.group_id).where(user_groups.c.user_id == user_id))
    ).scalars().all()
    return list(rows)
