"""Cached portal config delivered on connector heartbeats."""

from __future__ import annotations

import threading
from typing import Any

_lock = threading.Lock()
_config: dict[str, Any] = {}


def update_from_heartbeat(body: dict[str, Any] | None) -> None:
    if not isinstance(body, dict):
        return
    cfg = body.get("config")
    if not isinstance(cfg, dict):
        return
    with _lock:
        global _config
        _config = cfg


def whisper_options() -> dict[str, str | None]:
    with _lock:
        whisper = (_config.get("whisper") or {}) if _config else {}
    if not isinstance(whisper, dict):
        return {"initial_prompt": None, "hotwords": None}
    prompt = whisper.get("initial_prompt")
    hotwords = whisper.get("hotwords")
    return {
        "initial_prompt": str(prompt).strip() if prompt else None,
        "hotwords": str(hotwords).strip() if hotwords else None,
    }
