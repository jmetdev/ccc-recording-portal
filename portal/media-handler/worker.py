#!/usr/bin/env python3
"""Poll media_convert jobs, produce stereo M4A + waveform peaks."""

from __future__ import annotations

import os
import subprocess
import time
import wave

import httpx
import numpy as np

BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:8000")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/recordings")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "3"))


def api_headers() -> dict[str, str]:
    return {"X-Worker-Token": WORKER_TOKEN}


def full_path(rel: str) -> str:
    return os.path.join(RECORDINGS_DIR, rel.lstrip("/"))


def generate_peaks(wav_path: str, buckets: int = 512) -> dict:
    with wave.open(wav_path, "rb") as wf:
        channels = wf.getnchannels()
        sample_width = wf.getsampwidth()
        rate = wf.getframerate()
        frames = wf.readframes(wf.getnframes())

    if sample_width != 2:
        raise ValueError("Only 16-bit PCM supported for peaks")

    samples = np.frombuffer(frames, dtype=np.int16)
    if channels == 1:
        channel_data = [samples]
    else:
        channel_data = [samples[i::channels] for i in range(channels)]

    peaks = {}
    for idx, data in enumerate(channel_data):
        if len(data) == 0:
            peaks[str(idx)] = {"min": [0.0] * buckets, "max": [0.0] * buckets}
            continue
        chunk = max(1, len(data) // buckets)
        mins, maxs = [], []
        for i in range(buckets):
            start = i * chunk
            end = min(len(data), start + chunk)
            segment = data[start:end]
            if len(segment) == 0:
                mins.append(0.0)
                maxs.append(0.0)
            else:
                mins.append(float(segment.min()) / 32768.0)
                maxs.append(float(segment.max()) / 32768.0)
        peaks[str(idx)] = {"min": mins, "max": maxs}

    duration = len(samples) / max(channels, 1) / rate if rate else 0
    return {"channels": channels, "sample_rate": rate, "duration": duration, "data": peaks}


def convert_to_m4a(wav_path: str, m4a_path: str, channels: int = 2) -> None:
    os.makedirs(os.path.dirname(m4a_path) or ".", exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", wav_path, "-c:a", "aac", "-b:a", "96k", "-ac", str(channels), m4a_path],
        check=True,
        capture_output=True,
    )


def process_job(client: httpx.Client, payload: dict) -> dict:
    recording_ids: dict[str, int] = payload.get("recording_ids", {})
    paths: dict[str, str] = payload.get("paths", {})
    results: dict = {}

    for leg, rec_id in recording_ids.items():
        wav_rel = paths.get(leg)
        if not wav_rel:
            continue
        wav_path = full_path(wav_rel)
        if not os.path.isfile(wav_path):
            raise FileNotFoundError(f"Missing WAV: {wav_path}")

        m4a_rel = os.path.splitext(wav_rel)[0] + ".m4a"
        m4a_path = full_path(m4a_rel)

        with wave.open(wav_path, "rb") as wf:
            rate = wf.getframerate()
            ch = wf.getnchannels()

        convert_to_m4a(wav_path, m4a_path, channels=max(ch, 1))
        peaks = generate_peaks(wav_path)
        size = os.path.getsize(m4a_path)

        client.patch(
            f"{BACKEND_URL}/api/workers/recordings/{rec_id}",
            headers=api_headers(),
            json={
                "path_m4a": m4a_rel,
                "peaks_json": peaks,
                "bytes": size,
                "sample_rate": rate,
                "channels": ch,
            },
        )
        results[leg] = {"m4a": m4a_rel, "bytes": size}

    return results


def main() -> None:
    with httpx.Client(timeout=120.0) as client:
        while True:
            try:
                resp = client.post(
                    f"{BACKEND_URL}/api/workers/jobs/claim",
                    params={"job_type": "media_convert"},
                    headers=api_headers(),
                )
                job = resp.json()
                if not job:
                    time.sleep(POLL_INTERVAL)
                    continue

                job_id = job["id"]
                try:
                    result = process_job(client, job["payload"])
                    client.post(
                        f"{BACKEND_URL}/api/workers/jobs/{job_id}/complete",
                        headers=api_headers(),
                        json={"result": result},
                    )
                except Exception as exc:
                    client.post(
                        f"{BACKEND_URL}/api/workers/jobs/{job_id}/complete",
                        headers=api_headers(),
                        json={"error": str(exc)},
                    )
            except Exception as exc:
                print(f"media-handler loop error: {exc}")
                time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
