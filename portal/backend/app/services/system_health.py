from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Call, CallSource, CallStatus, ConnectorCredential, Job, JobStatus, Transcript
from app.services.freeswitch import list_active_recording_channels
from app.services.transcription import is_transcription_enabled

logger = logging.getLogger(__name__)

# Cloud connector heartbeats fire every 60-300s depending on kind; 10 minutes
# gives headroom for a slow poll cycle before flagging a connector as stale.
CONNECTOR_STALE_AFTER_S = 600

LOG_SOURCES: dict[str, str | None] = {
    "ingest": ".bib-hook.log",
    "portal-backend": "portal-backend",
    "portal-media-handler": "portal-media-handler",
    "freeswitch": "freeswitch",
}


def _container_state(status: str, health: str) -> str:
    status = status.lower()
    health = health.lower()
    if status != "running":
        return "down"
    if health in ("healthy", "none", ""):
        return "healthy"
    if health == "starting":
        return "starting"
    return "unhealthy"


async def _run_docker(*args: str, timeout: float = 8) -> tuple[int, str, str]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        return proc.returncode or 0, stdout.decode(), stderr.decode()
    except (TimeoutError, OSError) as exc:
        return 1, "", str(exc)


async def inspect_containers() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for name in settings.system_container_list:
        code, stdout, stderr = await _run_docker(
            "inspect",
            name,
            "--format",
            "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}|{{.State.StartedAt}}",
        )
        if code != 0:
            results.append(
                {
                    "name": name,
                    "state": "unknown",
                    "status": "not found",
                    "health": None,
                    "image": None,
                    "started_at": None,
                    "detail": stderr.strip() or "container not found",
                }
            )
            continue
        parts = stdout.strip().split("|", 3)
        status = parts[0] if len(parts) > 0 else "unknown"
        health = parts[1] if len(parts) > 1 else "none"
        image = parts[2] if len(parts) > 2 else None
        started_at = parts[3] if len(parts) > 3 else None
        results.append(
            {
                "name": name,
                "state": _container_state(status, health),
                "status": status,
                "health": None if health == "none" else health,
                "image": image,
                "started_at": started_at,
                "detail": None,
            }
        )
    return results


async def check_database(db: AsyncSession) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        await db.execute(text("SELECT 1"))
        latency_ms = round((time.perf_counter() - started) * 1000, 1)
        return {"ok": True, "latency_ms": latency_ms}
    except Exception as exc:
        logger.warning("database health check failed: %s", exc)
        return {"ok": False, "latency_ms": None, "error": str(exc)}


def check_recordings_mount() -> dict[str, Any]:
    path = settings.recordings_dir
    try:
        exists = os.path.isdir(path)
        readable = os.access(path, os.R_OK)
        writable = os.access(path, os.W_OK)
        wav_count = 0
        if exists and readable:
            wav_count = sum(1 for name in os.listdir(path) if name.endswith(".wav"))
        hook_log = os.path.join(path, ".bib-hook.log")
        return {
            "ok": exists and readable,
            "path": path,
            "readable": readable,
            "writable": writable,
            "wav_count": wav_count,
            "ingest_log_exists": os.path.isfile(hook_log),
        }
    except OSError as exc:
        return {"ok": False, "path": path, "error": str(exc)}


async def check_freeswitch() -> dict[str, Any]:
    configured = bool(settings.freeswitch_fs_cli.strip())
    channels: list[dict[str, Any]] = []
    if configured:
        channels = await list_active_recording_channels()
    return {
        "fs_cli_configured": configured,
        "active_recording_channels": len(channels),
    }


async def fetch_connector_health(db: AsyncSession, tenant_id: int) -> list[dict[str, Any]]:
    """Per-tenant connector inventory with a computed liveness status.

    Status is 'disabled' for a revoked credential, 'unseen' if it has never
    heartbeated, else 'healthy'/'stale' by how long ago the last one landed.
    """
    result = await db.execute(
        select(ConnectorCredential)
        .where(ConnectorCredential.tenant_id == tenant_id)
        .order_by(ConnectorCredential.created_at)
    )
    now = datetime.now(timezone.utc)
    rows: list[dict[str, Any]] = []
    for cred in result.scalars().all():
        if not cred.enabled:
            status = "disabled"
        elif cred.last_seen_at is None:
            status = "unseen"
        else:
            age_s = (now - cred.last_seen_at).total_seconds()
            status = "healthy" if age_s <= CONNECTOR_STALE_AFTER_S else "stale"
        rows.append(
            {
                "id": cred.id,
                "name": cred.name,
                "kind": cred.kind.value,
                "enabled": cred.enabled,
                "status": status,
                "last_seen_at": cred.last_seen_at,
                "version": cred.version,
                "stats": cred.stats_json,
            }
        )
    return rows


async def fetch_transcription_coverage(db: AsyncSession, tenant_id: int) -> dict[str, Any]:
    """How many completed calls actually have a transcript, per source.

    Transcripts are delivered by connectors (Webex VTT today, on-prem
    whisper for CUCM), not a portal-managed worker, so "healthy" here means
    coverage — not whether some local process is running.
    """
    total_stmt = (
        select(Call.source, func.count(func.distinct(Call.refci)))
        .where(Call.tenant_id == tenant_id, Call.status == CallStatus.COMPLETED)
        .group_by(Call.source)
    )
    covered_stmt = (
        select(Call.source, func.count(func.distinct(Call.refci)))
        .join(Transcript, Transcript.call_id == Call.id)
        .where(Call.tenant_id == tenant_id, Call.status == CallStatus.COMPLETED)
        .group_by(Call.source)
    )
    totals = dict((await db.execute(total_stmt)).all())
    covered = dict((await db.execute(covered_stmt)).all())

    by_source = {
        source.value: {
            "total_calls": totals.get(source, 0),
            "transcribed_calls": covered.get(source, 0),
        }
        for source in CallSource
        if totals.get(source, 0)
    }
    total_calls = sum(v["total_calls"] for v in by_source.values())
    transcribed_calls = sum(v["transcribed_calls"] for v in by_source.values())
    return {"by_source": by_source, "total_calls": total_calls, "transcribed_calls": transcribed_calls}


async def fetch_recent_failures(db: AsyncSession, limit: int = 25) -> list[dict[str, Any]]:
    call_result = await db.execute(
        select(Call)
        .where(Call.status == CallStatus.FAILED)
        .order_by(Call.started_at.desc())
        .limit(limit)
    )
    calls = list(call_result.scalars().all())
    if not calls:
        return []

    call_ids = [c.id for c in calls]
    jobs_result = await db.execute(
        select(Job).where(
            Job.status == JobStatus.FAILED,
            Job.payload["call_id"].as_integer().in_(call_ids),
        )
    )
    jobs_by_call: dict[int, list[Job]] = {}
    for job in jobs_result.scalars().all():
        cid = job.payload.get("call_id")
        if cid is not None:
            jobs_by_call.setdefault(int(cid), []).append(job)

    rows: list[dict[str, Any]] = []
    for call in calls:
        message = call.status_message
        stage = "unknown"
        if message:
            if message.startswith("Ingest:"):
                stage = "ingest"
            elif message.startswith("Recording timed out"):
                stage = "recording"
            elif "media_convert" in message or "transcribe" in message:
                stage = "worker"
        elif call.id in jobs_by_call:
            stage = "worker"
            parts = [f"{j.job_type.value}: {j.error or 'unknown'}" for j in jobs_by_call[call.id]]
            message = "; ".join(parts)

        rows.append(
            {
                "call_id": call.id,
                "refci": call.refci,
                "near_addr": call.near_addr,
                "far_addr": call.far_addr,
                "started_at": call.started_at,
                "ended_at": call.ended_at,
                "stage": stage,
                "message": message or "No failure details recorded",
            }
        )
    return rows


def _tail_file(path: str, lines: int) -> list[str]:
    if not os.path.isfile(path):
        return [f"(log file not found: {path})"]
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            content = f.readlines()
        tail = content[-lines:]
        return [line.rstrip("\n") for line in tail] if tail else ["(empty log)"]
    except OSError as exc:
        return [f"(unable to read log: {exc})"]


async def fetch_log_lines(source: str, lines: int = 100) -> dict[str, Any]:
    source = source.lower()
    if source not in LOG_SOURCES:
        return {"source": source, "lines": [f"Unknown log source: {source}"]}

    file_name = LOG_SOURCES[source]
    if file_name and file_name.startswith("."):
        path = os.path.join(settings.recordings_dir, file_name)
        return {"source": source, "lines": _tail_file(path, lines)}

    container = file_name or source
    code, stdout, stderr = await _run_docker(
        "logs",
        "--tail",
        str(lines),
        container,
        timeout=15,
    )
    if code != 0:
        detail = stderr.strip() or stdout.strip() or "failed to read container logs"
        return {"source": source, "lines": [f"(docker logs error: {detail})"]}
    log_lines = stdout.splitlines()
    return {"source": source, "lines": log_lines if log_lines else ["(empty log)"]}


def _sanitize_container(c: dict[str, Any]) -> dict[str, Any]:
    """Strip image/build detail for non-superadmins — a tenant admin needs to
    know a container is down, not which image tag or host filesystem it runs.
    """
    return {**c, "image": None, "started_at": None}


def _sanitize_recordings(rec: dict[str, Any]) -> dict[str, Any]:
    sanitized = {**rec}
    sanitized.pop("path", None)
    return sanitized


def _sanitize_failure(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "near_addr": None, "far_addr": None}


async def build_system_status(db: AsyncSession, tenant_id: int, *, is_superadmin: bool) -> dict[str, Any]:
    containers, db_health, fs_health, connectors, coverage = await asyncio.gather(
        inspect_containers(),
        check_database(db),
        check_freeswitch(),
        fetch_connector_health(db, tenant_id),
        fetch_transcription_coverage(db, tenant_id),
    )
    recordings = check_recordings_mount()
    failures = await fetch_recent_failures(db)

    healthy_count = sum(1 for c in containers if c["state"] == "healthy")
    connector_issue = any(c["status"] in ("stale", "unseen") for c in connectors if c["enabled"])
    # `overall` is service uptime only (containers, DB, connectors reachable).
    # It intentionally does not fold in transcription coverage — that's a
    # capability, not an outage, and is reported separately so the UI can
    # say "services healthy, but transcription coverage is low" instead of
    # a misleading single "operational" verdict.
    overall = "healthy"
    if any(c["state"] == "down" for c in containers) or not db_health.get("ok"):
        overall = "critical"
    elif any(c["state"] in ("unhealthy", "starting") for c in containers) or failures or connector_issue:
        overall = "degraded"

    transcription_complete = coverage["total_calls"] == 0 or coverage["transcribed_calls"] >= coverage["total_calls"]
    capability = "full" if transcription_complete else "partial"

    if not is_superadmin:
        containers = [_sanitize_container(c) for c in containers]
        recordings = _sanitize_recordings(recordings)
        failures = [_sanitize_failure(f) for f in failures]

    return {
        "checked_at": datetime.now(timezone.utc),
        "overall": overall,
        "capability": capability,
        "summary": {
            "containers_healthy": healthy_count,
            "containers_total": len(containers),
            "recent_failures": len(failures),
        },
        "containers": containers,
        "connectors": connectors,
        "services": {
            "database": db_health,
            "recordings": recordings,
            "freeswitch": fs_health,
            "transcription": {
                "mode": "connector",
                "worker_enabled": is_transcription_enabled(),
                **coverage,
            },
        },
        "recent_failures": failures,
        # Raw logs are superadmin-only (see /system/logs); an empty list here
        # is what tells the frontend to hide the Live logs panel.
        "log_sources": list(LOG_SOURCES.keys()) if is_superadmin else [],
    }
