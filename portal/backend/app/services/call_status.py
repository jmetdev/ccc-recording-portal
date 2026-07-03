from datetime import datetime, timezone, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Call, CallStatus, Job, JobStatus, JobType
from app.services.transcription import is_transcription_enabled

_ACTIVE = {JobStatus.PENDING, JobStatus.RUNNING}
_STUCK_RECORDING_AFTER = timedelta(minutes=1)


async def sync_call_status_from_jobs(db: AsyncSession, call_id: int) -> None:
    """Derive call status from media_convert / transcribe jobs for this call."""
    result = await db.execute(select(Call).where(Call.id == call_id))
    call = result.scalar_one_or_none()
    if not call or call.status == CallStatus.RECORDING:
        return
    if call.status == CallStatus.COMPLETED:
        return
    # FAILED is not terminal here: if ingest completes late (hangup hook re-run
    # after a stuck-recording repair) and the jobs finish, the call recovers.

    jobs_result = await db.execute(
        select(Job).where(Job.payload["call_id"].as_integer() == call_id)
    )
    jobs = list(jobs_result.scalars().all())
    if not jobs:
        return

    if any(j.status == JobStatus.FAILED for j in jobs):
        failed = [j for j in jobs if j.status == JobStatus.FAILED]
        call.status = CallStatus.FAILED
        call.status_message = "; ".join(
            f"{j.job_type.value}: {j.error or 'unknown error'}" for j in failed
        )
        return

    media = next((j for j in jobs if j.job_type == JobType.MEDIA_CONVERT), None)
    transcribe = next((j for j in jobs if j.job_type == JobType.TRANSCRIBE), None)

    if not is_transcription_enabled():
        if media and media.status in _ACTIVE:
            call.status = CallStatus.PROCESSING
        elif media and media.status == JobStatus.COMPLETED:
            call.status = CallStatus.COMPLETED
        return

    if media and media.status in _ACTIVE:
        call.status = CallStatus.PROCESSING
    elif transcribe and transcribe.status in _ACTIVE:
        call.status = CallStatus.TRANSCRIBING
    elif all(j.status == JobStatus.COMPLETED for j in jobs):
        call.status = CallStatus.COMPLETED
        call.status_message = None


async def repair_stuck_transcribing_calls(db: AsyncSession) -> int:
    """Re-sync calls stuck in transcribing when transcription is unavailable."""
    if is_transcription_enabled():
        return 0

    result = await db.execute(select(Call).where(Call.status == CallStatus.TRANSCRIBING))
    calls = list(result.scalars().all())
    for call in calls:
        await sync_call_status_from_jobs(db, call.id)
    return len(calls)


async def repair_stuck_recording_calls(db: AsyncSession) -> int:
    """Mark long-idle recording calls as failed (hangup hook missed or no WAV)."""
    cutoff = datetime.now(timezone.utc) - _STUCK_RECORDING_AFTER
    result = await db.execute(
        select(Call).where(Call.status == CallStatus.RECORDING, Call.started_at < cutoff)
    )
    calls = list(result.scalars().all())
    now = datetime.now(timezone.utc)
    for call in calls:
        call.status = CallStatus.FAILED
        call.ended_at = now
        call.status_message = "Recording timed out without hangup completion (no ingest complete received)"
        if call.started_at:
            call.duration_s = max(0.0, (now - call.started_at).total_seconds())
    return len(calls)
