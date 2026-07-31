"""Tests for email-based call visibility (WXC)."""

from types import SimpleNamespace

from app.services.call_visibility import user_matches_call_near
from app.services.party_identity import looks_like_email, normalize_email


def test_normalize_email():
    assert normalize_email("Agent@Example.COM") == "agent@example.com"
    assert normalize_email("1034") is None
    assert normalize_email(None) is None


def test_looks_like_email():
    assert looks_like_email("agent@example.com")
    assert not looks_like_email("1034")
    assert not looks_like_email("bad@host")


def test_user_matches_call_near_by_email():
    user = SimpleNamespace(email="agent@example.com", extension=None)
    assert user_matches_call_near(user, "agent@example.com")
    assert user_matches_call_near(user, "Agent@Example.COM")
    assert not user_matches_call_near(user, "other@example.com")


def test_user_matches_call_near_by_extension():
    user = SimpleNamespace(email="agent@example.com", extension="1034")
    assert user_matches_call_near(user, "1034@host")
    assert not user_matches_call_near(user, "1035")
