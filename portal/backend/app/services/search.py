from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, selectinload

from app.models import Call, CallStatus, RecordedExtension, Transcript


def resolve_group_for_call(db: Session, near_addr: str | None, far_addr: str | None) -> int | None:
    addrs = [a for a in (near_addr, far_addr) if a]
    if not addrs:
        return None
    ext = (
        db.query(RecordedExtension)
        .options(selectinload(RecordedExtension.groups))
        .filter(RecordedExtension.extension.in_(addrs), RecordedExtension.enabled.is_(True))
        .first()
    )
    return ext.groups[0].id if ext and ext.groups else None


def search_transcripts(
    db: Session,
    query: str,
    sentiment: str | None = None,
    group_id: int | None = None,
    limit: int = 50,
) -> list[dict]:
    ts_query = func.plainto_tsquery("english", query)
    q = (
        db.query(
            Transcript,
            func.ts_headline("english", Transcript.text, ts_query).label("headline"),
            Call,
        )
        .join(Call, Call.id == Transcript.call_id)
        .filter(Transcript.search_tsv.op("@@")(ts_query))
    )
    if sentiment:
        q = q.filter(Transcript.sentiment == sentiment)
    if group_id is not None:
        q = q.filter(or_(Call.group_id == group_id, Call.group_id.is_(None)))
    rows = q.limit(limit).all()
    return [{"transcript": t, "headline": h, "call": c} for t, h, c in rows]


def update_transcript_tsv(db: Session, transcript_id: int, text_content: str) -> None:
    db.execute(
        text(
            "UPDATE transcripts SET search_tsv = to_tsvector('english', :txt) WHERE id = :id"
        ),
        {"txt": text_content or "", "id": transcript_id},
    )
    db.commit()
