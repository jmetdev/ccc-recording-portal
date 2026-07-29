#!/usr/bin/env python3
"""On-prem faster-whisper worker for the CUCM connector.

Polls the local connector for ``transcribe`` jobs, writes transcripts back
through the connector (which forwards them to the cloud portal). Shares the
recordings volume with FreeSWITCH + the connector.
"""

from __future__ import annotations

import os
import time

import httpx

CONNECTOR_URL = os.environ.get("CONNECTOR_URL", "http://127.0.0.1:9000").rstrip("/")
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


def measure_leading_silence_s(path: str, *, thresh: float = 0.012, frame_ms: int = 20) -> float:
    """Return seconds of leading near-silence in a mono PCM WAV.

    Whisper often stamps the first utterance at t≈0 even when the leg has
    listening silence (other party talking). We measure energy onset so
    segments can be shifted onto the real stereo timeline.
    """
    import math
    import struct
    import wave

    try:
        with wave.open(path, "rb") as wf:
            if wf.getnchannels() != 1 or wf.getsampwidth() != 2:
                return 0.0
            rate = wf.getframerate()
            if rate <= 0:
                return 0.0
            frame_len = max(1, int(rate * frame_ms / 1000))
            total = wf.getnframes()
            read = 0
            while read < total:
                raw = wf.readframes(frame_len)
                if not raw:
                    break
                n = len(raw) // 2
                if n == 0:
                    break
                samples = struct.unpack("<" + "h" * n, raw[: n * 2])
                # RMS normalized to 0..1 for 16-bit PCM
                rms = math.sqrt(sum(s * s for s in samples) / n) / 32768.0
                if rms >= thresh:
                    return read / rate
                read += n
    except Exception:
        return 0.0
    return 0.0


def align_segments_to_audio(path: str, segments: list[dict]) -> list[dict]:
    """Shift Whisper segment times when leading silence was collapsed to t=0."""
    if not segments:
        return segments
    first = float(segments[0].get("start") or 0.0)
    # Only correct the common failure mode: first stamp near zero despite silence.
    if first > 0.35:
        return segments
    silence = measure_leading_silence_s(path)
    if silence < 0.4:
        return segments
    delta = silence - first
    if delta < 0.35:
        return segments
    out = []
    for seg in segments:
        out.append(
            {
                **seg,
                "start": float(seg["start"]) + delta,
                "end": float(seg["end"]) + delta,
            }
        )
    return out


def transcribe_file(model, path: str, whisper_opts: dict | None = None) -> tuple[str, list, str | None]:
    opts = whisper_opts or {}
    # Dual-channel BIB legs: silence on one side is usually the other party
    # talking (this side listening). Do NOT enable VAD — it strips that
    # "silence" and shifts timestamps. Also avoid conditioning on prior text
    # so Whisper does not stitch utterances across listening gaps.
    kwargs: dict = {
        "beam_size": 1,
        "vad_filter": False,
        "condition_on_previous_text": False,
    }
    if opts.get("initial_prompt"):
        kwargs["initial_prompt"] = opts["initial_prompt"]
    if opts.get("hotwords"):
        kwargs["hotwords"] = opts["hotwords"]
    segments, info = model.transcribe(path, **kwargs)
    seg_list = []
    texts = []
    for seg in segments:
        seg_list.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
        texts.append(seg.text.strip())
    seg_list = align_segments_to_audio(path, seg_list)
    text = " ".join(texts).strip()
    return text, seg_list, getattr(info, "language", None)


def process_job(client: httpx.Client, model, payload: dict) -> dict:
    call_id = payload["call_id"]
    paths = payload.get("paths", {})
    whisper_opts = payload.get("whisper") if isinstance(payload.get("whisper"), dict) else {}
    results: dict = {}

    available: dict[str, str] = {}
    for leg in ("near", "far", "stereo"):
        wav_rel = paths.get(leg)
        if not wav_rel:
            continue
        path = full_path(wav_rel)
        if os.path.isfile(path):
            available[leg] = path

    # Prefer per-speaker legs; stereo only as fallback.
    selected = [leg for leg in ("near", "far") if leg in available]
    if not selected and "stereo" in available:
        selected = ["stereo"]

    for leg in selected:
        path = available[leg]
        text, segments, language = transcribe_file(model, path, whisper_opts)
        if not text:
            continue
        sentiment, score = simple_sentiment(text)
        resp = client.post(
            f"{CONNECTOR_URL}/api/workers/transcripts",
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

    print(f"whisper worker starting model={WHISPER_MODEL} connector={CONNECTOR_URL}")
    model = WhisperModel(WHISPER_MODEL, device="cpu", compute_type="int8")

    with httpx.Client(timeout=600.0) as client:
        while True:
            try:
                resp = client.post(
                    f"{CONNECTOR_URL}/api/workers/jobs/claim",
                    params={"job_type": "transcribe"},
                    headers=api_headers(),
                )
                resp.raise_for_status()
                job = resp.json()
                if not job:
                    time.sleep(POLL_INTERVAL)
                    continue

                job_id = job["id"]
                try:
                    result = process_job(client, model, job["payload"])
                    client.post(
                        f"{CONNECTOR_URL}/api/workers/jobs/{job_id}/complete",
                        headers=api_headers(),
                        json={"result": result},
                    ).raise_for_status()
                except Exception as exc:
                    client.post(
                        f"{CONNECTOR_URL}/api/workers/jobs/{job_id}/complete",
                        headers=api_headers(),
                        json={"error": str(exc)},
                    )
            except Exception as exc:
                print(f"whisper loop error: {exc}")
                time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
