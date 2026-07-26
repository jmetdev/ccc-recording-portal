"""Local edge-stack probes for connector heartbeats.

The cloud portal cannot docker-inspect on-prem FreeSWITCH / whisper (and often
cannot reach the host Docker daemon at all). The connector runs next to those
containers, so it reports SIP Switch (ESL) + whisper liveness in heartbeat
stats for the Health / Status page.
"""

from __future__ import annotations

import os
import socket
import time
from threading import Lock

from app.config import config

_whisper_last_claim_at: float | None = None
_lock = Lock()

FS_ESL_HOST = os.environ.get("FS_ESL_HOST", "127.0.0.1")
FS_ESL_PORT = int(os.environ.get("FS_ESL_PORT", "8021"))
WHISPER_STALE_AFTER_S = int(os.environ.get("WHISPER_STALE_AFTER_S", "120"))


def note_whisper_claim() -> None:
    """Record that the whisper sidecar polled /api/workers/jobs/claim."""
    global _whisper_last_claim_at
    with _lock:
        _whisper_last_claim_at = time.time()


def check_sip_switch() -> dict:
    """TCP probe FreeSWITCH ESL — no docker socket or fs_cli required."""
    try:
        with socket.create_connection((FS_ESL_HOST, FS_ESL_PORT), timeout=2.0):
            return {
                "ok": True,
                "detail": f"ESL {FS_ESL_HOST}:{FS_ESL_PORT} reachable",
            }
    except OSError as exc:
        return {
            "ok": False,
            "detail": f"ESL {FS_ESL_HOST}:{FS_ESL_PORT} unreachable ({exc})",
        }


def check_whisper() -> dict:
    if not config.TRANSCRIBE:
        return {"ok": None, "detail": "transcription disabled on connector"}
    with _lock:
        last = _whisper_last_claim_at
    if last is None:
        # Unknown (not failed) until the sidecar's first poll — avoids a red
        # flash between connector start and whisper's first claim cycle.
        return {"ok": None, "detail": "waiting for whisper poll"}
    age_s = int(time.time() - last)
    if age_s <= WHISPER_STALE_AFTER_S:
        return {
            "ok": True,
            "detail": f"last poll {age_s}s ago",
            "last_seen_s": age_s,
        }
    return {
        "ok": False,
        "detail": f"whisper stale ({age_s}s since last poll)",
        "last_seen_s": age_s,
    }


def _component(
    name: str,
    *,
    ok: bool | None,
    detail: str | None,
    status_when_ok: str = "running",
) -> dict:
    if ok is None:
        state, status, health = "unknown", "disabled", None
    elif ok:
        state, status, health = "healthy", status_when_ok, "healthy"
    else:
        state, status, health = "down", "unreachable", "unhealthy"
    return {
        "name": name,
        "state": state,
        "status": status,
        "health": health,
        "image": None,
        "started_at": None,
        "detail": detail,
        "source": "connector",
    }


def collect_heartbeat_stats(queue_depth: int) -> dict:
    sip = check_sip_switch()
    whisper = check_whisper()
    components = [
        _component("sip-switch", ok=bool(sip.get("ok")), detail=sip.get("detail")),
        _component("connector", ok=True, detail="heartbeat"),
    ]
    if config.TRANSCRIBE:
        components.append(
            _component("whisper", ok=whisper.get("ok"), detail=whisper.get("detail"))
        )
    return {
        "queue_depth": queue_depth,
        "sip_switch": sip,
        "whisper": whisper,
        "components": components,
    }
