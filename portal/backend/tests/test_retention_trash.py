"""Unit tests for trash retention purge semantics."""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.services.retention import TRASH_RETENTION_DAYS, sweep_trashed_calls


def test_trash_retention_window_is_30_days():
    assert TRASH_RETENTION_DAYS == 30


class _Scalars:
    def __init__(self, items):
        self._items = items

    def all(self):
        return self._items


class _Result:
    def __init__(self, items=None, one=None):
        self._items = items or []
        self._one = one

    def scalars(self):
        return _Scalars(self._items)

    def scalar_one(self):
        return self._one


def test_sweep_trashed_calls_purges_expired():
    now = datetime.now(timezone.utc)
    expired = SimpleNamespace(
        id=1,
        tenant_id=10,
        refci="ref-expired",
        started_at=now - timedelta(days=60),
        trashed_at=now - timedelta(days=TRASH_RETENTION_DAYS + 1),
        legal_hold=False,
        recordings=[],
    )
    tenant = SimpleNamespace(id=10, slug="acme")

    db = AsyncMock()
    db.execute = AsyncMock(side_effect=[_Result([expired]), _Result(one=tenant)])
    db.delete = AsyncMock()
    db.commit = AsyncMock()

    with (
        patch("app.services.retention.get_storage", return_value=MagicMock()),
        patch("app.services.retention.purge_call_media", return_value=2) as purge_media,
        patch("app.services.retention.record_audit", new_callable=AsyncMock) as audit,
    ):
        result = asyncio.run(sweep_trashed_calls(db))

    assert result == {"purged": {"acme": 1}}
    purge_media.assert_called_once()
    audit.assert_awaited_once()
    assert audit.await_args.kwargs["action"] == "retention.trash_purge"
    assert audit.await_args.kwargs["resource_id"] == 1
    db.delete.assert_awaited_once_with(expired)
    db.commit.assert_awaited_once()


def test_sweep_trashed_calls_noop_when_empty():
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_Result([]))
    db.commit = AsyncMock()

    with (
        patch("app.services.retention.get_storage", return_value=MagicMock()),
        patch("app.services.retention.purge_call_media") as purge_media,
        patch("app.services.retention.record_audit", new_callable=AsyncMock) as audit,
    ):
        result = asyncio.run(sweep_trashed_calls(db))

    assert result == {"purged": {}}
    purge_media.assert_not_called()
    audit.assert_not_awaited()
    db.commit.assert_awaited_once()
