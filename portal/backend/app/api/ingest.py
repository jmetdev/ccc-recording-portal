from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models import Call, CallStatus, JobType, RecordedExtension, Recording, RecordingLeg
from app.schemas import IngestCompletePayload, IngestStartPayload
from app.services.live_hub import live_hub
from app.services.media_jobs import enqueue_job

router = APIRouter(prefix="/ingest", tags=["ingest"])


def verify_ingest_token(x_ingest_token: str | None = Header(default=None)):
    if x_ingest_token != settings.ingest_token:
        raise HTTPException(status_code=401, detail="Invalid ingest token")


async def resolve_group_id(db: AsyncSession, near_addr: str | None, far_addr: str | None) -> int | None:
    for addr in (near_addr, far_addr):
        if not addr:
            continue
        ext = addr.split("@")[0] if "@" in addr else addr
        result = await db.execute(
            select(RecordedExtension).where(RecordedExtension.extension == ext, RecordedExtension.enabled.is_(True))
        )
        row = result.scalar_one_or_none()
        if row:
            return row.group_id
    return None


@router.post("/start", dependencies=[Depends(verify_ingest_token)])
async def ingest_start(payload: IngestStartPayload, db: AsyncSession = Depends(get_db)):
    existing = await db.execute(select(Call).where(Call.refci == payload.refci, Call.status == CallStatus.RECORDING))
    if existing.scalar_one_or_none():
        return {"status": "already_recording", "refci": payload.refci}

    group_id = await resolve_group_id(db, payload.near_addr, payload.far_addr)
    call = Call(
        refci=payload.refci,
        session_id=payload.session,
        guid=payload.guid,
        near_addr=payload.near_addr,
        far_addr=payload.far_addr,
        near_name=payload.near_name,
        far_name=payload.far_name,
        direction=payload.direction,
        status=CallStatus.RECORDING,
        group_id=group_id,
    )
    db.add(call)
    await db.commit()
    await db.refresh(call)

    await live_hub.broadcast({"event": "call_started", "call_id": call.id, "refci": call.refci})
    return {"status": "ok", "call_id": call.id}


@router.post("/complete", dependencies=[Depends(verify_ingest_token)])
async def ingest_complete(payload: IngestCompletePayload, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Call).where(Call.refci == payload.refci).order_by(Call.id.desc()))
    call = result.scalars().first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    now = datetime.now(timezone.utc)
    call.status = CallStatus.COMPLETED
    call.ended_at = now
    if payload.duration_s is not None:
        call.duration_s = payload.duration_s
    elif call.started_at:
        call.duration_s = max(0.0, (now - call.started_at).total_seconds())

    leg_map = {"near": RecordingLeg.NEAR, "far": RecordingLeg.FAR, "stereo": RecordingLeg.STEREO}
    recording_ids: dict[str, int] = {}

    for leg_name, rel_path in payload.files.items():
        leg = leg_map.get(leg_name.lower())
        if not leg:
            continue
        rec = Recording(call_id=call.id, leg=leg, path_wav=rel_path)
        db.add(rec)
        await db.flush()
        recording_ids[leg_name] = rec.id

    await enqueue_job(
        db,
        JobType.MEDIA_CONVERT,
        {"call_id": call.id, "recording_ids": recording_ids, "paths": payload.files},
    )
    await enqueue_job(
        db,
        JobType.TRANSCRIBE,
        {"call_id": call.id, "recording_ids": recording_ids, "paths": payload.files},
    )

    await db.commit()
    await live_hub.broadcast({"event": "call_completed", "call_id": call.id, "refci": call.refci})
    return {"status": "ok", "call_id": call.id, "recording_ids": recording_ids}
