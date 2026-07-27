"""Unit tests for Webex Service App deployment readiness."""

from unittest.mock import patch

from app.services import webex_serviceapp as wx


def test_serviceapp_enabled_requires_all_five_keys():
    with patch.object(wx.settings, "webex_serviceapp_id", "app"), patch.object(
        wx.settings, "webex_serviceapp_client_id", "cid"
    ), patch.object(wx.settings, "webex_serviceapp_client_secret", "sec"), patch.object(
        wx.settings, "webex_serviceapp_webhook_secret", ""
    ), patch.object(wx.settings, "webex_serviceapp_org_token", "tok"):
        assert wx.serviceapp_enabled() is False
        assert "WEBEX_SERVICEAPP_WEBHOOK_SECRET" in wx.serviceapp_missing_keys()


def test_serviceapp_enabled_rejects_placeholders():
    with patch.object(wx.settings, "webex_serviceapp_id", "REPLACE_ME"), patch.object(
        wx.settings, "webex_serviceapp_client_id", "cid"
    ), patch.object(wx.settings, "webex_serviceapp_client_secret", "sec"), patch.object(
        wx.settings, "webex_serviceapp_webhook_secret", "wh"
    ), patch.object(wx.settings, "webex_serviceapp_org_token", "tok"):
        assert wx.serviceapp_enabled() is False


def test_serviceapp_enabled_when_complete():
    with patch.object(wx.settings, "webex_serviceapp_id", "app"), patch.object(
        wx.settings, "webex_serviceapp_client_id", "cid"
    ), patch.object(wx.settings, "webex_serviceapp_client_secret", "sec"), patch.object(
        wx.settings, "webex_serviceapp_webhook_secret", "wh"
    ), patch.object(wx.settings, "webex_serviceapp_org_token", "tok"):
        assert wx.serviceapp_enabled() is True
        assert wx.serviceapp_deployment_status() == {"configured": True, "missing_keys": []}
