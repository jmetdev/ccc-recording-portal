"""Docker-native per-tenant Webex connector orchestration (VPS dev)."""

from __future__ import annotations

import asyncio
import logging
import os
import secrets as _secrets

import docker
from docker.errors import NotFound
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import ConnectorCredential, WebexConnectorInstance

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
    webhook_secret: str,
    connector_token: str,
) -> docker.models.containers.Container:
    name = _container_name(tenant_id)
    env = {
        "TENANT_ID": str(tenant_id),
        "WEBHOOK_SECRET": webhook_secret,
        "CONNECTOR_TOKEN": connector_token,
        "PORTAL_URL": settings.webex_connector_portal_url,
    }
    labels = {
        MANAGED_LABEL: "true",
        "ccc.tenant_id": str(tenant_id),
        "ccc.component": "webex-connector",
    }
    try:
        existing = client.containers.get(name)
        if existing.status == "running":
            return existing
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
    )


async def launch_tenant_connector(
    db: AsyncSession, tenant_id: int, connector_credential: ConnectorCredential, connector_token: str
) -> WebexConnectorInstance:
    if not provisioning_enabled():
        raise RuntimeError("Hosted Webex connector infra is not configured (WEBEX_CONNECTOR_BACKEND=docker)")

    existing = await get_instance(db, tenant_id)
    if existing is not None and existing.status in ("provisioning", "running"):
        return existing

    webhook_secret = _secrets.token_urlsafe(24)
    container_name = _container_name(tenant_id)

    def _launch():
        client = _docker_client()
        return _run_container(client, tenant_id, webhook_secret, connector_token)

    await asyncio.to_thread(_launch)

    webhook_url = None
    if settings.webex_connector_domain:
        webhook_url = f"https://{settings.webex_connector_domain}/t/{tenant_id}/webhook"

    if existing is None:
        instance = WebexConnectorInstance(
            tenant_id=tenant_id,
            connector_credential_id=connector_credential.id,
            container_name=container_name,
            webhook_url=webhook_url,
            status="provisioning",
        )
        db.add(instance)
    else:
        instance = existing
        instance.connector_credential_id = connector_credential.id
        instance.container_name = container_name
        instance.webhook_url = webhook_url
        instance.status = "provisioning"
        instance.error = None
    await db.flush()
    return instance


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
            logger.exception("Failed to remove connector container %s", name)

    await asyncio.to_thread(_teardown)
    await db.delete(instance)
