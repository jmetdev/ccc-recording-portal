"""Unit tests for on-prem connector edge health probes."""

from __future__ import annotations

from app import edge_health


def test_sip_switch_unreachable_when_nothing_listens(monkeypatch):
    monkeypatch.setattr(edge_health, "FS_ESL_HOST", "127.0.0.1")
    monkeypatch.setattr(edge_health, "FS_ESL_PORT", 1)
    result = edge_health.check_sip_switch()
    assert result["ok"] is False
    assert "unreachable" in result["detail"]


def test_whisper_waiting_before_first_claim(monkeypatch):
    monkeypatch.setattr(edge_health.config, "TRANSCRIBE", True)
    monkeypatch.setattr(edge_health, "_whisper_last_claim_at", None)
    result = edge_health.check_whisper()
    assert result["ok"] is None
    assert "waiting" in result["detail"]


def test_whisper_ok_after_claim(monkeypatch):
    monkeypatch.setattr(edge_health.config, "TRANSCRIBE", True)
    edge_health.note_whisper_claim()
    result = edge_health.check_whisper()
    assert result["ok"] is True


def test_collect_heartbeat_stats_shape(monkeypatch):
    monkeypatch.setattr(edge_health.config, "TRANSCRIBE", True)
    monkeypatch.setattr(
        edge_health,
        "check_sip_switch",
        lambda: {"ok": True, "detail": "ESL reachable"},
    )
    monkeypatch.setattr(
        "app.esl.list_active_recording_channels",
        lambda: [
            {
                "uuid": "u1",
                "refci": "123",
                "read_codec": "PCMU",
                "write_codec": "PCMU",
            }
        ],
    )
    edge_health.note_whisper_claim()
    stats = edge_health.collect_heartbeat_stats(3)
    assert stats["queue_depth"] == 3
    assert stats["sip_switch"]["ok"] is True
    assert {c["name"] for c in stats["components"]} >= {"sip-switch", "connector", "whisper"}
    assert stats["live_channels"][0]["read_codec"] == "PCMU"
