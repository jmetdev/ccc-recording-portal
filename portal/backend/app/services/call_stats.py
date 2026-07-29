"""Canonical call-counting.

Duplicate Call rows can exist from concurrent ingest/start, so a raw
``COUNT(*)`` over-counts. Every page that reports a "calls" number (Overview,
Recordings, Storage) counts one row per ``refci`` via this helper so the
figures agree with each other.
"""

from sqlalchemy import and_, func, select

from app.models import Call, User
from app.services.call_visibility import CallVisibilityScope, append_visibility_scope


def distinct_call_count_stmt(
    tenant_id: int,
    scope: CallVisibilityScope,
    user: User,
    *extra_filters,
):
    filters = [Call.tenant_id == tenant_id, *extra_filters]
    append_visibility_scope(filters, scope, user)
    deduped_ids = select(Call.id).where(and_(*filters)).distinct(Call.refci).subquery()
    return select(func.count()).select_from(deduped_ids)
