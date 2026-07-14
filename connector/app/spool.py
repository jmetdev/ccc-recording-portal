"""Durable SQLite spool so hook POSTs return fast and survive restarts/offline.

Two tables:
  calls  — refci -> cloud call_id + start metadata (call_id filled once known)
  jobs   — queued work (complete/fail) with retry/backoff
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import time

from app.config import config

_lock = threading.Lock()


def _conn() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(config.SPOOL_DB) or ".", exist_ok=True)
    c = sqlite3.connect(config.SPOOL_DB, timeout=30)
    c.row_factory = sqlite3.Row
    return c


def init() -> None:
    with _lock, _conn() as c:
        c.execute(
            "CREATE TABLE IF NOT EXISTS calls ("
            "refci TEXT PRIMARY KEY, call_id INTEGER, meta_json TEXT, created_at REAL)"
        )
        c.execute(
            "CREATE TABLE IF NOT EXISTS jobs ("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT, refci TEXT, payload_json TEXT, "
            "attempts INTEGER DEFAULT 0, next_at REAL DEFAULT 0, created_at REAL)"
        )


def record_start(refci: str, meta: dict) -> None:
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO calls(refci, call_id, meta_json, created_at) VALUES(?,?,?,?) "
            "ON CONFLICT(refci) DO UPDATE SET meta_json=excluded.meta_json",
            (refci, None, json.dumps(meta), time.time()),
        )


def set_call_id(refci: str, call_id: int) -> None:
    with _lock, _conn() as c:
        c.execute("UPDATE calls SET call_id=? WHERE refci=?", (call_id, refci))


def get_call(refci: str) -> tuple[int | None, dict]:
    with _lock, _conn() as c:
        row = c.execute("SELECT call_id, meta_json FROM calls WHERE refci=?", (refci,)).fetchone()
    if not row:
        return None, {}
    return row["call_id"], json.loads(row["meta_json"] or "{}")


def enqueue(kind: str, refci: str, payload: dict) -> None:
    with _lock, _conn() as c:
        c.execute(
            "INSERT INTO jobs(kind, refci, payload_json, created_at) VALUES(?,?,?,?)",
            (kind, refci, json.dumps(payload), time.time()),
        )


def claim_due() -> sqlite3.Row | None:
    with _lock, _conn() as c:
        return c.execute(
            "SELECT * FROM jobs WHERE next_at <= ? ORDER BY id LIMIT 1", (time.time(),)
        ).fetchone()


def mark_done(job_id: int) -> None:
    with _lock, _conn() as c:
        c.execute("DELETE FROM jobs WHERE id=?", (job_id,))


def mark_retry(job_id: int, attempts: int) -> None:
    # exponential backoff capped at RETRY_MAX_S
    delay = min(config.RETRY_MAX_S, 2 ** min(attempts, 8))
    with _lock, _conn() as c:
        c.execute(
            "UPDATE jobs SET attempts=?, next_at=? WHERE id=?",
            (attempts, time.time() + delay, job_id),
        )


def queue_depth() -> int:
    with _lock, _conn() as c:
        return c.execute("SELECT COUNT(*) AS n FROM jobs").fetchone()["n"]
