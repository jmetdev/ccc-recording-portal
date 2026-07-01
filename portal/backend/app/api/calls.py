from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import can_view_call, get_current_user, require_permission, scoped_call_filter, user_permissions
from app.models import Call, CallStatus, Permission, RecordedExtension, Recording, RecordingLeg, Tag, Transcript
from app.schemas import (
    CallListResponse,
    CallOut,
    DashboardStats,
    LiveChannelOut,
    PeaksOut,
    RecordingOut,
    TagCreate,
    TagOut,
    TranscriptOut,
    TranscriptSearchResult,
)
from app.services.freeswitch import list_active_recording_channels

router = APIRouter(tags=["calls"])


def call_sentiment(call: Call) -> str | None:
    sentiments = [t.sentiment for t in call.transcripts if t.sentiment]
    return sentiments[0] if sentiments else None


@router.get("/dashboard/stats", response_model=DashboardStats)
async def dashboard_stats(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group_id = await scoped_call_filter(user)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    def call_filter(stmt):
        if group_id is not None:
            return stmt.where(Call.group_id == group_id)
        return stmt

    calls_today = (
        await db.execute(call_filter(select(func.count()).select_from(Call).where(Call.started_at >= today)))
    ).scalar_one()
    calls_total = (await db.execute(call_filter(select(func.count()).select_from(Call)))).scalar_one()
    fs_channels = await list_active_recording_channels()
    recording_now = len(fs_channels) if fs_channels or settings.freeswitch_fs_cli.strip() else (
        await db.execute(
            call_filter(select(func.count()).select_from(Call).where(Call.status == CallStatus.RECORDING))
        )
    ).scalar_one()
    extensions_enabled = (
        await db.execute(select(func.count()).select_from(RecordedExtension).where(RecordedExtension.enabled.is_(True)))
    ).scalar_one()

    return DashboardStats(
        calls_today=calls_today,
        calls_total=calls_total,
        recording_now=recording_now,
        extensions_enabled=extensions_enabled,
    )


@router.get("/calls/live", response_model=list[CallOut])
async def live_calls(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    group_id = await scoped_call_filter(user)
    stmt = select(Call).where(Call.status == CallStatus.RECORDING).order_by(Call.started_at.desc())
    if group_id is not None:
        stmt = stmt.where(Call.group_id == group_id)
    result = await db.execute(stmt.options(selectinload(Call.transcripts)))
    calls = result.scalars().all()
    return [
        CallOut.model_validate(c, from_attributes=True).model_copy(update={"sentiment": call_sentiment(c)})
        for c in calls
    ]


@router.get("/freeswitch/live-channels", response_model=list[LiveChannelOut])
async def freeswitch_live_channels(user=Depends(get_current_user)):
    channels = await list_active_recording_channels()
    return [LiveChannelOut.model_validate(c) for c in channels]


@router.get("/calls", response_model=CallListResponse)
async def list_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str | None = None,
    near_addr: str | None = None,
    far_addr: str | None = None,
    direction: str | None = None,
    sentiment: str | None = None,
    status: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group_id = await scoped_call_filter(user)
    filters = []
    if group_id is not None:
        filters.append(Call.group_id == group_id)
    if q:
        like = f"%{q}%"
        filters.append(
            or_(
                Call.refci.ilike(like),
                Call.near_name.ilike(like),
                Call.far_name.ilike(like),
                Call.near_addr.ilike(like),
                Call.far_addr.ilike(like),
            )
        )
    if near_addr:
        filters.append(Call.near_addr.ilike(f"%{near_addr}%"))
    if far_addr:
        filters.append(Call.far_addr.ilike(f"%{far_addr}%"))
    if direction:
        filters.append(Call.direction == direction)
    if status:
        filters.append(Call.status == status)
    if date_from:
        filters.append(Call.started_at >= date_from)
    if date_to:
        filters.append(Call.started_at <= date_to)

    # One row per refci — duplicate Call rows can exist from concurrent ingest/start.
    id_stmt = select(Call.id)
    if filters:
        id_stmt = id_stmt.where(and_(*filters))
    if sentiment:
        id_stmt = id_stmt.join(Transcript, Transcript.call_id == Call.id).where(Transcript.sentiment == sentiment)
    deduped_ids = id_stmt.distinct(Call.refci).order_by(Call.refci, Call.id.desc()).subquery()

    total = (await db.execute(select(func.count()).select_from(deduped_ids))).scalar_one()
    offset = (page - 1) * page_size
    result = await db.execute(
        select(Call)
        .where(Call.id.in_(select(deduped_ids.c.id)))
        .options(selectinload(Call.transcripts))
        .order_by(Call.started_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    items = [
        CallOut.model_validate(c, from_attributes=True).model_copy(update={"sentiment": call_sentiment(c)})
        for c in result.scalars().all()
    ]
    return CallListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/calls/{call_id}", response_model=CallOut)
async def get_call(call_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Call).options(selectinload(Call.transcripts)).where(Call.id == call_id))
    call = result.scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=404, detail="Call not found")
    return CallOut.model_validate(call, from_attributes=True).model_copy(update={"sentiment": call_sentiment(call)})


@router.get("/calls/{call_id}/recordings", response_model=list[RecordingOut])
async def list_recordings(call_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    call = (await db.execute(select(Call).where(Call.id == call_id))).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=404, detail="Call not found")
    result = await db.execute(select(Recording).where(Recording.call_id == call_id))
    recs = []
    for r in result.scalars().all():
        out = RecordingOut.model_validate(r, from_attributes=True)
        out.has_peaks = r.peaks_json is not None
        recs.append(out)
    return recs


@router.get("/recordings/{recording_id}/peaks", response_model=PeaksOut)
async def get_peaks(recording_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Recording, Call)
        .join(Call, Recording.call_id == Call.id)
        .where(Recording.id == recording_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Recording not found")
    rec, call = row
    if not can_view_call(user, call.group_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    if not rec.peaks_json:
        raise HTTPException(status_code=404, detail="Peaks not ready")
    return PeaksOut(recording_id=recording_id, peaks=rec.peaks_json)


@router.get("/recordings/{recording_id}/audio")
async def stream_audio(recording_id: int, request: Request, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    import os

    result = await db.execute(
        select(Recording, Call)
        .join(Call, Recording.call_id == Call.id)
        .where(Recording.id == recording_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Recording not found")
    rec, call = row
    if not can_view_call(user, call.group_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    rel = rec.path_m4a or rec.path_wav
    if not rel:
        raise HTTPException(status_code=404, detail="Audio not available")

    full_path = os.path.join(settings.recordings_dir, rel.lstrip("/"))
    if not os.path.isfile(full_path):
        raise HTTPException(status_code=404, detail="Audio file missing on disk")

    file_size = os.path.getsize(full_path)
    media_type = "audio/mp4" if full_path.endswith(".m4a") else "audio/wav"
    range_header = request.headers.get("range")

    if range_header:
        try:
            _, range_spec = range_header.split("=")
            start_str, end_str = range_spec.split("-")
            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else file_size - 1
            end = min(end, file_size - 1)
        except ValueError as exc:
            raise HTTPException(status_code=416, detail="Invalid Range") from exc

        if start >= file_size:
            raise HTTPException(status_code=416, detail="Range not satisfiable")

        length = end - start + 1

        def iter_file():
            with open(full_path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    remaining -= len(chunk)
                    yield chunk

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
        }
        return StreamingResponse(iter_file(), status_code=206, media_type=media_type, headers=headers)

    return FileResponse(full_path, media_type=media_type, headers={"Accept-Ranges": "bytes"})


@router.get("/calls/{call_id}/tags", response_model=list[TagOut])
async def list_tags(call_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    call = (await db.execute(select(Call).where(Call.id == call_id))).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=404, detail="Call not found")
    result = await db.execute(select(Tag).where(Tag.call_id == call_id).order_by(Tag.start_s))
    return result.scalars().all()


@router.post("/tags", response_model=TagOut, dependencies=[Depends(require_permission(Permission.MANAGE_TAGS.value))])
async def create_tag(body: TagCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    call = (await db.execute(select(Call).where(Call.id == body.call_id))).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=404, detail="Call not found")
    tag = Tag(
        call_id=body.call_id,
        recording_id=body.recording_id,
        channel=body.channel,
        start_s=body.start_s,
        end_s=body.end_s,
        note=body.note,
        created_by=user.id,
    )
    db.add(tag)
    await db.commit()
    await db.refresh(tag)
    return tag


@router.delete("/tags/{tag_id}", dependencies=[Depends(require_permission(Permission.MANAGE_TAGS.value))])
async def delete_tag(tag_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    tag = (await db.execute(select(Tag).where(Tag.id == tag_id))).scalar_one_or_none()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    call = (await db.execute(select(Call).where(Call.id == tag.call_id))).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.delete(tag)
    await db.commit()
    return {"status": "ok"}


@router.get("/transcripts/search", response_model=list[TranscriptSearchResult])
async def search_transcripts(
    q: str = Query(..., min_length=2),
    sentiment: str | None = None,
    user=Depends(require_permission(Permission.VIEW_TRANSCRIPTS.value)),
    db: AsyncSession = Depends(get_db),
):
    group_id = await scoped_call_filter(user)
    ts_query = func.plainto_tsquery("english", q)

    stmt = (
        select(
            Transcript.id,
            Transcript.call_id,
            Transcript.leg,
            Transcript.sentiment,
            func.ts_rank(Transcript.search_tsv, ts_query).label("rank"),
            func.ts_headline("english", Transcript.text, ts_query).label("headline"),
        )
        .join(Call, Transcript.call_id == Call.id)
        .where(Transcript.search_tsv.op("@@")(ts_query))
    )
    if group_id is not None:
        stmt = stmt.where(Call.group_id == group_id)
    if sentiment:
        stmt = stmt.where(Transcript.sentiment == sentiment)

    stmt = stmt.order_by(func.ts_rank(Transcript.search_tsv, ts_query).desc()).limit(50)
    result = await db.execute(stmt)
    return [
        TranscriptSearchResult(
            transcript_id=r.id,
            call_id=r.call_id,
            leg=r.leg.value if hasattr(r.leg, "value") else str(r.leg),
            headline=r.headline,
            sentiment=r.sentiment,
            rank=float(r.rank),
        )
        for r in result.all()
    ]


@router.get("/calls/{call_id}/transcripts", response_model=list[TranscriptOut])
async def list_transcripts(
    call_id: int,
    user=Depends(require_permission(Permission.VIEW_TRANSCRIPTS.value)),
    db: AsyncSession = Depends(get_db),
):
    call = (await db.execute(select(Call).where(Call.id == call_id))).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=404, detail="Call not found")
    result = await db.execute(select(Transcript).where(Transcript.call_id == call_id))
    return result.scalars().all()
