"""Connector-facing ingest API (v2).

Authenticated by per-tenant connector credentials (``Authorization: Bearer
ccck_...`` or ``X-Connector-Token``). This is the single contract both the
on-prem CUCM connector and the hosted Webex connector speak: register call
metadata, upload connector-finished media, attach transcripts, heartbeat.

Unlike v1, no transcode/whisper jobs are enqueued when the connector reports
``processed`` media — the CUCM connector runs ffmpeg/Whisper on customer
hardware, and Webex media arrives already encoded with a transcript.
"""

import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Form, Header, HTTPException, UploadFile
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.core.database import get_db, set_tenant_context
from app.core.security import hash_connector_token
from app.models import (
    Call,
    CallSource,
    CallStatus,
    ConnectorCredential,
    JobType,
    Recording,
    RecordingLeg,
    Tenant,
    Transcript,
    TranscriptSource,
)
from app.schemas import (
    ConnectorHeartbeat,
    V2CallComplete,
    V2CallFail,
    V2CallStart,
    V2TranscriptCreate,
)
from app.services.live_hub import live_hub
from app.services.media_jobs import enqueue_job
from app.services.storage import connector_media_key, get_storage
from app.services.transcription import is_transcription_enabled

router = APIRouter(prefix="/v2", tags=["ingest-v2"])
logger = logging.getLogger(__name__)

MIME_BY_EXT = {
    "mp3": "audio/mpeg",
    "m4a": "audio/mp4",
    "wav": "audio/wav",
    "ogg": "audio/ogg",
}


async def get_connector(
    db: AsyncSession = Depends(get_db),
    authorization: str | None = Header(default=None),
    x_connector_token: str | None = Header(default=None),
) -> ConnectorCredential:
    token = x_connector_token
    if not token and authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing connector token")

    result = await db.execute(
        select(ConnectorCredential)
        .join(Tenant, ConnectorCredential.tenant_id == Tenant.id)
        .where(
            ConnectorCredential.token_hash == hash_connector_token(token),
            ConnectorCredential.enabled.is_(True),
            Tenant.is_active.is_(True),
        )
    )
    cred = result.scalar_one_or_none()
    if cred is None:
        raise HTTPException(status_code=401, detail="Invalid connector token")
    await set_tenant_context(db, cred.tenant_id)
    return cred


async def _find_call(
    db: AsyncSession, tenant_id: int, refci: str | None, external_id: str | None
) -> Call | None:
    if external_id:
        result = await db.execute(
            select(Call)
            .where(Call.tenant_id == tenant_id, Call.external_id == external_id)
            .order_by(Call.id.desc())
        )
        call = result.scalars().first()
        if call:
            return call
    if refci:
        result = await db.execute(
            select(Call)
            .where(Call.tenant_id == tenant_id, Call.refci == refci)
            .order_by(Call.id.desc())
        )
        return result.scalars().first()
    return None


@router.post("/ingest/calls/start")
async def v2_call_start(
    payload: V2CallStart,
    cred: ConnectorCredential = Depends(get_connector),
    db: AsyncSession = Depends(get_db),
):
    lock_key = abs(hash(f"{cred.tenant_id}:{payload.refci}")) % (2**31)
    await db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})

    existing = await _find_call(db, cred.tenant_id, payload.refci, payload.external_id)
    if existing and existing.status == CallStatus.RECORDING:
        return {"status": "already_recording", "call_id": existing.id}
    if existing and payload.external_id and existing.external_id == payload.external_id:
        # Cloud connectors replay their cursor after restarts; dedup on the
        # upstream id so a re-poll never creates a second call.
        return {"status": "duplicate", "call_id": existing.id}

    call = Call(
        tenant_id=cred.tenant_id,
        refci=payload.refci,
        session_id=payload.session,
        guid=payload.guid,
        external_id=payload.external_id,
        source=CallSource(payload.source),
        near_addr=payload.near_addr,
        far_addr=payload.far_addr,
        near_name=payload.near_name,
        far_name=payload.far_name,
        direction=payload.direction,
        status=CallStatus.RECORDING,
    )
    if payload.started_at:
        call.started_at = payload.started_at
    db.add(call)
    await db.commit()
    await db.refresh(call)
    await live_hub.broadcast(
        {"event": "call_started", "call_id": call.id, "refci": call.refci}, cred.tenant_id
    )
    return {"status": "ok", "call_id": call.id}


@router.post("/ingest/calls/complete")
async def v2_call_complete(
    payload: V2CallComplete,
    cred: ConnectorCredential = Depends(get_connector),
    db: AsyncSession = Depends(get_db),
):
    call = await _find_call(db, cred.tenant_id, payload.refci, payload.external_id)
    if call is None:
        raise HTTPException(status_code=404, detail="Call not found")

    now = datetime.now(timezone.utc)
    if call.status not in (CallStatus.COMPLETED, CallStatus.FAILED):
        call.status = CallStatus.COMPLETED if payload.processed else CallStatus.PROCESSING
        call.ended_at = payload.ended_at or now
    if payload.duration_s is not None:
        call.duration_s = payload.duration_s

    if not payload.processed:
        recordings = (
            await db.execute(select(Recording).where(Recording.call_id == call.id))
        ).scalars().all()
        paths = {r.leg.value: r.path_wav for r in recordings if r.path_wav}
        recording_ids = {r.leg.value: r.id for r in recordings}
        await enqueue_job(
            db,
            JobType.MEDIA_CONVERT,
            {"call_id": call.id, "recording_ids": recording_ids, "paths": paths},
            tenant_id=cred.tenant_id,
        )
        if is_transcription_enabled():
            await enqueue_job(
                db,
                JobType.TRANSCRIBE,
                {"call_id": call.id, "recording_ids": recording_ids, "paths": paths},
                tenant_id=cred.tenant_id,
            )

    await db.commit()
    await live_hub.broadcast(
        {"event": "call_completed", "call_id": call.id, "refci": call.refci}, cred.tenant_id
    )
    return {"status": "ok", "call_id": call.id}


@router.post("/ingest/calls/{call_id}/media")
async def v2_upload_media(
    call_id: int,
    file: UploadFile,
    leg: str = Form("mix"),
    mime: str | None = Form(None),
    duration_s: float | None = Form(None),
    sample_rate: int | None = Form(None),
    channels: int | None = Form(None),
    peaks: str | None = Form(None),
    cred: ConnectorCredential = Depends(get_connector),
    db: AsyncSession = Depends(get_db),
):
    call = (
        await db.execute(
            select(Call).where(Call.id == call_id, Call.tenant_id == cred.tenant_id)
        )
    ).scalar_one_or_none()
    if call is None:
        raise HTTPException(status_code=404, detail="Call not found")

    try:
        rec_leg = RecordingLeg(leg.lower())
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown leg: {leg}") from None

    filename = file.filename or "media.bin"
    key = connector_media_key(cred.tenant_id, call.id, rec_leg.value, filename)
    storage = get_storage()
    size = await run_in_threadpool(storage.save_stream, key, file.file)

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    media_mime = mime or MIME_BY_EXT.get(ext, "application/octet-stream")

    peaks_json = None
    if peaks:
        try:
            peaks_json = json.loads(peaks)
        except json.JSONDecodeError:
            raise HTTPException(status_code=422, detail="peaks must be JSON") from None

    existing = (
        await db.execute(
            select(Recording).where(Recording.call_id == call.id, Recording.leg == rec_leg)
        )
    ).scalar_one_or_none()
    rec = existing or Recording(tenant_id=cred.tenant_id, call_id=call.id, leg=rec_leg)
    rec.media_path = key
    rec.media_mime = media_mime
    rec.bytes = size
    if sample_rate is not None:
        rec.sample_rate = sample_rate
    if channels is not None:
        rec.channels = channels
    if peaks_json is not None:
        rec.peaks_json = peaks_json
    if existing is None:
        db.add(rec)
    if duration_s is not None and call.duration_s is None:
        call.duration_s = duration_s
    await db.commit()
    await db.refresh(rec)
    return {"status": "ok", "recording_id": rec.id, "media_path": key, "bytes": size}


@router.post("/ingest/calls/{call_id}/transcript")
async def v2_create_transcript(
    call_id: int,
    payload: V2TranscriptCreate,
    cred: ConnectorCredential = Depends(get_connector),
    db: AsyncSession = Depends(get_db),
):
    call = (
        await db.execute(
            select(Call).where(Call.id == call_id, Call.tenant_id == cred.tenant_id)
        )
    ).scalar_one_or_none()
    if call is None:
        raise HTTPException(status_code=404, detail="Call not found")

    try:
        rec_leg = RecordingLeg(payload.leg.lower())
        source = TranscriptSource(payload.source)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

    from sqlalchemy import delete

    await db.execute(
        delete(Transcript).where(Transcript.call_id == call.id, Transcript.leg == rec_leg)
    )
    transcript = Transcript(
        tenant_id=cred.tenant_id,
        call_id=call.id,
        leg=rec_leg,
        source=source,
        language=payload.language,
        text=payload.text,
        segments_json=payload.segments_json,
        sentiment=payload.sentiment,
        sentiment_score=payload.sentiment_score,
    )
    db.add(transcript)
    await db.flush()
    await db.execute(
        update(Transcript)
        .where(Transcript.id == transcript.id)
        .values(search_tsv=func.to_tsvector("english", payload.text))
    )
    await db.commit()
    return {"status": "ok", "transcript_id": transcript.id}


@router.get("/ingest/calls/untranscribed")
async def v2_list_untranscribed(
    limit: int = 50,
    cred: ConnectorCredential = Depends(get_connector),
    db: AsyncSession = Depends(get_db),
):
    """Completed calls of this connector's source that have no transcript yet.

    Lets a connector backfill transcripts for calls ingested before transcript
    delivery was wired up (e.g. Webex VTT), or retry ones whose VTT link had
    expired. ``external_id`` is the connector's own recording id (echoed back
    from ``calls/start``) so the connector can re-fetch source-side detail.
    """
    source = CallSource(cred.kind.value)
    transcribed_call_ids = select(Transcript.call_id).where(Transcript.tenant_id == cred.tenant_id)
    result = await db.execute(
        select(Call.id, Call.refci, Call.external_id)
        .where(
            Call.tenant_id == cred.tenant_id,
            Call.source == source,
            Call.status == CallStatus.COMPLETED,
            Call.external_id.is_not(None),
            Call.id.not_in(transcribed_call_ids),
        )
        .order_by(Call.started_at.desc())
        .limit(min(limit, 200))
    )
    return {
        "items": [
            {"call_id": row.id, "refci": row.refci, "external_id": row.external_id}
            for row in result.all()
        ]
    }


@router.post("/ingest/calls/fail")
async def v2_call_fail(
    payload: V2CallFail,
    cred: ConnectorCredential = Depends(get_connector),
    db: AsyncSession = Depends(get_db),
):
    call = await _find_call(db, cred.tenant_id, payload.refci, payload.external_id)
    if call is None or call.status not in (CallStatus.RECORDING, CallStatus.PROCESSING):
        return {"status": "ignored"}
    now = datetime.now(timezone.utc)
    call.status = CallStatus.FAILED
    call.status_message = f"Connector: {payload.reason or 'reported failure'}"
    call.ended_at = now
    if payload.duration_s is not None:
        call.duration_s = max(0.0, payload.duration_s)
    elif call.started_at:
        call.duration_s = max(0.0, (now - call.started_at).total_seconds())
    await db.commit()
    await live_hub.broadcast(
        {"event": "call_completed", "call_id": call.id, "refci": call.refci}, cred.tenant_id
    )
    return {"status": "ok", "call_id": call.id}


@router.post("/connector/heartbeat")
async def v2_heartbeat(
    payload: ConnectorHeartbeat,
    cred: ConnectorCredential = Depends(get_connector),
    db: AsyncSession = Depends(get_db),
):
    cred.last_seen_at = datetime.now(timezone.utc)
    if payload.version:
        cred.version = payload.version
    if payload.stats is not None:
        cred.stats_json = payload.stats
    await db.commit()
    return {"status": "ok"}
