"""Tests for Whisper leading-silence timestamp alignment."""

from __future__ import annotations

import math
import struct
import sys
import wave
from pathlib import Path

import pytest

WHISPER_DIR = Path(__file__).resolve().parents[2] / "whisper"
sys.path.insert(0, str(WHISPER_DIR))

from worker import align_segments_to_audio, measure_leading_silence_s  # noqa: E402


def _write_mono_wav(path: Path, *, rate: int, silence_s: float, tone_s: float, amp: int = 8000) -> None:
    silence_n = int(rate * silence_s)
    tone_n = int(rate * tone_s)
    frames = bytearray()
    for _ in range(silence_n):
        frames += struct.pack("<h", 0)
    for i in range(tone_n):
        sample = int(amp * math.sin(2 * math.pi * 440 * i / rate))
        frames += struct.pack("<h", sample)
    with wave.open(str(path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(rate)
        wf.writeframes(frames)


def test_measure_leading_silence(tmp_path: Path):
    wav = tmp_path / "leg.wav"
    _write_mono_wav(wav, rate=8000, silence_s=2.5, tone_s=1.0)
    silence = measure_leading_silence_s(str(wav))
    assert 2.3 <= silence <= 2.7


def test_align_shifts_when_whisper_collapses_to_zero(tmp_path: Path):
    wav = tmp_path / "leg.wav"
    _write_mono_wav(wav, rate=8000, silence_s=2.5, tone_s=1.0)
    segs = [
        {"start": 0.0, "end": 3.0, "text": "hello"},
        {"start": 3.0, "end": 5.0, "text": "there"},
    ]
    out = align_segments_to_audio(str(wav), segs)
    assert out[0]["start"] == pytest.approx(2.5, abs=0.2)
    assert out[0]["end"] == pytest.approx(5.5, abs=0.2)
    assert out[1]["start"] == pytest.approx(5.5, abs=0.2)


def test_align_noop_when_first_start_already_late(tmp_path: Path):
    wav = tmp_path / "leg.wav"
    _write_mono_wav(wav, rate=8000, silence_s=2.5, tone_s=1.0)
    segs = [{"start": 2.4, "end": 4.0, "text": "hello"}]
    out = align_segments_to_audio(str(wav), segs)
    assert out[0]["start"] == 2.4
