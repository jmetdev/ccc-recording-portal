"""Local faster-whisper transcription (ported from portal/whisper)."""

from __future__ import annotations

import logging

logger = logging.getLogger("connector.transcribe")

POSITIVE = {"great", "good", "excellent", "thanks", "thank", "happy", "perfect", "wonderful"}
NEGATIVE = {"bad", "terrible", "angry", "upset", "problem", "issue", "complaint", "wrong", "hate"}

_model = None


def _get_model(model_name: str):
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        logger.info("loading whisper model '%s' (cpu/int8)", model_name)
        _model = WhisperModel(model_name, device="cpu", compute_type="int8")
    return _model


def simple_sentiment(text: str) -> tuple[str, float]:
    words = {w.strip(".,!?").lower() for w in text.split()}
    pos = len(words & POSITIVE)
    neg = len(words & NEGATIVE)
    if pos > neg:
        return "positive", min(1.0, 0.5 + pos * 0.1)
    if neg > pos:
        return "negative", max(-1.0, -0.5 - neg * 0.1)
    return "neutral", 0.0


def transcribe_file(path: str, model_name: str) -> tuple[str, list, str | None]:
    model = _get_model(model_name)
    segments, info = model.transcribe(path, beam_size=1)
    seg_list, texts = [], []
    for seg in segments:
        seg_list.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
        texts.append(seg.text.strip())
    text = " ".join(texts).strip()
    return text, seg_list, getattr(info, "language", None)
