"""Unit tests for portal→connector whisper config cache."""

from __future__ import annotations

from app import edge_config


def test_whisper_options_empty_by_default(monkeypatch):
    monkeypatch.setattr(edge_config, "_config", {})
    assert edge_config.whisper_options() == {"initial_prompt": None, "hotwords": None}


def test_update_from_heartbeat_caches_whisper_options():
    edge_config.update_from_heartbeat(
        {
            "status": "ok",
            "config": {
                "whisper": {
                    "organization_name": "Kyrene",
                    "initial_prompt": "Kyrene School District",
                    "hotwords": "Kyrene Bahar",
                    "hotwords_list": ["Kyrene", "Bahar"],
                }
            },
        }
    )
    assert edge_config.whisper_options() == {
        "initial_prompt": "Kyrene School District",
        "hotwords": "Kyrene Bahar",
    }
