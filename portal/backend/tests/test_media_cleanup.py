"""Unit tests for near/far mono cleanup after transcription."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from app.models import RecordingLeg
from app.services.media_cleanup import purge_near_far_mono_media


class _Result:
    def __init__(self, one=None):
        self._one = one

    def scalar_one_or_none(self):
        return self._one


def test_purge_near_far_deletes_mono_when_stereo_playable():
    near = SimpleNamespace(
        leg=RecordingLeg.NEAR,
        media_path="tenants/1/calls/1/near.m4a",
        path_m4a=None,
        path_wav="near.wav",
    )
    far = SimpleNamespace(
        leg=RecordingLeg.FAR,
        media_path="tenants/1/calls/1/far.m4a",
        path_m4a=None,
        path_wav="far.wav",
    )
    stereo = SimpleNamespace(
        leg=RecordingLeg.STEREO,
        media_path="tenants/1/calls/1/stereo.m4a",
        path_m4a=None,
        path_wav="stereo.wav",
    )
    call = SimpleNamespace(
        id=1,
        legal_hold=False,
        recordings=[near, far, stereo],
    )
    storage = MagicMock()
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_Result(one=call))
    db.delete = AsyncMock()

    with patch("app.services.media_cleanup.get_storage", return_value=storage):
        removed = asyncio.run(purge_near_far_mono_media(db, 1))

    assert removed == 2
    assert db.delete.await_count == 2
    deleted_keys = {c.args[0] for c in storage.delete.call_args_list}
    assert "tenants/1/calls/1/near.m4a" in deleted_keys
    assert "tenants/1/calls/1/far.m4a" in deleted_keys
    assert "near.wav" in deleted_keys
    assert "far.wav" in deleted_keys
    assert "tenants/1/calls/1/stereo.m4a" not in deleted_keys


def test_purge_near_far_skips_legal_hold():
    call = SimpleNamespace(
        id=2,
        legal_hold=True,
        recordings=[
            SimpleNamespace(
                leg=RecordingLeg.NEAR,
                media_path="n.m4a",
                path_m4a=None,
                path_wav=None,
            ),
            SimpleNamespace(
                leg=RecordingLeg.STEREO,
                media_path="s.m4a",
                path_m4a=None,
                path_wav=None,
            ),
        ],
    )
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_Result(one=call))
    storage = MagicMock()

    with patch("app.services.media_cleanup.get_storage", return_value=storage):
        removed = asyncio.run(purge_near_far_mono_media(db, 2))

    assert removed == 0
    storage.delete.assert_not_called()
    db.delete.assert_not_awaited()


def test_purge_near_far_skips_without_stereo():
    call = SimpleNamespace(
        id=3,
        legal_hold=False,
        recordings=[
            SimpleNamespace(
                leg=RecordingLeg.NEAR,
                media_path="n.m4a",
                path_m4a=None,
                path_wav=None,
            ),
            SimpleNamespace(
                leg=RecordingLeg.FAR,
                media_path="f.m4a",
                path_m4a=None,
                path_wav=None,
            ),
        ],
    )
    db = AsyncMock()
    db.execute = AsyncMock(return_value=_Result(one=call))
    storage = MagicMock()

    with patch("app.services.media_cleanup.get_storage", return_value=storage):
        removed = asyncio.run(purge_near_far_mono_media(db, 3))

    assert removed == 0
    storage.delete.assert_not_called()
    db.delete.assert_not_awaited()
