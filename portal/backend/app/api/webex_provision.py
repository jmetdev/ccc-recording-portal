"""Webex Service App: authorization webhook + status endpoint.

The webhook is internet-facing and unauthenticated; every request is HMAC
signature-verified and tenant creation is idempotent on orgId.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import require_permission
from app.models import Permission, User, WebexServiceAuth
from app.services import webex_serviceapp as wx
from app.services.audit import record_audit
from app.services.tenancy import provision_webex_tenant

logger = logging.getLogger(__name__)

router = APIRouter(tags=["webex-provision"])


# ---- authorization webhook ---------------------------------------------------
@router.post("/webex/serviceapp/webhook")
async def serviceapp_webhook(request: Request, db: AsyncSession = Depends(get_db)):
    body = await request.body()
    signature = request.headers.get("x-spark-signature")
    if not wx.verify_webhook_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    payload = await request.json()
    event = payload.get("event")  # created | deleted
    data = payload.get("data") or {}
    org_id = data.get("targetOrgId") or data.get("orgId")
    app_id = data.get("appId") or payload.get("appId")
    if not org_id:
        logger.warning("Service App webhook without orgId: %s", payload)
        return {"status": "ignored"}

    auth = (
        await db.execute(select(WebexServiceAuth).where(WebexServiceAuth.org_id == org_id))
    ).scalar_one_or_none()

    if event == "deleted":
        if auth is not None:
            auth.status = "deauthorized"
            await db.commit()
        logger.info("Service App deauthorized for org %s", org_id)
        return {"status": "deauthorized"}

    tenant = await provision_webex_tenant(db, org_id, data.get("orgName"))
    if auth is None:
        auth = WebexServiceAuth(tenant_id=tenant.id, org_id=org_id, app_id=app_id)
        db.add(auth)
        await db.flush()
    auth.status = "authorized"
    if data.get("orgName"):
        auth.org_name = data["orgName"]

    try:
        pair = await wx.fetch_org_token_pair(org_id)
        wx.store_token_pair(auth, pair)
    except Exception:
        # Keep the authorization; tokens can be re-fetched on demand.
        logger.exception("Token exchange failed for org %s (will retry on use)", org_id)
        auth.status = "error"

    await record_audit(
        db,
        tenant_id=tenant.id,
        user=None,
        action="webex.serviceapp.authorized",
        resource_type="tenant",
        resource_id=tenant.id,
        detail={"org_id": org_id},
        request=request,
    )
    await db.commit()
    logger.info("Service App authorized for org %s -> tenant %s", org_id, tenant.slug)
    return {"status": "ok", "tenant": tenant.slug}


# ---- tenant-facing status -----------------------------------------------------
wizard = APIRouter(prefix="/tenant/webex", tags=["webex-provision"])


@wizard.get("/status")
async def wizard_status(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    auth = await wx.get_auth(db, user.tenant_id)
    return {
        "serviceapp_configured": wx.serviceapp_enabled(),
        "authorized": auth is not None and auth.status == "authorized",
        "status": auth.status if auth else "unauthorized",
        "org_id": auth.org_id if auth else None,
        "org_name": auth.org_name if auth else None,
    }
