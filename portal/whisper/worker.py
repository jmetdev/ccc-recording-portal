#!/usr/bin/env python3
"""Optional faster-whisper transcription worker."""

from __future__ import annotations

import os
import time

import httpx

BACKEND_URL = os.environ.get("BACKEND_URL", "http://backend:8000")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")
RECORDINGS_DIR = os.environ.get("RECORDINGS_DIR", "/recordings")
POLL_INTERVAL = float(os.environ.get("POLL_INTERVAL", "5"))
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "base")

POSITIVE = {"great", "good", "excellent", "thanks", "thank", "happy", "perfect", "wonderful"}
NEGATIVE = {"bad", "terrible", "angry", "upset", "problem", "issue", "complaint", "wrong", "hate"}


def api_headers() -> dict[str, str]:
    return {"X-Worker-Token": WORKER_TOKEN}


def full_path(rel: str) -> str:
    return os.path.join(RECORDINGS_DIR, rel.lstrip("/"))


def simple_sentiment(text: str) -> tuple[str, float]:
    words = {w.strip(".,!?").lower() for w in text.split()}
    pos = len(words & POSITIVE)
    neg = len(words & NEGATIVE)
    if pos > neg:
        return "positive", min(1.0, 0.5 + pos * 0.1)
    if neg > pos:
        return "negative", max(-1.0, -0.5 - neg * 0.1)
    return "neutral", 0.0


def transcribe_file(model, path: str) -> tuple[str, list, str | None]:
    segments, info = model.transcribe(path, beam_size=1)
    seg_list = []
    texts = []
    for seg in segments:
        seg_list.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
        texts.append(seg.text.strip())
    text = " ".join(texts).strip()
    return text, seg_list, getattr(info, "language", None)


def process_job(client: httpx.Client, model, payload: dict) -> dict:
    call_id = payload["call_id"]
    recording_ids = payload.get("recording_ids", {})
    paths = payload.get("paths", {})
    results = {}

    available: dict[str, str] = {}
    for leg in ("near", "far", "stereo"):
        wav_rel = paths.get(leg)
        if not recording_ids.get(leg) or not wav_rel:
            continue
        path = full_path(wav_rel)
        if os.path.isfile(path):
            available[leg] = path

    # Transcribe per-speaker legs when present; the stereo mix duplicates their
    # content, so it is only used as a fallback when no leg file exists.
    selected = [leg for leg in ("near", "far") if leg in available]
    if not selected and "stereo" in available:
        selected = ["stereo"]

    for leg in selected:
        path = available[leg]
        text, segments, language = transcribe_file(model, path)
        if not text:
            continue
        sentiment, score = simple_sentiment(text)
        resp = client.post(
            f"{BACKEND_URL}/api/workers/transcripts",
            headers=api_headers(),
            json={
                "call_id": call_id,
                "leg": leg,
                "language": language,
                "text": text,
                "segments_json": segments,
                "sentiment": sentiment,
                "sentiment_score": score,
            },
        )
        resp.raise_for_status()
        results[leg] = {"chars": len(text), "sentiment": sentiment}

    return results


def main() -> None:
    from faster_whisper import WhisperModel

    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")

    with httpx.Client(timeout=600.0) as client:
        while True:
            try:
                resp = client.post(
                    f"{BACKEND_URL}/api/workers/jobs/claim",
                    params={"job_type": "transcribe"},
                    headers=api_headers(),
                )
                job = resp.json()
                if not job:
                    time.sleep(POLL_INTERVAL)
                    continue

                job_id = job["id"]
                try:
                    result = process_job(client, model, job["payload"])
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
                print(f"whisper loop error: {exc}")
                time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
