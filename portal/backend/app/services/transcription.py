from __future__ import annotations

import asyncio
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

_transcription_enabled: bool | None = None
_detection_reason: str = "not initialized"


def _parse_bool(value: str) -> bool | None:
    normalized = value.strip().lower()
    if normalized in ("1", "true", "yes", "on"):
        return True
    if normalized in ("0", "false", "no", "off"):
        return False
    return None


async def _is_whisper_container_running(container_name: str) -> bool:
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker",
            "inspect",
            "-f",
            "{{.State.Status}}",
            container_name,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _stderr = await asyncio.wait_for(proc.communicate(), timeout=5)
    except (TimeoutError, OSError):
        return False

    if proc.returncode != 0:
        return False
    return stdout.decode().strip().lower() == "running"


async def init_transcription_enabled() -> bool:
    """Detect transcription availability once at application startup."""
    global _transcription_enabled, _detection_reason

    explicit = settings.transcription_enabled.strip()
    if explicit:
        parsed = _parse_bool(explicit)
        if parsed is None:
            raise ValueError(f"Invalid TRANSCRIPTION_ENABLED value: {explicit!r}")
        _transcription_enabled = parsed
        _detection_reason = f"TRANSCRIPTION_ENABLED={explicit!r}"
    else:
        running = await _is_whisper_container_running(settings.whisper_container_name)
        _transcription_enabled = running
        _detection_reason = (
            f"whisper container {settings.whisper_container_name!r} running"
            if running
            else f"whisper container {settings.whisper_container_name!r} not running"
        )

    state = "enabled" if _transcription_enabled else "disabled"
    logger.info("Transcription %s (%s)", state, _detection_reason)
    return _transcription_enabled


def is_transcription_enabled() -> bool:
    if _transcription_enabled is None:
        raise RuntimeError("transcription availability has not been initialized at startup")
    return _transcription_enabled


def transcription_detection_reason() -> str:
    return _detection_reason
