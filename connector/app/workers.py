"""Worker-facing endpoints for the on-prem whisper container."""

from __future__ import annotations

import json
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel, Field

from app import spool
from app.config import config
from app.portal import PortalClient

logger = logging.getLogger("connector.workers")
router = APIRouter(prefix="/api/workers", tags=["workers"])


def _require_worker(x_worker_token: str | None = Header(default=None)) -> None:
    expected = config.WORKER_TOKEN or config.INGEST_TOKEN
    if not expected or x_worker_token != expected:
        raise HTTPException(status_code=401, detail="bad worker token")


class JobCompleteIn(BaseModel):
    result: dict | None = None
    error: str | None = None


class TranscriptIn(BaseModel):
    call_id: int
    leg: str
    language: str | None = None
    text: str
    segments_json: list = Field(default_factory=list)
    sentiment: str | None = None
    sentiment_score: float | None = None


@router.post("/jobs/claim", dependencies=[Depends(_require_worker)])
def claim_job(job_type: str = Query("transcribe")):
    if job_type != "transcribe":
        raise HTTPException(status_code=400, detail="only job_type=transcribe is supported")
    job = spool.claim_due(kinds=("transcribe",))
    if job is None:
        return None
    return {
        "id": job["id"],
        "job_type": job["kind"],
        "payload": json.loads(job["payload_json"]),
    }


@router.post("/jobs/{job_id}/complete", dependencies=[Depends(_require_worker)])
def complete_job(job_id: int, body: JobCompleteIn):
    if body.error:
        attempts_row = spool.get_job(job_id)
        attempts = (attempts_row["attempts"] + 1) if attempts_row else 1
        logger.warning("transcribe job %s failed: %s (attempt %s)", job_id, body.error, attempts)
        if attempts >= 5:
            spool.mark_done(job_id)
            return {"status": "abandoned"}
        spool.mark_retry(job_id, attempts)
        return {"status": "retry"}
    spool.mark_done(job_id)
    return {"status": "ok", "result": body.result}


@router.post("/transcripts", dependencies=[Depends(_require_worker)])
def create_transcript(body: TranscriptIn):
    # Fresh client per call is fine — whisper posts infrequently.
    PortalClient().create_transcript(
        body.call_id,
        body.leg,
        body.text,
        body.segments_json,
        body.language,
        body.sentiment,
        body.sentiment_score,
    )
    return {"status": "ok"}
