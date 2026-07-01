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
    existing = await db.execute(
        select(Job).where(Job.job_type == job_type, Job.payload_hash == ph, Job.status != JobStatus.FAILED)
    )
    if existing.scalar_one_or_none():
        return None

    job = Job(job_type=job_type, payload=payload, payload_hash=ph, status=JobStatus.PENDING)
    db.add(job)
    await db.flush()
    return job
