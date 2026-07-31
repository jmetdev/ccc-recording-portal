"""Unit tests for Docker-native WXC connector orchestration."""

from unittest.mock import MagicMock, patch

import docker.errors
import pytest

from app.services.webex_connector import docker as backend


@pytest.fixture
def settings(monkeypatch):
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_backend",
        "docker",
    )
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_image",
        "ghcr.io/test/ccc-connector-webex:dev",
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
        "app.services.webex_connector.docker.settings.webex_serviceapp_client_id",
        "cid",
    )
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_serviceapp_client_secret",
        "csecret",
    )
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_scopes",
        "spark-compliance:recordings_read",
    )
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_list_mode",
        "admin",
    )
    monkeypatch.setattr(
        "app.services.webex_connector.docker.settings.webex_connector_data_host_path",
        "/data/webex-connectors",
    )


def test_provisioning_enabled(settings):
    assert backend.provisioning_enabled() is True


def test_container_name():
    assert backend._container_name(42) == "ccc-webex-connector-t42"


@patch("app.services.webex_connector.docker.tenant_data_host_path", return_value="/data/webex-connectors/t7")
@patch("app.services.webex_connector.docker.docker.DockerClient")
def test_run_container_env_and_volume(mock_client_cls, _host_path, settings):
    client = MagicMock()
    mock_client_cls.return_value = client
    client.containers.get.side_effect = docker.errors.NotFound("missing")

    backend._run_container(client, 7, "ccck_test_token")

    client.containers.run.assert_called_once()
    kwargs = client.containers.run.call_args.kwargs
    assert kwargs["name"] == "ccc-webex-connector-t7"
    assert kwargs["labels"]["ccc.component"] == "wxc-connector"
    assert kwargs["environment"]["CONNECTOR_TOKEN"] == "ccck_test_token"
    assert kwargs["environment"]["WEBEX_CLIENT_ID"] == "cid"
    assert kwargs["environment"]["WEBEX_TOKEN_FILE"] == "/data/tokens.json"
    assert "/data/webex-connectors/t7" in kwargs["volumes"]
    assert kwargs["network"] == "ccc"
