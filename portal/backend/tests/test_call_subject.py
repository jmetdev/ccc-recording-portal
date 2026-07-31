"""Tests for extractive call subject/summary."""

from __future__ import annotations

from dataclasses import dataclass

from app.models import RecordingLeg
from app.services.call_subject import (
    derive_subject_summary,
    extract_subject,
    extract_summary,
    preferred_transcript_text,
)


@dataclass
class FakeTranscript:
    leg: RecordingLeg
    text: str


def test_extract_subject_skips_greeting():
    text = "Hello, thanks for calling. I need help with my invoice."
    assert extract_subject(text) == "I need help with my invoice."


def test_extract_subject_truncates():
    long = "This is a very long sentence that should be trimmed down to fit within the subject line limit comfortably."
    subject = extract_subject(long, max_len=40)
    assert subject is not None
    assert len(subject) <= 40
    assert subject.endswith("…")


def test_extract_summary_first_sentences():
    text = "First point. Second point. Third point. Fourth point."
    summary = extract_summary(text)
    assert summary == "First point. Second point. Third point."


def test_preferred_transcript_text_prefers_mix():
    transcripts = [
        FakeTranscript(RecordingLeg.NEAR, "near text"),
        FakeTranscript(RecordingLeg.FAR, "far text"),
        FakeTranscript(RecordingLeg.MIX, "mix text"),
    ]
    assert preferred_transcript_text(transcripts) == "mix text"  # type: ignore[arg-type]


def test_derive_subject_summary_from_near_far():
    transcripts = [
        FakeTranscript(RecordingLeg.NEAR, "Hi there."),
        FakeTranscript(RecordingLeg.FAR, "We scheduled the install for Tuesday."),
    ]
    subject, summary = derive_subject_summary(transcripts)  # type: ignore[arg-type]
    assert subject == "We scheduled the install for Tuesday."
    assert summary is not None
    assert "Tuesday" in summary
