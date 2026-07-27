from __future__ import annotations

import asyncio
import json
import logging
import shlex
import time
from typing import Any

from app.core.config import settings

logger = logging.getLogger(__name__)


def _parse_fs_cli_output(raw: str) -> list[dict[str, Any]]:
    raw = raw.strip()
    if not raw:
        return []
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return []
    rows = payload.get("rows")
    return rows if isinstance(rows, list) else []


def _row_get(row: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        value = row.get(key)
        if value not in (None, ""):
            return str(value)
    return None


def _is_active_recording(row: dict[str, Any]) -> bool:
    dest = _row_get(row, "dest", "destination_number") or ""
    application = (_row_get(row, "application") or "").lower()
    callstate = (_row_get(row, "callstate") or "").lower()
    if dest == "1034":
        return True
    if "record_session" in application:
        return True
    if callstate in {"active", "ringing"} and _row_get(row, "variable_bib_refci", "variable_sip_from_x-refci"):
        return True
    return False


def _normalize_channel(row: dict[str, Any]) -> dict[str, Any]:
    created_epoch = _row_get(row, "created_epoch")
    duration_s: float | None = None
    if created_epoch:
        try:
            duration_s = max(0.0, time.time() - float(created_epoch))
        except ValueError:
            duration_s = None

    return {
        "uuid": _row_get(row, "uuid"),
        "refci": _row_get(row, "variable_bib_refci", "variable_sip_from_x-refci"),
        "near_addr": _row_get(row, "variable_bib_near_addr", "variable_sip_from_x-nearendaddr"),
        "far_addr": _row_get(row, "variable_bib_far_addr", "variable_sip_from_x-farendaddr"),
        "leg": _row_get(row, "variable_bib_leg"),
        "dest": _row_get(row, "dest", "destination_number"),
        "direction": _row_get(row, "direction"),
        "cid_num": _row_get(row, "cid_num"),
        "cid_name": _row_get(row, "cid_name"),
        "application": _row_get(row, "application"),
        "read_codec": _row_get(row, "read_codec"),
        "write_codec": _row_get(row, "write_codec"),
        "callstate": _row_get(row, "callstate"),
        "created_epoch": float(created_epoch) if created_epoch else None,
        "duration_s": duration_s,
    }


async def list_active_recording_channels() -> list[dict[str, Any]]:
    prefix = settings.freeswitch_fs_cli.strip()
    if not prefix:
        return []

    cmd = [*shlex.split(prefix), "-x", "show channels as json"]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=8)
    except (TimeoutError, OSError) as exc:
        logger.warning("fs_cli failed: %s", exc)
        return []

    if proc.returncode != 0:
        logger.warning("fs_cli exit %s: %s", proc.returncode, stderr.decode().strip())
        return []

    channels = [_normalize_channel(row) for row in _parse_fs_cli_output(stdout.decode()) if _is_active_recording(row)]
    channels = [c for c in channels if c.get("uuid")]
    return _dedupe_channels_by_refci(channels)


def _dedupe_channels_by_refci(channels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse near/far BIB forks into one row per call."""
    by_key: dict[str, dict[str, Any]] = {}
    order: list[str] = []
    for ch in channels:
        key = ch.get("refci") or ch.get("uuid") or ""
        if not key:
            continue
        existing = by_key.get(key)
        if existing is None:
            by_key[key] = dict(ch)
            order.append(key)
            continue
        for field in (
            "near_addr",
            "far_addr",
            "read_codec",
            "write_codec",
            "cid_num",
            "cid_name",
            "created_epoch",
            "duration_s",
        ):
            if not existing.get(field) and ch.get(field):
                existing[field] = ch[field]
        if ch.get("leg") == "far":
            existing["uuid"] = ch.get("uuid") or existing.get("uuid")
        if ch.get("created_epoch") and (
            not existing.get("created_epoch")
            or float(ch["created_epoch"]) < float(existing["created_epoch"])
        ):
            existing["created_epoch"] = ch["created_epoch"]
            existing["duration_s"] = ch.get("duration_s")
    return [by_key[k] for k in order]
