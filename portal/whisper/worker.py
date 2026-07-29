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
WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")

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


def _segment_dict(seg) -> dict:
    """Build a segment dict; prefer word-level bounds when available."""
    start = float(seg.start)
    end = float(seg.end)
    words = getattr(seg, "words", None) or []
    word_starts = [float(w.start) for w in words if getattr(w, "start", None) is not None]
    word_ends = [float(w.end) for w in words if getattr(w, "end", None) is not None]
    if word_starts:
        start = word_starts[0]
    if word_ends:
        end = word_ends[-1]
    if end < start:
        end = start
    return {"start": start, "end": end, "text": (seg.text or "").strip()}


def normalize_vad_parameters(params: dict) -> dict:
    """Map vad_parameters for faster-whisper 1.1.0 (onset) vs 1.1.1+ (threshold)."""
    try:
        import dataclasses

        from faster_whisper.vad import VadOptions

        allowed = {f.name for f in dataclasses.fields(VadOptions)}
    except Exception:
        return params
    out = dict(params)
    if "threshold" in out and "threshold" not in allowed and "onset" in allowed:
        out["onset"] = out.pop("threshold")
    return {k: v for k, v in out.items() if k in allowed}


def transcribe_file(model, path: str, whisper_opts: dict | None = None) -> tuple[str, list, str | None]:
    """Transcribe one mono leg with telephony-oriented faster-whisper settings.

    Dual-channel BIB legs have long listening silence (the other party talking).
    We keep ``condition_on_previous_text=False`` so Whisper does not stitch
    across those gaps. Silero VAD is enabled — faster-whisper restores segment
    times onto the original timeline via ``restore_speech_timestamps``. Word
    timestamps refine bubble start/end. Leading-silence alignment remains a
    safety net when the first stamp still collapses to ~0.
    """
    opts = whisper_opts or {}
    kwargs: dict = {
        "language": opts.get("language") or "en",
        "beam_size": int(opts.get("beam_size") or 5),
        "best_of": int(opts.get("best_of") or 5),
        "temperature": 0.0,
        "vad_filter": True,
        "vad_parameters": {
            # Phone turn-taking: split on short pauses, pad speech edges.
            "threshold": 0.5,
            "min_speech_duration_ms": 250,
            "min_silence_duration_ms": 400,
            "speech_pad_ms": 300,
        },
        "word_timestamps": True,
        "condition_on_previous_text": False,
        "no_speech_threshold": 0.6,
        "compression_ratio_threshold": 2.4,
        "log_prob_threshold": -1.0,
    }
    if opts.get("initial_prompt"):
        kwargs["initial_prompt"] = opts["initial_prompt"]
    if opts.get("hotwords"):
        kwargs["hotwords"] = opts["hotwords"]
    if "vad_filter" in opts:
        kwargs["vad_filter"] = bool(opts["vad_filter"])
    if isinstance(opts.get("vad_parameters"), dict):
        kwargs["vad_parameters"] = normalize_vad_parameters(
            {**kwargs["vad_parameters"], **opts["vad_parameters"]}
        )
    else:
        kwargs["vad_parameters"] = normalize_vad_parameters(kwargs["vad_parameters"])

    segments, info = model.transcribe(path, **kwargs)
    seg_list = []
    texts = []
    for seg in segments:
        item = _segment_dict(seg)
        if not item["text"]:
            continue
        seg_list.append(item)
        texts.append(item["text"])
    seg_list = align_segments_to_audio(path, seg_list)
    text = " ".join(texts).strip()
    return text, seg_list, getattr(info, "language", None)


def process_job(client: httpx.Client, model, payload: dict) -> dict:
    call_id = payload["call_id"]
    recording_ids = payload.get("recording_ids", {})
    paths = payload.get("paths", {})
    whisper_opts = payload.get("whisper") if isinstance(payload.get("whisper"), dict) else {}
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
        text, segments, language = transcribe_file(model, path, whisper_opts)
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
