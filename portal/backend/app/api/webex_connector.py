"""Tenant-facing endpoints for the hosted per-tenant Webex connector."""

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import require_permission
from app.core.security import generate_connector_token
from app.models import ConnectorCredential, ConnectorKind, Permission, User
from app.services import webex_connector as wxc
from app.services.audit import record_audit

router = APIRouter(prefix="/tenant/webex/connector", tags=["webex-connector"])


@router.get("/status")
async def connector_status(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    if not wxc.connector_provisioning_enabled():
        return {"enabled": False, "status": None, "webhook_url": None}
    instance = await wxc.refresh_tenant_connector_status(db, user.tenant_id)
    await db.commit()
    if instance is None:
        return {"enabled": True, "status": "not_provisioned", "webhook_url": None}
    return {"enabled": True, "status": instance.status, "webhook_url": instance.webhook_url}


@router.post("/enable")
async def enable_connector(
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    if not wxc.connector_provisioning_enabled():
        raise HTTPException(status_code=409, detail="Hosted Webex connector infra is not configured")

    token, token_hash = generate_connector_token()
    cred = ConnectorCredential(
        tenant_id=user.tenant_id, name="hosted-webex-connector", kind=ConnectorKind.WEBEX, token_hash=token_hash
    )
    db.add(cred)
    await db.flush()

    instance = await wxc.launch_tenant_connector(db, user.tenant_id, cred, token)
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        user=user,
        action="webex_connector.enable",
        resource_type="webex_connector_instance",
        resource_id=instance.id,
        request=request,
    )
    await db.commit()
    return {"status": instance.status, "webhook_url": instance.webhook_url}


@router.post("/disable")
async def disable_connector(
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    await wxc.teardown_tenant_connector(db, user.tenant_id)
    await record_audit(
        db, tenant_id=user.tenant_id, user=user, action="webex_connector.disable", request=request
    )
    await db.commit()
    return {"status": "ok"}
