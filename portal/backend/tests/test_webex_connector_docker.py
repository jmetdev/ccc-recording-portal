"""Unit tests for Docker-native webex connector orchestration."""

from unittest.mock import MagicMock, patch

import docker.errors
import pytest

# Import docker backend directly (avoids loading the full app stack).
from app.services.webex_connector import docker as backend


@pytest.fixture
def settings(monkeypatch):
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_backend",
        "docker",
    )
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_image",
        "ghcr.io/test/webex-connector:dev",
    )
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_network",
        "ccc",
    )
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_portal_url",
        "http://backend:8000",
    )
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_domain",
        "dev.example.com",
    )


def test_provisioning_enabled(settings):
    assert backend.provisioning_enabled() is True


def test_container_name():
    assert backend._container_name(42) == "ccc-webex-connector-t42"


@patch("app.services.webex_connector.docker.docker.DockerClient")
def test_run_container_labels(mock_client_cls, settings):
    client = MagicMock()
    mock_client_cls.return_value = client
    client.containers.get.side_effect = docker.errors.NotFound("missing")

    backend._run_container(client, 7, "whsec", "ctok")

    client.containers.run.assert_called_once()
    kwargs = client.containers.run.call_args.kwargs
    assert kwargs["name"] == "ccc-webex-connector-t7"
    assert kwargs["labels"]["ccc.managed"] == "true"
    assert kwargs["labels"]["ccc.tenant_id"] == "7"
    assert kwargs["environment"]["TENANT_ID"] == "7"
    assert kwargs["environment"]["WEBHOOK_SECRET"] == "whsec"
    assert kwargs["network"] == "ccc"
