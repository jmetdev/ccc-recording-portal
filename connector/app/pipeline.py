"""Per-call media pipeline: transcode + peaks + upload, then queue whisper."""

from __future__ import annotations

import logging
import os

from app import media, spool
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


def delete_local_mono_legs(paths: dict) -> None:
    """Remove local near/far WAV/M4A after transcription; keep stereo."""
    for leg in ("near", "far"):
        rel = paths.get(leg)
        if not rel:
            continue
        wav = _abs(rel)
        m4a = os.path.splitext(wav)[0] + ".m4a"
        for path in (wav, m4a):
            try:
                if os.path.isfile(path):
                    os.remove(path)
                    logger.info("deleted local mono media %s", path)
            except OSError as exc:
                logger.warning("failed to delete local mono media %s: %s", path, exc)


def finish_mono_cleanup(portal: PortalClient, call_id: int, paths: dict) -> None:
    """Drop near/far on portal + local disk once stereo is enough."""
    delete_local_mono_legs(paths)
    try:
        portal.purge_mono(call_id)
    except Exception as exc:  # noqa: BLE001 - local delete already done
        logger.warning("portal purge-mono failed for call %s: %s", call_id, exc)


def process_complete(portal: PortalClient, refci: str, files: dict, duration_s: float | None) -> None:
    call_id = _ensure_call_id(portal, refci)

    # 1) transcode + peaks + upload each available leg
    uploaded_rels: dict[str, str] = {}
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
        uploaded_rels[leg] = rel

    # 2) mark the cloud call complete (processed => no cloud jobs enqueued)
    portal.complete(refci, duration_s)
    logger.info("call %s media complete: legs=%s", refci, list(uploaded_rels))

    # 3) queue on-prem whisper sidecar when transcription is enabled
    if config.TRANSCRIBE and uploaded_rels:
        spool.enqueue(
            "transcribe",
            refci,
            {"call_id": call_id, "paths": uploaded_rels},
        )
        logger.info("call %s queued for whisper transcription", refci)
    elif uploaded_rels:
        # No Whisper: stereo alone is enough for playback.
        finish_mono_cleanup(portal, call_id, uploaded_rels)


def process_fail(portal: PortalClient, refci: str, reason: str | None, duration_s: float | None) -> None:
    portal.fail(refci, reason, duration_s)
