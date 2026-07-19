"""Per-tenant isolated hosted Webex connector orchestration facade."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import AsyncSession

if TYPE_CHECKING:
    from app.models import ConnectorCredential, WebexConnectorInstance


def connector_provisioning_enabled() -> bool:
    from . import docker as docker_backend
    from . import ecs as ecs_backend

    return ecs_backend.provisioning_enabled() or docker_backend.provisioning_enabled()


async def get_instance(db: AsyncSession, tenant_id: int) -> WebexConnectorInstance | None:
    from app.core.config import settings
    from . import docker as docker_backend
    from . import ecs as ecs_backend

    if settings.webex_connector_backend == "docker":
        return await docker_backend.get_instance(db, tenant_id)
    return await ecs_backend.get_instance(db, tenant_id)


async def launch_tenant_connector(
    db: AsyncSession, tenant_id: int, connector_credential: ConnectorCredential, connector_token: str
) -> WebexConnectorInstance:
    from app.core.config import settings
    from . import docker as docker_backend
    from . import ecs as ecs_backend

    if settings.webex_connector_backend == "docker":
        return await docker_backend.launch_tenant_connector(db, tenant_id, connector_credential, connector_token)
    return await ecs_backend.launch_tenant_connector(db, tenant_id, connector_credential, connector_token)


async def refresh_tenant_connector_status(db: AsyncSession, tenant_id: int) -> WebexConnectorInstance | None:
    from app.core.config import settings
    from . import docker as docker_backend
    from . import ecs as ecs_backend

    if settings.webex_connector_backend == "docker":
        return await docker_backend.refresh_tenant_connector_status(db, tenant_id)
    return await ecs_backend.refresh_tenant_connector_status(db, tenant_id)


async def teardown_tenant_connector(db: AsyncSession, tenant_id: int) -> None:
    from app.core.config import settings
    from . import docker as docker_backend
    from . import ecs as ecs_backend

    if settings.webex_connector_backend == "docker":
        await docker_backend.teardown_tenant_connector(db, tenant_id)
    else:
        await ecs_backend.teardown_tenant_connector(db, tenant_id)
