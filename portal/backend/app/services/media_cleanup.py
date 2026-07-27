"""Post-transcription media cleanup.

After Whisper finishes, playback only needs the dual-channel stereo (or mix)
file. Near/far mono legs are deleted from storage and dropped from the DB so
they do not keep consuming disk.
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Call, Recording, RecordingLeg
from app.services.storage import get_storage

logger = logging.getLogger(__name__)

_PLAYBACK_LEGS = {RecordingLeg.STEREO, RecordingLeg.MIX}
_MONO_LEGS = {RecordingLeg.NEAR, RecordingLeg.FAR}


def _has_playable_media(rec: Recording) -> bool:
    return bool(rec.media_path or rec.path_m4a or rec.path_wav)


def _delete_recording_objects(storage, rec: Recording) -> int:
    deleted = 0
    for key in (rec.media_path, rec.path_m4a, rec.path_wav):
        if not key:
            continue
        try:
            storage.delete(key)
            deleted += 1
        except Exception:  # noqa: BLE001 - keep going on media errors
            logger.warning("media_cleanup: failed to delete %s", key)
    return deleted


async def purge_near_far_mono_media(db: AsyncSession, call_id: int) -> int:
    """Remove near/far mono recordings when stereo/mix playback is available.

    Skips legal-hold calls. Idempotent when mono rows are already gone.
    Returns the number of Recording rows deleted.
    """
    call = (
        await db.execute(
            select(Call)
            .options(selectinload(Call.recordings))
            .where(Call.id == call_id)
        )
    ).scalar_one_or_none()
    if call is None:
        return 0
    if call.legal_hold:
        logger.info("media_cleanup: skip call %s (legal hold)", call_id)
        return 0

    has_playback = any(
        r.leg in _PLAYBACK_LEGS and _has_playable_media(r) for r in call.recordings
    )
    if not has_playback:
        logger.info("media_cleanup: skip call %s (no stereo/mix media yet)", call_id)
        return 0

    storage = get_storage()
    removed = 0
    for rec in list(call.recordings):
        if rec.leg not in _MONO_LEGS:
            continue
        _delete_recording_objects(storage, rec)
        await db.delete(rec)
        removed += 1

    if removed:
        logger.info("media_cleanup: purged %s near/far recording(s) for call %s", removed, call_id)
    return removed
