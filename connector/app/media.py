"""ffmpeg transcode + waveform peaks (ported from portal/media-handler)."""

from __future__ import annotations

import os
import subprocess
import wave

import numpy as np


def generate_peaks(wav_path: str, buckets: int = 512) -> dict:
    with wave.open(wav_path, "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())

    if sample_width != 2:
        raise ValueError("Only 16-bit PCM supported for peaks")

    samples = np.frombuffer(frames, dtype=np.int16)
    channel_data = [samples] if channels == 1 else [samples[i::channels] for i in range(channels)]

    peaks: dict[str, dict] = {}
    for idx, data in enumerate(channel_data):
        if len(data) == 0:
            peaks[str(idx)] = {"min": [0.0] * buckets, "max": [0.0] * buckets}
            continue
        chunk = max(1, len(data) // buckets)
        mins, maxs = [], []
        for i in range(buckets):
            start = i * chunk
            segment = data[start : min(len(data), start + chunk)]
            if len(segment) == 0:
                mins.append(0.0)
                maxs.append(0.0)
            else:
                mins.append(float(segment.min()) / 32768.0)
                maxs.append(float(segment.max()) / 32768.0)
        peaks[str(idx)] = {"min": mins, "max": maxs}

    duration = len(samples) / max(channels, 1) / rate if rate else 0
    return {"channels": channels, "sample_rate": rate, "duration": duration, "data": peaks}


def convert_to_m4a(wav_path: str, m4a_path: str, channels: int) -> None:
    os.makedirs(os.path.dirname(m4a_path) or ".", exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", wav_path, "-c:a", "aac", "-b:a", "96k", "-ac", str(channels), m4a_path],
        check=True,
        capture_output=True,
    )


def wav_meta(wav_path: str) -> tuple[int, int, float]:
    """Return (sample_rate, channels, duration_s)."""
    with wave.open(wav_path, "rb") as wf:
        rate = wf.getframerate()
        ch = wf.getnchannels()
        frames = wf.getnframes()
    return rate, ch, (frames / rate if rate else 0.0)
