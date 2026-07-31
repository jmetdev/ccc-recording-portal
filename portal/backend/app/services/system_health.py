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

# Container names that live on the on-prem edge (connector host), not the portal.
_EDGE_DOCKER_NAMES = frozenset({"freeswitch", "sip-switch", "whisper", "portal-whisper"})

_DOCKER_UNAVAILABLE_MARKERS = (
    "403 forbidden",
    "request forbidden by administrative rules",
    "cannot connect to the docker daemon",
    "permission denied while trying to connect",
    "got permission denied while trying to connect",
    "is the docker daemon running",
    "connection refused",
)


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


def _is_docker_daemon_error(detail: str | None) -> bool:
    if not detail:
        return False
    d = detail.lower()
    return any(marker in d for marker in _DOCKER_UNAVAILABLE_MARKERS)


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


async def inspect_containers() -> tuple[list[dict[str, Any]], bool]:
    """Return (containers, docker_usable).

    ``docker_usable`` is False when the host Docker daemon is missing/forbidden
    (typical on Fargate / locked-down hosts). Callers should then prefer
    connector-reported edge health instead of showing 403 HTML blobs.
    """
    results: list[dict[str, Any]] = []
    if not settings.system_container_list:
        return results, False

    daemon_errors = 0
    for name in settings.system_container_list:
        code, stdout, stderr = await _run_docker(
            "inspect",
            name,
            "--format",
            "{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Config.Image}}|{{.State.StartedAt}}",
        )
        if code != 0:
            detail = stderr.strip() or "container not found"
            if _is_docker_daemon_error(detail):
                daemon_errors += 1
            results.append(
                {
                    "name": name,
                    "state": "unknown",
                    "status": "not found",
                    "health": None,
                    "image": None,
                    "started_at": None,
                    "detail": detail,
                    "source": "docker",
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
                "source": "docker",
            }
        )

    docker_usable = bool(results) and daemon_errors < len(results)
    return results, docker_usable


def _edge_stats_from_connectors(connectors: list[dict[str, Any]]) -> dict[str, Any] | None:
    """Pick the richest stats blob from a healthy CUCM (or any) connector."""
    candidates = [
        c
        for c in connectors
        if c.get("enabled") and c.get("status") == "healthy" and isinstance(c.get("stats"), dict)
    ]
    if not candidates:
        # Fall back to any enabled connector with stats (even stale) — better
        # than showing docker 403 when the edge was recently healthy.
        candidates = [
            c for c in connectors if c.get("enabled") and isinstance(c.get("stats"), dict)
        ]
    if not candidates:
        return None
    # Prefer cucm connectors (they own SIP Switch + whisper).
    cucm = [c for c in candidates if c.get("kind") == "cucm"]
    pick = (cucm or candidates)[0]
    return pick.get("stats") if isinstance(pick.get("stats"), dict) else None


def _containers_from_connector_stats(stats: dict[str, Any]) -> list[dict[str, Any]]:
    components = stats.get("components")
    if isinstance(components, list) and components:
        out: list[dict[str, Any]] = []
        for raw in components:
            if not isinstance(raw, dict) or not raw.get("name"):
                continue
            out.append(
                {
                    "name": raw["name"],
                    "state": raw.get("state") or "unknown",
                    "status": raw.get("status") or "unknown",
                    "health": raw.get("health"),
                    "image": raw.get("image"),
                    "started_at": raw.get("started_at"),
                    "detail": raw.get("detail"),
                    "source": "connector",
                }
            )
        return out

    # Older heartbeats only send sip_switch / whisper keys.
    out = []
    sip = stats.get("sip_switch") if isinstance(stats.get("sip_switch"), dict) else None
    if sip is not None:
        ok = bool(sip.get("ok"))
        out.append(
            {
                "name": "sip-switch",
                "state": "healthy" if ok else "down",
                "status": "running" if ok else "unreachable",
                "health": "healthy" if ok else "unhealthy",
                "image": None,
                "started_at": None,
                "detail": sip.get("detail"),
                "source": "connector",
            }
        )
    whisper = stats.get("whisper") if isinstance(stats.get("whisper"), dict) else None
    if whisper is not None and whisper.get("ok") is not None:
        ok = bool(whisper.get("ok"))
        out.append(
            {
                "name": "whisper",
                "state": "healthy" if ok else "down",
                "status": "running" if ok else "unreachable",
                "health": "healthy" if ok else "unhealthy",
                "image": None,
                "started_at": None,
                "detail": whisper.get("detail"),
                "source": "connector",
            }
        )
    return out


def _is_edge_container_name(name: str) -> bool:
    n = name.lower()
    return n in _EDGE_DOCKER_NAMES or "whisper" in n


def _merge_containers(
    docker_containers: list[dict[str, Any]],
    docker_usable: bool,
    connectors: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    edge_stats = _edge_stats_from_connectors(connectors)
    edge_containers = _containers_from_connector_stats(edge_stats) if edge_stats else []

    if not docker_usable:
        # Portal host has no usable Docker — show connector edge stack only.
        return edge_containers

    # Keep portal docker rows; drop edge names docker couldn't resolve when the
    # connector already reports them (avoids "freeswitch: 403 Forbidden" cards).
    kept: list[dict[str, Any]] = []
    for c in docker_containers:
        name = str(c.get("name") or "")
        if (
            _is_edge_container_name(name)
            and c.get("state") in ("unknown", "down")
            and edge_containers
        ):
            continue
        kept.append(c)

    kept_names = {str(c.get("name") or "").lower() for c in kept}
    has_sip = "freeswitch" in kept_names or "sip-switch" in kept_names
    has_whisper = any("whisper" in n for n in kept_names)

    for edge in edge_containers:
        name = str(edge.get("name") or "").lower()
        if name == "connector":
            continue
        if name == "sip-switch" and has_sip:
            continue
        if name == "whisper" and has_whisper:
            continue
        if name not in kept_names:
            kept.append(edge)
            kept_names.add(name)
    return kept


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
    if settings.storage_backend == "s3":
        # No local recordings volume in the cloud; report the object store instead.
        return {
            "ok": True,
            "backend": "s3",
            "path": None,
            "bucket": settings.s3_bucket,
            "prefix": settings.s3_prefix or None,
        }
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
            "backend": "local",
            "path": path,
            "readable": readable,
            "writable": writable,
            "wav_count": wav_count,
            "ingest_log_exists": os.path.isfile(hook_log),
        }
    except OSError as exc:
        return {"ok": False, "backend": "local", "path": path, "error": str(exc)}


async def check_freeswitch(connectors: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """SIP Switch status via local fs_cli when configured, else connector heartbeat."""
    configured = bool(settings.freeswitch_fs_cli.strip())
    channels: list[dict[str, Any]] = []
    if configured:
        channels = await list_active_recording_channels()
        return {
            "ok": True,
            "fs_cli_configured": True,
            "active_recording_channels": len(channels),
            "source": "fs_cli",
            "detail": f"{len(channels)} active recording channel(s)",
        }

    edge = _edge_stats_from_connectors(connectors or [])
    sip = edge.get("sip_switch") if isinstance(edge, dict) else None
    if isinstance(sip, dict) and sip.get("ok") is not None:
        ok = bool(sip.get("ok"))
        return {
            "ok": ok,
            "fs_cli_configured": False,
            "active_recording_channels": 0,
            "source": "connector",
            "detail": sip.get("detail") or ("reachable via connector" if ok else "unreachable"),
        }

    # Older connectors only heartbeat queue_depth. A healthy CUCM connector is
    # still a strong signal the edge stack (incl. SIP Switch) is up.
    healthy_cucm = [
        c
        for c in (connectors or [])
        if c.get("enabled") and c.get("status") == "healthy" and c.get("kind") == "cucm"
    ]
    if healthy_cucm:
        return {
            "ok": True,
            "fs_cli_configured": False,
            "active_recording_channels": 0,
            "source": "connector",
            "detail": f"via connector '{healthy_cucm[0].get('name')}' (upgrade connector for ESL detail)",
        }

    return {
        "ok": False,
        "fs_cli_configured": False,
        "active_recording_channels": 0,
        "source": "none",
        "detail": "not configured",
    }


def _whisper_from_connectors(connectors: list[dict[str, Any]]) -> dict[str, Any]:
    has_cucm = any(c.get("enabled") and c.get("kind") == "cucm" for c in connectors)
    if not has_cucm:
        return {
            "ok": None,
            "source": "none",
            "detail": "WXC tenants use Webex VTT — no on-prem Whisper",
        }
    edge = _edge_stats_from_connectors(connectors)
    if not edge:
        return {"ok": None, "source": "none", "detail": None}
    whisper = edge.get("whisper") if isinstance(edge.get("whisper"), dict) else None
    if whisper is None:
        return {"ok": None, "source": "none", "detail": None}
    return {
        "ok": whisper.get("ok"),
        "source": "connector",
        "detail": whisper.get("detail"),
        "last_seen_s": whisper.get("last_seen_s"),
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
        if _is_docker_daemon_error(detail):
            return {
                "source": source,
                "lines": [
                    "(Docker unavailable on the portal host — edge logs are on the "
                    "connector / SIP Switch host, not readable from here.)"
                ],
            }
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


def _webex_serviceapp_health() -> dict[str, Any]:
    """Deployment-level Webex Service App readiness (not per-tenant authorize)."""
    from app.services import webex_serviceapp as wx

    deployment = wx.serviceapp_deployment_status()
    configured = bool(deployment.get("configured"))
    missing = deployment.get("missing_keys") or []
    if configured:
        detail = "Service App credentials configured"
    elif missing:
        detail = f"missing {', '.join(missing)}"
    else:
        detail = "not configured"
    return {
        "ok": configured,
        "configured": configured,
        "missing_keys": missing,
        "detail": detail,
    }


async def build_system_status(db: AsyncSession, tenant_id: int, *, is_superadmin: bool) -> dict[str, Any]:
    docker_result, db_health, connectors, coverage = await asyncio.gather(
        inspect_containers(),
        check_database(db),
        fetch_connector_health(db, tenant_id),
        fetch_transcription_coverage(db, tenant_id),
    )
    docker_containers, docker_usable = docker_result
    containers = _merge_containers(docker_containers, docker_usable, connectors)
    fs_health = await check_freeswitch(connectors)
    whisper = _whisper_from_connectors(connectors)
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
    elif (
        any(c["state"] in ("unhealthy", "starting") for c in containers)
        or failures
        or connector_issue
        or (fs_health.get("source") != "none" and not fs_health.get("ok"))
        or whisper.get("ok") is False
    ):
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
            "docker_usable": docker_usable,
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
                "whisper": whisper,
                **coverage,
            },
            "webex_serviceapp": _webex_serviceapp_health(),
        },
        "recent_failures": failures,
        # Raw logs are superadmin-only (see /system/logs); an empty list here
        # is what tells the frontend to hide the Live logs panel. The sources are
        # Docker/host-file based, so they're also hidden wherever no local
        # containers are configured (e.g. Fargate) or Docker is unusable.
        "log_sources": (
            list(LOG_SOURCES.keys())
            if is_superadmin and settings.system_container_list and docker_usable
            else []
        ),
    }
