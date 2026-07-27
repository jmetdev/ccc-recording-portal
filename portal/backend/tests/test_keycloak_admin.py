"""Unit tests for Keycloak admin readiness helper."""

from unittest.mock import patch

from app.services import keycloak_admin as kc


def test_keycloak_admin_configured_requires_url_and_password():
    with patch.object(kc.settings, "keycloak_url", ""), patch.object(
        kc.settings, "keycloak_admin", "admin"
    ), patch.object(kc.settings, "keycloak_admin_password", "secret"):
        assert kc.keycloak_admin_configured() is False

    with patch.object(kc.settings, "keycloak_url", "http://keycloak:8080"), patch.object(
        kc.settings, "keycloak_admin", "admin"
    ), patch.object(kc.settings, "keycloak_admin_password", ""):
        assert kc.keycloak_admin_configured() is False

    with patch.object(kc.settings, "keycloak_url", "http://keycloak:8080"), patch.object(
        kc.settings, "keycloak_admin", "admin"
    ), patch.object(kc.settings, "keycloak_admin_password", "secret"):
        assert kc.keycloak_admin_configured() is True
