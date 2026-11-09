"""Connector provisioning returns the stored developer-portal pair and does not mint."""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app.services import webex_serviceapp as wx


def _auth(**kwargs):
    defaults = dict(
        status="authorized",
        access_token_encrypted="enc:portal-access",
        refresh_token_encrypted="enc:portal-refresh",
        access_expires_at=datetime.now(timezone.utc) + timedelta(hours=3),
    )
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_issue_connector_token_returns_stored_pair_without_calling_webex():
    auth = _auth()
    exchange = AsyncMock()

    async def get_auth(_db, _tenant_id):
        return auth

    with (
        patch.object(wx, "get_auth", get_auth),
        patch.object(wx, "exchange_refresh_grant", exchange),
        patch.object(wx, "decrypt_secret", lambda value: value.removeprefix("enc:")),
    ):
        payload = asyncio.run(wx.issue_connector_token(MagicMock(), 7, "other-refresh", force=True))

    assert payload["access_token"] == "portal-access"
    assert payload["refresh_token"] == "portal-refresh"
    assert "client_secret" not in payload
    exchange.assert_not_awaited()


def test_missing_stored_pair_does_not_mint_one():
    auth = _auth(access_token_encrypted=None, refresh_token_encrypted=None)

    async def get_auth(_db, _tenant_id):
        return auth

    exchange = AsyncMock()
    with (
        patch.object(wx, "get_auth", get_auth),
        patch.object(wx, "exchange_refresh_grant", exchange),
    ):
        with pytest.raises(HTTPException) as caught:
            asyncio.run(wx.issue_connector_token(MagicMock(), 7, "tenant-refresh"))

    assert caught.value.status_code == 409
    assert "developer-portal" in caught.value.detail
    exchange.assert_not_awaited()
