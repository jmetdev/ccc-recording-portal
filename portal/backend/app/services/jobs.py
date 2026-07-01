from sqlalchemy.orm import Session

from app.models import Job, JobStatus, JobType


def enqueue_media_job(db: Session, recording_id: str, path_wav: str) -> Job:
    job = Job(
        job_type=JobType.MEDIA_CONVERT,
        status=JobStatus.PENDING,
        payload={"recording_id": recording_id, "path_wav": path_wav},
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def enqueue_transcribe_job(db: Session, call_id: str, recording_id: str, leg: str, path_wav: str) -> Job:
    job = Job(
        job_type=JobType.TRANSCRIBE,
        status=JobStatus.PENDING,
        payload={
            "call_id": call_id,
            "recording_id": recording_id,
            "leg": leg,
            "path_wav": path_wav,
        },
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job
