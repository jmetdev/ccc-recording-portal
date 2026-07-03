import os
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models import Job, JobStatus, JobType
from app.schemas import JobClaim, JobComplete, RecordingUpdate, TranscriptCreate
from app.services.call_status import sync_call_status_from_jobs

router = APIRouter(prefix="/workers", tags=["workers"])


def verify_worker_token(x_worker_token: str | None = Header(default=None)):
    if x_worker_token != settings.worker_token:
        raise HTTPException(status_code=401, detail="Invalid worker token")


@router.post("/jobs/claim", response_model=JobClaim | None, dependencies=[Depends(verify_worker_token)])
async def claim_job(
    job_type: JobType,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Job)
        .where(Job.job_type == job_type, Job.status == JobStatus.PENDING)
        .order_by(Job.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    job = result.scalar_one_or_none()
    if not job:
        return None
    job.status = JobStatus.RUNNING
    job.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return JobClaim(id=job.id, job_type=job.job_type.value, payload=job.payload)


@router.post("/jobs/{job_id}/complete", dependencies=[Depends(verify_worker_token)])
async def complete_job(job_id: int, body: JobComplete, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    job.status = JobStatus.FAILED if body.error else JobStatus.COMPLETED
    job.result = body.result
    job.error = body.error
    job.updated_at = datetime.now(timezone.utc)

    call_id = job.payload.get("call_id")
    if call_id is not None:
        await sync_call_status_from_jobs(db, int(call_id))

    await db.commit()
    return {"status": "ok"}


@router.patch("/recordings/{recording_id}", dependencies=[Depends(verify_worker_token)])
async def update_recording(recording_id: int, body: RecordingUpdate, db: AsyncSession = Depends(get_db)):
    from app.models import Recording

    result = await db.execute(select(Recording).where(Recording.id == recording_id))
    rec = result.scalar_one_or_none()
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(rec, field, value)
    await db.commit()
    return {"status": "ok"}


@router.post("/transcripts", dependencies=[Depends(verify_worker_token)])
async def create_transcript(body: TranscriptCreate, db: AsyncSession = Depends(get_db)):
    from sqlalchemy import delete

    from app.models import RecordingLeg, Transcript

    leg = RecordingLeg(body.leg)
    # Upsert per (call, leg): a re-run job replaces the transcript instead of
    # accumulating duplicates.
    await db.execute(
        delete(Transcript).where(Transcript.call_id == body.call_id, Transcript.leg == leg)
    )
    transcript = Transcript(
        call_id=body.call_id,
        leg=leg,
        language=body.language,
        text=body.text,
        segments_json=body.segments_json,
        sentiment=body.sentiment,
        sentiment_score=body.sentiment_score,
        embedding=body.embedding,
    )
    db.add(transcript)
    await db.flush()
    await db.execute(
        update(Transcript)
        .where(Transcript.id == transcript.id)
        .values(search_tsv=func.to_tsvector("english", body.text))
    )
    await db.commit()
    return {"status": "ok", "id": transcript.id}


@router.get("/recordings/path", dependencies=[Depends(verify_worker_token)])
async def resolve_recording_path(path: str = Query(...)):
    full = os.path.join(settings.recordings_dir, path.lstrip("/"))
    if not os.path.isfile(full):
        raise HTTPException(status_code=404, detail="File not found")
    return {"full_path": full}
