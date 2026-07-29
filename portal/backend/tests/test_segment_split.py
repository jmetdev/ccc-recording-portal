"""Tests for Whisper segment bubble splitting on word gaps."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path

WHISPER_DIR = Path(__file__).resolve().parents[2] / "whisper"
sys.path.insert(0, str(WHISPER_DIR))

from segment_utils import segments_from_whisper_seg  # noqa: E402


@dataclass
class Word:
    word: str
    start: float | None = None
    end: float | None = None


@dataclass
class Seg:
    text: str
    start: float
    end: float
    words: list[Word]


def test_no_split_when_gap_below_threshold():
    seg = Seg(
        text="hello there",
        start=0.0,
        end=2.0,
        words=[
            Word("hello", 0.0, 0.5),
            Word("there", 0.9, 1.4),
        ],
    )
    out = segments_from_whisper_seg(seg, word_gap_s=0.5)
    assert len(out) == 1
    assert out[0]["text"] == "hello there"
    assert out[0]["start"] == 0.0
    assert out[0]["end"] == 1.4


def test_splits_on_listening_pause():
    seg = Seg(
        text="yes okay thanks",
        start=0.0,
        end=8.0,
        words=[
            Word("yes", 0.0, 0.4),
            Word("okay", 2.0, 2.5),
            Word("thanks", 2.6, 3.1),
        ],
    )
    out = segments_from_whisper_seg(seg, word_gap_s=0.5)
    assert len(out) == 2
    assert out[0]["text"] == "yes"
    assert out[0]["start"] == 0.0
    assert out[0]["end"] == 0.4
    assert out[1]["text"] == "okay thanks"
    assert out[1]["start"] == 2.0
    assert out[1]["end"] == 3.1


def test_fallback_without_word_timestamps():
    seg = Seg(text="hello", start=1.0, end=2.0, words=[])
    out = segments_from_whisper_seg(seg)
    assert out == [{"start": 1.0, "end": 2.0, "text": "hello"}]


def test_empty_segment_returns_nothing():
    seg = Seg(text="   ", start=0.0, end=1.0, words=[])
    assert segments_from_whisper_seg(seg) == []
