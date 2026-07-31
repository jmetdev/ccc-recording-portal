"""Resolve call group_id and holding flag at ingest start (UCM + WXC)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CallSource
from app.services.party_identity import looks_like_email
from app.services.recorded_extensions import group_id_for_extension, match_recorded_extension
from app.services.recorded_users import (
    group_id_for_recorded_user,
    match_recorded_user,
    portal_user_group_for_email,
)


async def resolve_ingest_group_and_holding(
    db: AsyncSession,
    *,
    tenant_id: int,
    source: CallSource,
    near_addr: str | None,
) -> tuple[int | None, bool]:
    """Return (group_id, holding) for a new call at ingest start."""
    if source == CallSource.WEBEX or looks_like_email(near_addr):
        email = (near_addr or "").strip().lower()
        if not email:
            return None, True

        recorded = await match_recorded_user(db, email, tenant_id=tenant_id)
        if recorded:
            return group_id_for_recorded_user(recorded), False

        portal_group = await portal_user_group_for_email(db, tenant_id, email)
        if portal_group is not None:
            return portal_group, False

        return None, True

    matched = await match_recorded_extension(db, near_addr, tenant_id=tenant_id)
    if matched:
        return group_id_for_extension(matched), False
    return None, True
