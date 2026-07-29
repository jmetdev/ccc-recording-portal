from datetime import datetime, timezone
import time

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy import and_, func, literal, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.rbac import call_visibility_scope, can_view_call, get_current_user, require_permission, user_permissions
from app.models import Call, CallRead, CallStatus, Group, Permission, RecordedExtension, Recording, RecordingLeg, Tag, Transcript
from app.schemas import (
    CallListResponse,
    CallOut,
    DashboardStats,
    GroupOut,
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
from app.services.call_visibility import append_visibility_scope, group_names_by_id, read_call_ids_for_user
from app.services.freeswitch import list_active_recording_channels
from app.services.storage import get_storage
from app.services.system_health import fetch_transcription_coverage

router = APIRouter(tags=["calls"])


def call_sentiment(call: Call) -> str | None:
    sentiments = [t.sentiment for t in call.transcripts if t.sentiment]
    return sentiments[0] if sentiments else None


async def calls_to_out(db: AsyncSession, user, calls: list[Call]) -> list[CallOut]:
    if not calls:
        return []
    read_ids = await read_call_ids_for_user(db, user.id, [c.id for c in calls])
    names = await group_names_by_id(
        db, user.tenant_id, {c.group_id for c in calls if c.group_id is not None}
    )
    return [
        CallOut.model_validate(c, from_attributes=True).model_copy(
            update={
                "sentiment": call_sentiment(c),
                "is_unread": c.id not in read_ids,
                "group_name": names.get(c.group_id) if c.group_id is not None else None,
            }
        )
        for c in calls
    ]


async def call_to_out(db: AsyncSession, user, call: Call) -> CallOut:
    return (await calls_to_out(db, user, [call]))[0]


@router.get("/dashboard/stats", response_model=DashboardStats)
async def dashboard_stats(
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = call_visibility_scope(user)
    today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

    not_trashed = Call.trashed_at.is_(None)
    calls_today = (
        await db.execute(
            distinct_call_count_stmt(user.tenant_id, scope, user, Call.started_at >= today, not_trashed)
        )
    ).scalar_one()
    calls_total = (
        await db.execute(distinct_call_count_stmt(user.tenant_id, scope, user, not_trashed))
    ).scalar_one()
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
                    distinct_call_count_stmt(
                        user.tenant_id, scope, user, Call.status == CallStatus.RECORDING, not_trashed
                    )
                )
            ).scalar_one()
        )
    else:
        recording_now = (
            await db.execute(
                distinct_call_count_stmt(
                    user.tenant_id, scope, user, Call.status == CallStatus.RECORDING, not_trashed
                )
            )
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
    scope = call_visibility_scope(user)
    filters = [
        Call.status == CallStatus.RECORDING,
        Call.tenant_id == user.tenant_id,
        Call.trashed_at.is_(None),
    ]
    append_visibility_scope(filters, scope, user)
    stmt = select(Call).where(and_(*filters)).order_by(Call.started_at.desc())
    result = await db.execute(stmt.options(selectinload(Call.transcripts)))
    calls = result.scalars().all()
    return await calls_to_out(db, user, calls)


@router.get("/freeswitch/live-channels", response_model=list[LiveChannelOut])
async def freeswitch_live_channels(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    # Permission check first so users without call access get a clean 403
    # instead of leaking host-local FreeSWITCH state.
    scope = call_visibility_scope(user)

    # Host-local fs_cli is only meaningful for the legacy default tenant on a
    # shared lab box. Multi-tenant cloud tenants get live state from their
    # connector heartbeat (includes FreeSWITCH codecs) or Call rows.
    from app.models import ConnectorCredential
    from app.services.tenancy import get_default_tenant_id

    if user.tenant_id == await get_default_tenant_id(db):
        channels = await list_active_recording_channels()
        if channels:
            return [_live_channel_with_fresh_duration(c) for c in channels]

    # Prefer on-prem connector heartbeat snapshots (have read_codec/write_codec).
    connectors = (
        await db.execute(
            select(ConnectorCredential).where(
                ConnectorCredential.tenant_id == user.tenant_id,
                ConnectorCredential.enabled.is_(True),
            )
        )
    ).scalars().all()
    now = datetime.now(timezone.utc)
    connector_channels: list[LiveChannelOut] = []
    for cred in connectors:
        stats = cred.stats_json if isinstance(cred.stats_json, dict) else {}
        raw_channels = stats.get("live_channels")
        if not isinstance(raw_channels, list):
            continue
        # Ignore stale heartbeats so we don't show ghost calls.
        if cred.last_seen_at is None or (now - cred.last_seen_at).total_seconds() > 180:
            continue
        for row in raw_channels:
            if not isinstance(row, dict) or not row.get("uuid"):
                continue
            connector_channels.append(_live_channel_with_fresh_duration(row))
    if connector_channels:
        return connector_channels

    filters = [
        Call.status == CallStatus.RECORDING,
        Call.tenant_id == user.tenant_id,
        Call.trashed_at.is_(None),
    ]
    append_visibility_scope(filters, scope, user)
    stmt = select(Call).where(and_(*filters)).order_by(Call.started_at.desc())
    result = await db.execute(stmt)
    fallback = []
    for call in result.scalars().all():
        duration_s = max(0.0, (now - call.started_at).total_seconds()) if call.started_at else None
        fallback.append(
            LiveChannelOut(
                uuid=f"db-{call.id}",
                refci=call.refci,
                near_addr=call.near_addr,
                far_addr=call.far_addr,
                dest="1034",
                callstate="recording",
                duration_s=duration_s,
            )
        )
    return fallback


def _live_channel_with_fresh_duration(row: dict) -> LiveChannelOut:
    """Recompute duration from created_epoch so heartbeat snapshots stay live."""
    data = dict(row)
    created = data.get("created_epoch")
    if created is not None:
        try:
            data["duration_s"] = max(0.0, time.time() - float(created))
        except (TypeError, ValueError):
            pass
    return LiveChannelOut.model_validate(data)


@router.get("/groups/mine", response_model=list[GroupOut])
async def my_groups(user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    scope = call_visibility_scope(user)
    if scope.mode == "all":
        result = await db.execute(
            select(Group).where(Group.tenant_id == user.tenant_id).order_by(Group.name)
        )
        return result.scalars().all()
    if scope.mode == "groups":
        if not scope.group_ids:
            return []
        result = await db.execute(
            select(Group).where(Group.id.in_(scope.group_ids)).order_by(Group.name)
        )
        return result.scalars().all()
    return []


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
    holding: bool | None = None,
    trashed: bool | None = None,
    group_id: int | None = None,
    user=Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    scope = call_visibility_scope(user)
    filters = [Call.tenant_id == user.tenant_id]
    append_visibility_scope(filters, scope, user)
    if group_id is not None:
        if scope.mode == "own":
            raise HTTPException(status_code=403, detail="Not allowed to filter by group")
        if scope.mode == "groups" and group_id not in scope.group_ids:
            raise HTTPException(status_code=403, detail="Not allowed to view this group")
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
    if holding is not None:
        filters.append(Call.holding.is_(holding))
    if trashed:
        filters.append(Call.trashed_at.is_not(None))
    else:
        filters.append(Call.trashed_at.is_(None))

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
    items = await calls_to_out(db, user, list(result.scalars().all()))
    return CallListResponse(items=items, total=total, page=page, page_size=page_size)


@router.get("/calls/{call_id}", response_model=CallOut)
async def get_call(call_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Call)
        .options(selectinload(Call.transcripts))
        .where(Call.id == call_id, Call.tenant_id == user.tenant_id)
    )
    call = result.scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id, call.near_addr):
        raise HTTPException(status_code=404, detail="Call not found")
    return await call_to_out(db, user, call)


@router.post("/calls/{call_id}/read")
async def mark_call_read(call_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    call = (
        await db.execute(select(Call).where(Call.id == call_id, Call.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id, call.near_addr):
        raise HTTPException(status_code=404, detail="Call not found")
    existing = (
        await db.execute(
            select(CallRead).where(CallRead.user_id == user.id, CallRead.call_id == call_id)
        )
    ).scalar_one_or_none()
    if existing is None:
        db.add(CallRead(user_id=user.id, call_id=call_id, read_at=datetime.now(timezone.utc)))
        await db.commit()
    return {"status": "ok"}


@router.get("/calls/{call_id}/recordings", response_model=list[RecordingOut])
async def list_recordings(call_id: int, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    call = (
        await db.execute(select(Call).where(Call.id == call_id, Call.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id, call.near_addr):
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
    if not can_view_call(user, call.group_id, call.near_addr):
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
    if not can_view_call(user, call.group_id, call.near_addr):
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
    if not call or not can_view_call(user, call.group_id, call.near_addr):
        raise HTTPException(status_code=404, detail="Call not found")
    result = await db.execute(select(Tag).where(Tag.call_id == call_id).order_by(Tag.start_s))
    return result.scalars().all()


@router.post("/tags", response_model=TagOut, dependencies=[Depends(require_permission(Permission.MANAGE_TAGS.value))])
async def create_tag(body: TagCreate, user=Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    call = (
        await db.execute(select(Call).where(Call.id == body.call_id, Call.tenant_id == user.tenant_id))
    ).scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id, call.near_addr):
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
    if not call or not can_view_call(user, call.group_id, call.near_addr):
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.delete(tag)
    await db.commit()
    return {"status": "ok"}


@router.get("/transcripts/search", response_model=list[TranscriptSearchResult])
async def search_transcripts(
    q: str = Query("", max_length=200),
    sentiment: str | None = None,
    near: str | None = Query(None, max_length=128, description="Filter by near/calling party"),
    far: str | None = Query(None, max_length=128, description="Filter by far/called party"),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    user=Depends(require_permission(Permission.VIEW_TRANSCRIPTS.value)),
    db: AsyncSession = Depends(get_db),
):
    q_clean = (q or "").strip()
    near_clean = (near or "").strip() or None
    far_clean = (far or "").strip() or None
    if len(q_clean) < 2 and not near_clean and not far_clean and date_from is None and date_to is None and not sentiment:
        raise HTTPException(
            status_code=422,
            detail="Provide keywords (2+ chars) and/or near, far, sentiment, or a time range",
        )

    scope = call_visibility_scope(user)
    filters = [
        Call.tenant_id == user.tenant_id,
        Call.trashed_at.is_(None),
    ]
    append_visibility_scope(filters, scope, user)
    if sentiment:
        filters.append(Transcript.sentiment == sentiment)
    if near_clean:
        like = f"%{near_clean}%"
        filters.append(or_(Call.near_name.ilike(like), Call.near_addr.ilike(like)))
    if far_clean:
        like = f"%{far_clean}%"
        filters.append(or_(Call.far_name.ilike(like), Call.far_addr.ilike(like)))
    if date_from is not None:
        filters.append(Call.started_at >= date_from)
    if date_to is not None:
        filters.append(Call.started_at <= date_to)

    use_fts = len(q_clean) >= 2
    if use_fts:
        ts_query = func.plainto_tsquery("english", q_clean)
        filters.append(Transcript.search_tsv.op("@@")(ts_query))
        rank_expr = func.ts_rank(Transcript.search_tsv, ts_query)
        headline_expr = func.ts_headline("english", Transcript.text, ts_query)
        order_by = rank_expr.desc()
    else:
        rank_expr = literal(0.0)
        headline_expr = func.left(Transcript.text, 240)
        order_by = Call.started_at.desc()

    stmt = (
        select(
            Transcript.id,
            Transcript.call_id,
            Transcript.leg,
            Transcript.sentiment,
            Call.near_name,
            Call.far_name,
            Call.near_addr,
            Call.far_addr,
            Call.started_at,
            rank_expr.label("rank"),
            headline_expr.label("headline"),
        )
        .join(Call, Transcript.call_id == Call.id)
        .where(*filters)
        .order_by(order_by)
        .limit(50)
    )
    result = await db.execute(stmt)
    return [
        TranscriptSearchResult(
            transcript_id=r.id,
            call_id=r.call_id,
            leg=r.leg.value if hasattr(r.leg, "value") else str(r.leg),
            headline=r.headline or "",
            sentiment=r.sentiment,
            rank=float(r.rank or 0),
            near_name=r.near_name,
            far_name=r.far_name,
            near_addr=r.near_addr,
            far_addr=r.far_addr,
            started_at=r.started_at,
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
    if not call or not can_view_call(user, call.group_id, call.near_addr):
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
    return await call_to_out(db, user, call)


@router.post("/calls/{call_id}/trash", response_model=CallOut)
async def trash_call(
    call_id: int,
    request: Request,
    user=Depends(require_permission(Permission.MANAGE_RETENTION.value)),
    db: AsyncSession = Depends(get_db),
):
    """Move a call to trash. Recoverable for 30 days, then permanently purged."""
    result = await db.execute(
        select(Call)
        .options(selectinload(Call.transcripts))
        .where(Call.id == call_id, Call.tenant_id == user.tenant_id)
    )
    call = result.scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id, call.near_addr):
        raise HTTPException(status_code=404, detail="Call not found")
    if call.legal_hold:
        raise HTTPException(
            status_code=409,
            detail="Release legal hold before moving this call to trash",
        )
    if call.trashed_at is not None:
        raise HTTPException(status_code=409, detail="Call is already in trash")
    call.trashed_at = datetime.now(timezone.utc)
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="call.trash",
        user=user,
        resource_type="call",
        resource_id=call.id,
        detail={"refci": call.refci, "trashed_at": str(call.trashed_at)},
        request=request,
    )
    await db.commit()
    await db.refresh(call, ["transcripts"])
    return await call_to_out(db, user, call)


@router.post("/calls/{call_id}/restore", response_model=CallOut)
async def restore_call(
    call_id: int,
    request: Request,
    user=Depends(require_permission(Permission.MANAGE_RETENTION.value)),
    db: AsyncSession = Depends(get_db),
):
    """Restore a trashed call back to the active recordings list."""
    result = await db.execute(
        select(Call)
        .options(selectinload(Call.transcripts))
        .where(Call.id == call_id, Call.tenant_id == user.tenant_id)
    )
    call = result.scalar_one_or_none()
    if not call or not can_view_call(user, call.group_id, call.near_addr):
        raise HTTPException(status_code=404, detail="Call not found")
    if call.trashed_at is None:
        raise HTTPException(status_code=409, detail="Call is not in trash")
    previous_trashed_at = call.trashed_at
    call.trashed_at = None
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="call.restore",
        user=user,
        resource_type="call",
        resource_id=call.id,
        detail={"refci": call.refci, "trashed_at": str(previous_trashed_at)},
        request=request,
    )
    await db.commit()
    await db.refresh(call, ["transcripts"])
    return await call_to_out(db, user, call)
