import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Job, JobStatus, JobType


def payload_hash(payload: dict) -> str:
    normalized = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(normalized.encode()).hexdigest()


async def enqueue_job(db: AsyncSession, job_type: JobType, payload: dict) -> Job | None:
    ph = payload_hash(payload)

    # One active job per (job_type, call). Duplicate ingest completes can slip
    # past the FreeSWITCH-side flock (both hangup hooks within ~0.5s), and their
    # payloads may differ slightly, so the payload hash alone is not enough.
    call_id = payload.get("call_id")
    if call_id is not None:
        active = await db.execute(
            select(Job).where(
                Job.job_type == job_type,
                Job.payload["call_id"].as_integer() == int(call_id),
                Job.status.in_((JobStatus.PENDING, JobStatus.RUNNING)),
            )
        )
        if active.scalars().first():
            return None

    existing = await db.execute(
        select(Job).where(Job.job_type == job_type, Job.payload_hash == ph, Job.status != JobStatus.FAILED)
    )
    if existing.scalars().first():
        return None

    job = Job(job_type=job_type, payload=payload, payload_hash=ph, status=JobStatus.PENDING)
    db.add(job)
    await db.flush()
    return job
