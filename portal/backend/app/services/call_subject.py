"""Extractive call subject and summary from transcript text (no LLM).

Future: keyword alerts + notification delivery (email/Webex) may boost subject
with matched alert keywords once alert_hits exist — see recordings UI uplift plan.
"""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Call, RecordingLeg, Transcript

_SUBJECT_MAX = 80
_SUMMARY_MAX = 400

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_GREETING = re.compile(
    r"^(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|"
    r"thanks?\s+for\s+calling|thank\s+you\s+for\s+calling)\b",
    re.IGNORECASE,
)
_WS = re.compile(r"\s+")


def _normalize(text: str) -> str:
    return _WS.sub(" ", text.strip())


def _split_sentences(text: str) -> list[str]:
    normalized = _normalize(text)
    if not normalized:
        return []
    parts = _SENTENCE_SPLIT.split(normalized)
    return [p.strip() for p in parts if p.strip()]


def _is_greeting(sentence: str) -> bool:
    return bool(_GREETING.match(sentence.strip()))


def _trim_to(text: str, max_len: int) -> str:
    if len(text) <= max_len:
        return text
    cut = text[: max_len - 1].rsplit(" ", 1)[0]
    return (cut or text[: max_len - 1]).rstrip(".,;:!? ") + "…"


def extract_subject(text: str, *, max_len: int = _SUBJECT_MAX) -> str | None:
    sentences = _split_sentences(text)
    if not sentences:
        return None
    candidate = sentences[0]
    if _is_greeting(candidate) and len(sentences) > 1:
        for sentence in sentences[1:]:
            if not _is_greeting(sentence):
                candidate = sentence
                break
        else:
            candidate = sentences[1]
    return _trim_to(candidate, max_len) or None


def extract_summary(text: str, *, max_len: int = _SUMMARY_MAX) -> str | None:
    sentences = _split_sentences(text)
    if not sentences:
        return None
    blurb = " ".join(sentences[:3])
    return _trim_to(blurb, max_len) or None


def preferred_transcript_text(transcripts: list[Transcript]) -> str | None:
    by_leg: dict[RecordingLeg, str] = {}
    for t in transcripts:
        if t.text and t.text.strip():
            by_leg[t.leg] = t.text.strip()

    for leg in (RecordingLeg.MIX, RecordingLeg.STEREO):
        if leg in by_leg:
            return by_leg[leg]

    parts = [by_leg[leg] for leg in (RecordingLeg.NEAR, RecordingLeg.FAR) if leg in by_leg]
    if parts:
        return " ".join(parts)
    if by_leg:
        return next(iter(by_leg.values()))
    return None


def derive_subject_summary(transcripts: list[Transcript]) -> tuple[str | None, str | None]:
    text = preferred_transcript_text(transcripts)
    if not text:
        return None, None
    return extract_subject(text), extract_summary(text)


async def refresh_call_subject_summary(db: AsyncSession, call_id: int) -> None:
    call = (await db.execute(select(Call).where(Call.id == call_id))).scalar_one_or_none()
    if call is None:
        return
    transcripts = (
        await db.execute(select(Transcript).where(Transcript.call_id == call_id))
    ).scalars().all()
    subject, summary = derive_subject_summary(list(transcripts))
    call.subject = subject
    call.summary = summary
