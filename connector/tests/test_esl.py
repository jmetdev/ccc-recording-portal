"""Tests for FreeSWITCH ESL channel normalization used by connector heartbeats."""

from __future__ import annotations

from app.esl import dedupe_channels_by_refci


def test_dedupe_channels_merges_near_far_and_keeps_codec():
    channels = [
        {
            "uuid": "near-uuid",
            "refci": "1001",
            "leg": "near",
            "near_addr": "4000",
            "far_addr": None,
            "read_codec": "PCMU",
            "write_codec": "PCMU",
            "created_epoch": 100.0,
            "duration_s": 10.0,
        },
        {
            "uuid": "far-uuid",
            "refci": "1001",
            "leg": "far",
            "near_addr": None,
            "far_addr": "5551212",
            "read_codec": None,
            "write_codec": None,
            "created_epoch": 101.0,
            "duration_s": 9.0,
        },
    ]
    out = dedupe_channels_by_refci(channels)
    assert len(out) == 1
    row = out[0]
    assert row["refci"] == "1001"
    assert row["near_addr"] == "4000"
    assert row["far_addr"] == "5551212"
    assert row["read_codec"] == "PCMU"
    assert row["uuid"] == "far-uuid"
    assert row["created_epoch"] == 100.0
