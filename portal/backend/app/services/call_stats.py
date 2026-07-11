"""Canonical call-counting.

Duplicate Call rows can exist from concurrent ingest/start, so a raw
``COUNT(*)`` over-counts. Every page that reports a "calls" number (Overview,
Recordings, Storage) counts one row per ``refci`` via this helper so the
figures agree with each other.
"""

from sqlalchemy import and_, func, select

from app.models import Call


def distinct_call_count_stmt(tenant_id: int, group_id: int | None, *extra_filters):
    filters = [Call.tenant_id == tenant_id, *extra_filters]
    if group_id is not None:
        filters.append(Call.group_id == group_id)
    deduped_ids = select(Call.id).where(and_(*filters)).distinct(Call.refci).subquery()
    return select(func.count()).select_from(deduped_ids)
