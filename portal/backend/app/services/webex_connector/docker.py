"""Docker-native per-tenant WXC connector orchestration (VPS)."""

from __future__ import annotations

import asyncio
import logging
import os

import docker
from docker.errors import NotFound
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import ConnectorCredential, WebexConnectorInstance
from app.services.webex_connector.runtime import (
    prepare_tenant_runtime,
    tenant_data_host_path,
)

logger = logging.getLogger(__name__)

MANAGED_LABEL = "ccc.managed"


def _container_name(tenant_id: int) -> str:
    return f"ccc-webex-connector-t{tenant_id}"


def _docker_client() -> docker.DockerClient:
    host = os.environ.get("DOCKER_HOST", "unix:///var/run/docker.sock")
    return docker.DockerClient(base_url=host)


def provisioning_enabled() -> bool:
    return settings.webex_connector_backend == "docker" and bool(settings.webex_connector_image)


async def get_instance(db: AsyncSession, tenant_id: int) -> WebexConnectorInstance | None:
    return (
        await db.execute(
            select(WebexConnectorInstance).where(WebexConnectorInstance.tenant_id == tenant_id)
        )
    ).scalar_one_or_none()


def _run_container(
    client: docker.DockerClient,
    tenant_id: int,
    connector_token: str,
) -> docker.models.containers.Container:
    name = _container_name(tenant_id)
    env = {
        "PORTAL_URL": settings.webex_connector_portal_url,
        "CONNECTOR_TOKEN": connector_token,
        "WEBEX_CLIENT_ID": settings.webex_serviceapp_client_id,
        "WEBEX_CLIENT_SECRET": settings.webex_serviceapp_client_secret,
        "WEBEX_SCOPES": settings.webex_connector_scopes,
        "LIST_MODE": settings.webex_connector_list_mode,
        "WEBEX_TOKEN_FILE": "/data/tokens.json",
        "STATE_DB": "/data/connector-state.sqlite3",
        "DOWNLOAD_DIR": "/data/tmp",
    }
    labels = {
        MANAGED_LABEL: "true",
        "ccc.tenant_id": str(tenant_id),
        "ccc.component": "wxc-connector",
    }
    volumes: dict[str, dict[str, str]] = {}
    host_data = tenant_data_host_path(tenant_id)
    if host_data:
        volumes[host_data] = {"bind": "/data", "mode": "rw"}
    else:
        volumes[f"ccc-wxc-connector-t{tenant_id}"] = {"bind": "/data", "mode": "rw"}

    try:
        existing = client.containers.get(name)
        if existing.status == "running":
            existing.stop(timeout=30)
        existing.remove(force=True)
    except NotFound:
        pass

    return client.containers.run(
        image=settings.webex_connector_image,
        name=name,
        detach=True,
        restart_policy={"Name": "unless-stopped"},
        network=settings.webex_connector_network,
        environment=env,
        labels=labels,
        volumes=volumes,
    )


async def launch_tenant_connector(
    db: AsyncSession, tenant_id: int, connector_credential: ConnectorCredential, connector_token: str
) -> WebexConnectorInstance:
    if not provisioning_enabled():
        raise RuntimeError("WXC connector provisioning is not configured (WEBEX_CONNECTOR_BACKEND=docker)")

    existing = await get_instance(db, tenant_id)
    container_name = _container_name(tenant_id)

    def _launch():
        client = _docker_client()
        return _run_container(client, tenant_id, connector_token)

    await asyncio.to_thread(_launch)

    if existing is None:
        instance = WebexConnectorInstance(
            tenant_id=tenant_id,
            connector_credential_id=connector_credential.id,
            container_name=container_name,
            webhook_url=None,
            status="provisioning",
        )
        db.add(instance)
    else:
        instance = existing
        instance.connector_credential_id = connector_credential.id
        instance.container_name = container_name
        instance.webhook_url = None
        instance.status = "provisioning"
        instance.error = None
    await db.flush()
    return instance


async def enable_tenant_connector(db: AsyncSession, tenant_id: int) -> WebexConnectorInstance:
    """Write runtime files from Service App auth and start the WXC poller container."""
    cred, token = await prepare_tenant_runtime(db, tenant_id)
    instance = await launch_tenant_connector(db, tenant_id, cred, token)
    return await refresh_tenant_connector_status(db, tenant_id) or instance


async def refresh_tenant_connector_status(db: AsyncSession, tenant_id: int) -> WebexConnectorInstance | None:
    instance = await get_instance(db, tenant_id)
    if instance is None or not instance.container_name:
        return instance

    def _status():
        client = _docker_client()
        try:
            c = client.containers.get(instance.container_name)
            return c.status
        except NotFound:
            return "missing"

    state = await asyncio.to_thread(_status)
    if state == "running":
        instance.status = "running"
        instance.error = None
    elif state in ("created", "restarting"):
        instance.status = "provisioning"
    else:
        instance.status = "error"
        instance.error = state
    return instance


async def teardown_tenant_connector(db: AsyncSession, tenant_id: int) -> None:
    instance = await get_instance(db, tenant_id)
    if instance is None:
        return

    name = instance.container_name or _container_name(tenant_id)

    def _teardown():
        client = _docker_client()
        try:
            c = client.containers.get(name)
            c.stop(timeout=30)
            c.remove(force=True)
        except NotFound:
            pass
        except Exception:
            logger.exception("Failed to remove WXC connector container %s", name)

    await asyncio.to_thread(_teardown)
    await db.delete(instance)
