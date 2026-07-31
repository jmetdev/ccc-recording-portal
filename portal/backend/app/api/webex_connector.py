"""Tenant-facing endpoints for the hosted per-tenant Webex connector.

.. deprecated::
    WXC ingest uses the external ``ccc-connector-webex`` poller deployed via
    Docker on the VPS (one instance per customer org). These endpoints launched
    an experimental webhook stub and are retained only for backward
    compatibility checks.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import require_permission
from app.models import Permission, User
from app.services import webex_connector as wxc
from app.services.audit import record_audit

router = APIRouter(prefix="/tenant/webex/connector", tags=["webex-connector"])

_DEPRECATION_DETAIL = (
    "Hosted webhook connector is deprecated. Deploy ccc-connector-webex on the VPS "
    "(see docs/DEPLOY.md in that repo) and use a kind=webex connector token from Settings → Connectors."
)


@router.get("/status")
async def connector_status(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    if not wxc.connector_provisioning_enabled():
        return {
            "enabled": False,
            "status": "deprecated",
            "webhook_url": None,
            "detail": _DEPRECATION_DETAIL,
        }
    instance = await wxc.refresh_tenant_connector_status(db, user.tenant_id)
    await db.commit()
    if instance is None:
        return {"enabled": True, "status": "not_provisioned", "webhook_url": None}
    return {"enabled": True, "status": instance.status, "webhook_url": instance.webhook_url}


@router.post("/enable")
async def enable_connector(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
):
    raise HTTPException(status_code=410, detail=_DEPRECATION_DETAIL)


@router.post("/disable")
async def disable_connector(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    await wxc.teardown_tenant_connector(db, user.tenant_id)
    await record_audit(
        db, tenant_id=user.tenant_id, user=user, action="webex_connector.disable"
    )
    await db.commit()
    return {"status": "ok"}
