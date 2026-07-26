"""Unit tests for Health / Status aggregation (docker vs connector edge)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

from app.services import system_health as sh


def test_inspect_containers_marks_docker_unusable_on_403(monkeypatch):
    monkeypatch.setattr(sh.settings, "system_containers", "portal-backend,freeswitch")

    async def fake_docker(*args, **kwargs):
        return (
            1,
            "",
            "Error response from daemon: <html><body><h1>403 Forbidden</h1>"
            "Request forbidden by administrative rules.</body></html>",
        )

    monkeypatch.setattr(sh, "_run_docker", fake_docker)
    containers, usable = asyncio.run(sh.inspect_containers())
    assert usable is False
    assert len(containers) == 2
    assert all(c["state"] == "unknown" for c in containers)
    assert "403" in (containers[0]["detail"] or "")


def test_merge_containers_prefers_connector_when_docker_unusable():
    docker_rows = [
        {
            "name": "freeswitch",
            "state": "unknown",
            "status": "not found",
            "health": None,
            "image": None,
            "started_at": None,
            "detail": "403 Forbidden",
            "source": "docker",
        }
    ]
    connectors = [
        {
            "id": 1,
            "name": "edge",
            "kind": "cucm",
            "enabled": True,
            "status": "healthy",
            "stats": {
                "queue_depth": 0,
                "sip_switch": {"ok": True, "detail": "ESL reachable"},
                "whisper": {"ok": True, "detail": "last poll 3s ago"},
                "components": [
                    {
                        "name": "sip-switch",
                        "state": "healthy",
                        "status": "running",
                        "health": "healthy",
                        "detail": "ESL reachable",
                        "source": "connector",
                    },
                    {
                        "name": "whisper",
                        "state": "healthy",
                        "status": "running",
                        "health": "healthy",
                        "detail": "last poll 3s ago",
                        "source": "connector",
                    },
                ],
            },
        }
    ]
    merged = sh._merge_containers(docker_rows, docker_usable=False, connectors=connectors)
    names = {c["name"] for c in merged}
    assert names == {"sip-switch", "whisper"}
    assert all(c["source"] == "connector" for c in merged)
    assert all(c["state"] == "healthy" for c in merged)


def test_merge_containers_replaces_unknown_freeswitch_when_docker_partially_ok():
    docker_rows = [
        {
            "name": "portal-backend",
            "state": "healthy",
            "status": "running",
            "health": "healthy",
            "image": "portal:dev",
            "started_at": None,
            "detail": None,
            "source": "docker",
        },
        {
            "name": "freeswitch",
            "state": "unknown",
            "status": "not found",
            "health": None,
            "image": None,
            "started_at": None,
            "detail": "No such object: freeswitch",
            "source": "docker",
        },
    ]
    connectors = [
        {
            "id": 1,
            "name": "edge",
            "kind": "cucm",
            "enabled": True,
            "status": "healthy",
            "stats": {
                "sip_switch": {"ok": True, "detail": "ESL reachable"},
                "components": [
                    {
                        "name": "sip-switch",
                        "state": "healthy",
                        "status": "running",
                        "health": "healthy",
                        "detail": "ESL reachable",
                        "source": "connector",
                    }
                ],
            },
        }
    ]
    merged = sh._merge_containers(docker_rows, docker_usable=True, connectors=connectors)
    names = [c["name"] for c in merged]
    assert "portal-backend" in names
    assert "freeswitch" not in names
    assert "sip-switch" in names


def test_check_freeswitch_falls_back_to_connector(monkeypatch):
    monkeypatch.setattr(sh.settings, "freeswitch_fs_cli", "")
    connectors = [
        {
            "enabled": True,
            "status": "healthy",
            "kind": "cucm",
            "stats": {"sip_switch": {"ok": True, "detail": "ESL 127.0.0.1:8021 reachable"}},
        }
    ]
    result = asyncio.run(sh.check_freeswitch(connectors))
    assert result["ok"] is True
    assert result["source"] == "connector"
    assert result["fs_cli_configured"] is False
    assert "ESL" in (result["detail"] or "")


def test_check_freeswitch_not_configured_without_connector(monkeypatch):
    monkeypatch.setattr(sh.settings, "freeswitch_fs_cli", "")
    result = asyncio.run(sh.check_freeswitch([]))
    assert result["ok"] is False
    assert result["source"] == "none"
    assert result["detail"] == "not configured"


def test_check_freeswitch_healthy_cucm_without_edge_stats(monkeypatch):
    """Pre-upgrade connectors only send queue_depth — still treat as OK."""
    monkeypatch.setattr(sh.settings, "freeswitch_fs_cli", "")
    connectors = [
        {
            "name": "hq",
            "enabled": True,
            "status": "healthy",
            "kind": "cucm",
            "stats": {"queue_depth": 0},
        }
    ]
    result = asyncio.run(sh.check_freeswitch(connectors))
    assert result["ok"] is True
    assert result["source"] == "connector"
    assert "hq" in (result["detail"] or "")


def test_build_system_status_uses_connector_edge(monkeypatch):
    monkeypatch.setattr(sh.settings, "system_containers", "freeswitch")
    monkeypatch.setattr(sh.settings, "freeswitch_fs_cli", "")
    monkeypatch.setattr(sh.settings, "storage_backend", "s3")
    monkeypatch.setattr(sh.settings, "s3_bucket", "test-bucket")

    async def fake_inspect():
        return (
            [
                {
                    "name": "freeswitch",
                    "state": "unknown",
                    "status": "not found",
                    "health": None,
                    "image": None,
                    "started_at": None,
                    "detail": "Error response from daemon: <html><body><h1>403 Forbidden</h1></body></html>",
                    "source": "docker",
                }
            ],
            False,
        )

    connectors = [
        {
            "id": 9,
            "name": "hq",
            "kind": "cucm",
            "enabled": True,
            "status": "healthy",
            "last_seen_at": None,
            "version": "0.1.0",
            "stats": {
                "queue_depth": 0,
                "sip_switch": {"ok": True, "detail": "ESL reachable"},
                "whisper": {"ok": True, "detail": "last poll 1s ago", "last_seen_s": 1},
                "components": [
                    {
                        "name": "sip-switch",
                        "state": "healthy",
                        "status": "running",
                        "health": "healthy",
                        "detail": "ESL reachable",
                        "source": "connector",
                    },
                    {
                        "name": "whisper",
                        "state": "healthy",
                        "status": "running",
                        "health": "healthy",
                        "detail": "last poll 1s ago",
                        "source": "connector",
                    },
                ],
            },
        }
    ]

    monkeypatch.setattr(sh, "inspect_containers", fake_inspect)
    monkeypatch.setattr(sh, "check_database", AsyncMock(return_value={"ok": True, "latency_ms": 1.0}))
    monkeypatch.setattr(sh, "fetch_connector_health", AsyncMock(return_value=connectors))
    monkeypatch.setattr(
        sh,
        "fetch_transcription_coverage",
        AsyncMock(return_value={"by_source": {}, "total_calls": 6, "transcribed_calls": 5}),
    )
    monkeypatch.setattr(sh, "fetch_recent_failures", AsyncMock(return_value=[]))
    monkeypatch.setattr(sh, "is_transcription_enabled", lambda: False)

    status = asyncio.run(sh.build_system_status(AsyncMock(), tenant_id=1, is_superadmin=True))

    assert status["summary"]["docker_usable"] is False
    assert status["log_sources"] == []
    names = {c["name"] for c in status["containers"]}
    assert names == {"sip-switch", "whisper"}
    assert not any("403" in (c.get("detail") or "") for c in status["containers"])
    assert status["services"]["freeswitch"]["ok"] is True
    assert status["services"]["freeswitch"]["source"] == "connector"
    assert status["services"]["transcription"]["whisper"]["ok"] is True
    # Incomplete coverage is capability/partial, not a red SIP/whisper outage.
    assert status["capability"] == "partial"
    assert status["overall"] == "healthy"
