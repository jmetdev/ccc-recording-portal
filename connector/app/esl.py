"""Minimal FreeSWITCH Event Socket client for connector probes."""

from __future__ import annotations

import json
import logging
import os
import socket
import time
from contextlib import contextmanager
from typing import Any, Callable, Iterator

logger = logging.getLogger("connector.esl")

FS_ESL_HOST = os.environ.get("FS_ESL_HOST", "127.0.0.1")
FS_ESL_PORT = int(os.environ.get("FS_ESL_PORT", "8021"))
FS_ESL_PASSWORD = os.environ.get("FS_ESL_PASSWORD", "ChangeMe-ESL-Password")

_BIB_VARS = ("bib_refci", "bib_near_addr", "bib_far_addr", "bib_leg")


def _read_message(sock: socket.socket) -> tuple[dict[str, str], bytes]:
    headers: dict[str, str] = {}
    while True:
        line = b""
        while not line.endswith(b"\n"):
            chunk = sock.recv(1)
            if not chunk:
                return headers, b""
            line += chunk
        if line in (b"\n", b"\r\n"):
            break
        text = line.decode(errors="replace").rstrip("\r\n")
        if ":" in text:
            key, value = text.split(":", 1)
            headers[key.strip().lower()] = value.strip()
    length = int(headers.get("content-length", "0") or 0)
    body = b""
    while len(body) < length:
        chunk = sock.recv(length - len(body))
        if not chunk:
            break
        body += chunk
    return headers, body


@contextmanager
def _esl_api(timeout: float = 5.0) -> Iterator[Callable[[str], str]]:
    sock = socket.create_connection((FS_ESL_HOST, FS_ESL_PORT), timeout=timeout)
    sock.settimeout(timeout)
    try:
        _read_message(sock)  # auth/request
        sock.sendall(f"auth {FS_ESL_PASSWORD}\n\n".encode())
        headers, _ = _read_message(sock)
        reply = headers.get("reply-text", "")
        if not reply.startswith("+OK"):
            raise RuntimeError(f"ESL auth failed: {reply or 'no reply'}")

        def api(command: str) -> str:
            sock.sendall(f"api {command}\n\n".encode())
            _, body = _read_message(sock)
            return body.decode(errors="replace")

        yield api
    finally:
        sock.close()


def esl_api(command: str, *, timeout: float = 5.0) -> str:
    """Run an ESL ``api`` command and return the body text."""
    with _esl_api(timeout=timeout) as api:
        return api(command)


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
    if callstate in {"active", "ringing"} and _row_get(
        row, "variable_bib_refci", "variable_sip_from_x-refci"
    ):
        return True
    return False


def _clean_var(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text or text.startswith("-ERR") or text == "_undef_":
        return None
    return text


def _normalize_channel(row: dict[str, Any], bib: dict[str, str | None] | None = None) -> dict[str, Any]:
    created_epoch = _row_get(row, "created_epoch")
    duration_s: float | None = None
    if created_epoch:
        try:
            duration_s = max(0.0, time.time() - float(created_epoch))
        except ValueError:
            duration_s = None
    bib = bib or {}
    return {
        "uuid": _row_get(row, "uuid"),
        "refci": bib.get("bib_refci")
        or _row_get(row, "variable_bib_refci", "variable_sip_from_x-refci"),
        "near_addr": bib.get("bib_near_addr")
        or _row_get(row, "variable_bib_near_addr", "variable_sip_from_x-nearendaddr"),
        "far_addr": bib.get("bib_far_addr")
        or _row_get(row, "variable_bib_far_addr", "variable_sip_from_x-farendaddr"),
        "leg": bib.get("bib_leg") or _row_get(row, "variable_bib_leg"),
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


def dedupe_channels_by_refci(channels: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse near/far BIB forks into one row per call (refci)."""
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


def list_active_recording_channels() -> list[dict[str, Any]]:
    """Return active BIB recording channels from FreeSWITCH (with codecs)."""
    try:
        with _esl_api() as api:
            raw = api("show channels as json")
            payload = json.loads(raw.strip() or "{}")
            rows = payload.get("rows") if isinstance(payload, dict) else None
            if not isinstance(rows, list):
                return []
            channels: list[dict[str, Any]] = []
            for row in rows:
                if not isinstance(row, dict) or not _is_active_recording(row):
                    continue
                uuid = _row_get(row, "uuid")
                if not uuid:
                    continue
                # show channels omits channel vars; pull BIB metadata per uuid.
                bib = {
                    var: _clean_var(api(f"uuid_getvar {uuid} {var}"))
                    for var in _BIB_VARS
                }
                channels.append(_normalize_channel(row, bib))
            return dedupe_channels_by_refci(channels)
    except Exception as exc:  # noqa: BLE001 - best-effort for heartbeat
        logger.warning("ESL show channels failed: %s", exc)
        return []
