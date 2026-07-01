from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Call, CallStatus, Job, JobStatus, JobType
from app.services.transcription import is_transcription_enabled

_ACTIVE = {JobStatus.PENDING, JobStatus.RUNNING}


async def sync_call_status_from_jobs(db: AsyncSession, call_id: int) -> None:
    """Derive call status from media_convert / transcribe jobs for this call."""
    result = await db.execute(select(Call).where(Call.id == call_id))
    call = result.scalar_one_or_none()
    if not call or call.status == CallStatus.RECORDING:
        return
    if call.status in (CallStatus.COMPLETED, CallStatus.FAILED):
        return

    jobs_result = await db.execute(
        select(Job).where(Job.payload["call_id"].as_integer() == call_id)
    )
    jobs = list(jobs_result.scalars().all())
    if not jobs:
        return

    if any(j.status == JobStatus.FAILED for j in jobs):
        call.status = CallStatus.FAILED
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


async def repair_stuck_transcribing_calls(db: AsyncSession) -> int:
    """Re-sync calls stuck in transcribing when transcription is unavailable."""
    if is_transcription_enabled():
        return 0

    result = await db.execute(select(Call).where(Call.status == CallStatus.TRANSCRIBING))
    calls = list(result.scalars().all())
    for call in calls:
        await sync_call_status_from_jobs(db, call.id)
    return len(calls)
