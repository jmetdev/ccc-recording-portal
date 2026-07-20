from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.rbac import can_view_call, get_current_user, require_permission, scoped_call_filter, user_permissions
from app.models import Call, CallStatus, Permission, RecordedExtension, Recording, RecordingLeg, Tag, Transcript
from app.schemas import (
    CallListResponse,
    CallOut,
    DashboardStats,
    LegalHoldUpdate,
    LiveChannelOut,
    PeaksOut,
    RecordingOut,
    TagCreate,
    TagOut,
    TranscriptOut,
    TranscriptSearchResult,
)
from app.services.audit import record_audit
from app.services.call_stats import distinct_call_count_stmt
from app.services.freeswitch import list_active_recording_channels
from app.services.storage import get_storage
from app.services.system_health import fetch_transcription_coverage

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

    calls_today = (
        await db.execute(distinct_call_count_stmt(user.tenant_id, group_id, Call.started_at >= today))
    ).scalar_one()
    calls_total = (await db.execute(distinct_call_count_stmt(user.tenant_id, group_id))).scalar_one()
    # FreeSWITCH fs_cli is host-local and not tenant-scoped. Only use it for
    # the legacy default tenant (shared lab box); everyone else reads
    # recording_now from their own Call rows.
    from app.services.tenancy import get_default_tenant_id

    if user.tenant_id == await get_default_tenant_id(db):
        fs_channels = await list_active_recording_channels()
        recording_now = (
            len(fs_channels)
            if fs_channels
            else (
                await db.execute(
                    distinct_call_count_stmt(user.tenant_id, group_id, Call.status == CallStatus.RECORDING)
                )
            ).scalar_one()
        )
    else:
        recording_now = (
            await db.execute(distinct_call_count_stmt(user.tenant_id, group_id, Call.status == CallStatus.RECORDING))
        ).scalar_one()
    extensions_enabled = (
        await db.execute(
            select(func.count())
            .select_from(RecordedExtension)
            .where(RecordedExtension.enabled.is_(True), RecordedExtension.tenant_id == user.tenant_id)
        )
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
    stmt = (
        select(Call)
        .where(Call.status == CallStatus.RECORDING, Call.tenant_id == user.tenant_id)
        .order_by(Call.started_at.desc())
    )
    if group_id is not None:
        stmt = stmt.where(Call.group_id == group_id)
    result = await db.execute(stmt.options(selectinload(Call.transcripts)))
    calls = result.scalars().all()
    return [
        CallOut.model_validate(c, from_attributes=True).model_copy(update={"sentiment": call_sentiment(c)})
        for c in calls
    ]


@router.get("/freeswitch/live-channels", response_model=list[LiveChannelOut])
async def freeswitch_live_channels(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Permission check first so users without call access get a clean 403
    # instead of leaking host-local FreeSWITCH state.
    group_id = await scoped_call_filter(user)

    # Host-local fs_cli is only meaningful for the legacy default tenant on a
    # shared lab box. Multi-tenant cloud tenants get live state from their own
    # Call rows (fed by their on-prem / Webex connectors).
    from app.services.tenancy import get_default_tenant_id

    if user.tenant_id == await get_default_tenant_id(db):
        channels = await list_active_recording_channels()
        if channels:
            return [LiveChannelOut.model_validate(c) for c in channels]

    stmt = (
        select(Call)
        .where(Call.status == CallStatus.RECORDING, Call.tenant_id == user.tenant_id)
        .order_by(Call.started_at.desc())
    )
    if group_id is not None:
        stmt = stmt.where(Call.group_id == group_id)
    result = await db.execute(stmt)
    now = datetime.now(timezone.utc)
    fallback = []
    for call in result.scalars().all():
        duration_s = max(0.0, (now - call.started_at).total_seconds()) if call.started_at else None
        fallback.append(
            LiveChannelOut(
                uuid=f"db-{call.id}",
                refci=call.refci,
                near_addr=call.near_addr,
                far_addr=call.far_addr,
                leg="portal",
                dest="1034",
                callstate="recording",
                duration_s=duration_s,
            )
        )
    return fallback


@router.get("/calls", response_model=CallListResponse)
async def list_calls(
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str | None = None,
    near_addr: str | None = None,
    far_addr: str | None = None,
    direction: str | None = None,
    source: str | None = None,
    sentiment: str | None = None,
    status: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    legal_hold: bool | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    group_id = await scoped_call_filter(user)
    filters = [Call.tenant_id == user.tenant_id]
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
    if source:
        filters.append(Call.source == source)
    if status:
        filters.append(Call.status == status)
    if date_from:
        filters.append(Call.started_at >= date_from)
    if date_to:
        filters.append(Call.started_at <= date_to)
    if legal_hold is not None:
        filters.append(Call.legal_hold.is_(legal_hold))

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
    result = await db.execute(
        select(Call)
        .options(selectinload(Call.transcripts))
        .where(Call.id == call_id, Call.tenant_id == user.tenant_id)
    )
    call = result.scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=404, detail="Call not found")
    return CallOut.model_validate(call, from_attributes=True).model_copy(update={"sentiment": call_sentiment(call)})


@router.get("/calls/{call_id}/recordings", response_model=list[RecordingOut])
async def list_recordings(call_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    call = (
        await db.execute(select(Call).where(Call.id == call_id, Call.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
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
        .where(Recording.id == recording_id, Call.tenant_id == user.tenant_id)
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
    result = await db.execute(
        select(Recording, Call)
        .join(Call, Recording.call_id == Call.id)
        .where(Recording.id == recording_id, Call.tenant_id == user.tenant_id)
    )
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Recording not found")
    rec, call = row
    if not can_view_call(user, call.group_id):
        raise HTTPException(status_code=403, detail="Forbidden")

    if rec.media_path:
        key, media_type = rec.media_path, rec.media_mime or "application/octet-stream"
    elif rec.path_m4a:
        key, media_type = rec.path_m4a, "audio/mp4"
    elif rec.path_wav:
        key, media_type = rec.path_wav, "audio/wav"
    else:
        raise HTTPException(status_code=404, detail="Audio not available")

    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="recording.play",
        user=user,
        resource_type="recording",
        resource_id=recording_id,
        detail={"call_id": call.id, "refci": call.refci},
        request=request,
        commit=True,
    )

    storage = get_storage()
    presigned = storage.presigned_url(key, media_type)
    if presigned:
        # S3-backed media never proxies through the API; the audio element
        # follows the redirect and lets S3 handle range requests.
        return RedirectResponse(presigned, status_code=307)

    full_path = storage.local_path(key)
    if not full_path:
        raise HTTPException(status_code=404, detail="Audio file missing on disk")

    file_size = storage.size(key)
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
        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
        }
        return StreamingResponse(
            storage.iter_range(key, start, length), status_code=206, media_type=media_type, headers=headers
        )

    return FileResponse(full_path, media_type=media_type, headers={"Accept-Ranges": "bytes"})


@router.get("/calls/{call_id}/tags", response_model=list[TagOut])
async def list_tags(call_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    call = (
        await db.execute(select(Call).where(Call.id == call_id, Call.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=404, detail="Call not found")
    result = await db.execute(select(Tag).where(Tag.call_id == call_id).order_by(Tag.start_s))
    return result.scalars().all()


@router.post("/tags", response_model=TagOut, dependencies=[Depends(require_permission(Permission.MANAGE_TAGS.value))])
async def create_tag(body: TagCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    call = (
        await db.execute(select(Call).where(Call.id == body.call_id, Call.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=404, detail="Call not found")
    tag = Tag(
        tenant_id=user.tenant_id,
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
    tag = (
        await db.execute(select(Tag).where(Tag.id == tag_id, Tag.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
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
        .where(Transcript.search_tsv.op("@@")(ts_query), Call.tenant_id == user.tenant_id)
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


@router.get("/transcripts/coverage")
async def transcription_coverage(
    user=Depends(require_permission(Permission.VIEW_TRANSCRIPTS.value)),
    db: AsyncSession = Depends(get_db),
):
    """Tenant-wide transcript coverage, for the Search page to show whether
    results are trustworthy — search only reaches calls that were transcribed.
    """
    return await fetch_transcription_coverage(db, user.tenant_id)


@router.get("/calls/{call_id}/transcripts", response_model=list[TranscriptOut])
async def list_transcripts(
    call_id: int,
    user=Depends(require_permission(Permission.VIEW_TRANSCRIPTS.value)),
    db: AsyncSession = Depends(get_db),
):
    call = (
        await db.execute(select(Call).where(Call.id == call_id, Call.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id):
        raise HTTPException(status_code=404, detail="Call not found")
    result = await db.execute(select(Transcript).where(Transcript.call_id == call_id))
    return result.scalars().all()


@router.patch("/calls/{call_id}/legal-hold", response_model=CallOut)
async def set_legal_hold(
    call_id: int,
    body: LegalHoldUpdate,
    request: Request,
    user=Depends(require_permission(Permission.MANAGE_RETENTION.value)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Call)
        .options(selectinload(Call.transcripts))
        .where(Call.id == call_id, Call.tenant_id == user.tenant_id)
    )
    call = result.scalar_one_or_none()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")
    call.legal_hold = body.legal_hold
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="call.legal_hold" if body.legal_hold else "call.legal_hold_released",
        user=user,
        resource_type="call",
        resource_id=call.id,
        detail={"refci": call.refci},
        request=request,
    )
    await db.commit()
    await db.refresh(call, ["transcripts"])
    return CallOut.model_validate(call, from_attributes=True).model_copy(
        update={"sentiment": call_sentiment(call)}
    )
