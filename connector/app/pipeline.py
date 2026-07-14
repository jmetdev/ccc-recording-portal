"""Per-call media pipeline: transcode + peaks + whisper, then upload to the cloud."""

from __future__ import annotations

import logging
import os

from app import media, spool, transcribe
from app.config import config
from app.portal import PortalClient

logger = logging.getLogger("connector.pipeline")


def _abs(rel: str) -> str:
    return os.path.join(config.RECORDINGS_DIR, rel.lstrip("/"))


def _ensure_call_id(portal: PortalClient, refci: str) -> int:
    call_id, meta = spool.get_call(refci)
    if call_id is not None:
        return call_id
    # v2 start dedups by refci, so this is safe to (re)call.
    call_id = portal.start(refci, meta)
    spool.set_call_id(refci, call_id)
    return call_id


def process_complete(portal: PortalClient, refci: str, files: dict, duration_s: float | None) -> None:
    call_id = _ensure_call_id(portal, refci)

    # 1) transcode + peaks + upload each available leg
    uploaded: dict[str, str] = {}
    for leg, rel in files.items():
        wav = _abs(rel)
        if not os.path.isfile(wav):
            logger.warning("call %s leg %s: WAV missing (%s)", refci, leg, wav)
            continue
        rate, channels, dur = media.wav_meta(wav)
        m4a = os.path.splitext(wav)[0] + ".m4a"
        media.convert_to_m4a(wav, m4a, channels=max(channels, 1))
        peaks = media.generate_peaks(wav)
        portal.upload_media(
            call_id, leg, m4a, "audio/mp4",
            duration_s=dur, sample_rate=rate, channels=channels, peaks=peaks,
        )
        uploaded[leg] = wav

    # 2) transcribe per-speaker legs (fallback to stereo), attach transcripts
    if config.TRANSCRIBE:
        selected = [leg for leg in ("near", "far") if leg in uploaded]
        if not selected and "stereo" in uploaded:
            selected = ["stereo"]
        for leg in selected:
            try:
                text, segments, language = transcribe.transcribe_file(uploaded[leg], config.WHISPER_MODEL)
                if not text:
                    continue
                sentiment, score = transcribe.simple_sentiment(text)
                portal.create_transcript(call_id, leg, text, segments, language, sentiment, score)
            except Exception:
                logger.exception("transcription failed for call %s leg %s", refci, leg)

    # 3) mark the cloud call complete (processed => no cloud jobs enqueued)
    portal.complete(refci, duration_s)
    logger.info("call %s complete: legs=%s", refci, list(uploaded))


def process_fail(portal: PortalClient, refci: str, reason: str | None, duration_s: float | None) -> None:
    portal.fail(refci, reason, duration_s)
