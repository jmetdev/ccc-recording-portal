"""Tenant self-service: settings, connector credentials, storage stats.

Everything here is scoped to the calling user's own tenant — the platform
(cross-tenant) equivalents live in api/tenants.py behind require_superadmin.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.rbac import get_current_user, require_permission, scoped_call_filter, user_permissions
from app.core.security import generate_connector_token
from app.models import (
    Call,
    ConnectorCredential,
    ConnectorKind,
    Permission,
    Recording,
    Tenant,
    User,
    WebexConnectorInstance,
)
from app.schemas import (
    ConnectorCredentialCreate,
    ConnectorCredentialCreated,
    ConnectorCredentialOut,
    LicenseUsageOut,
    StorageStats,
    TenantSettingsOut,
    TenantSettingsUpdate,
    TranscriptionSettingsOut,
    TranscriptionSettingsUpdate,
)
from app.services import webex_connector as wxc
from app.services.audit import record_audit
from app.services.call_stats import distinct_call_count_stmt
from app.services.party_label import format_party
from app.services.recorded_extensions import count_enabled_extensions
from app.services.suite_entitlements import recording_seats_for_org
from app.services.whisper_config import get_transcription_settings, set_transcription_settings

router = APIRouter(prefix="/tenant", tags=["tenant"])


@router.get("/settings", response_model=TenantSettingsOut)
async def get_tenant_settings(user: User = Depends(get_current_user)):
    tenant = user.tenant
    return TenantSettingsOut(
        name=tenant.name, slug=tenant.slug, retention_days=tenant.retention_days
    )


@router.patch("/settings", response_model=TenantSettingsOut)
async def update_tenant_settings(
    body: TenantSettingsUpdate,
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_RETENTION.value)),
    db: AsyncSession = Depends(get_db),
):
    tenant = (
        await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    ).scalar_one()
    if "retention_days" in body.model_fields_set:
        old = tenant.retention_days
        tenant.retention_days = body.retention_days
        await record_audit(
            db,
            tenant_id=user.tenant_id,
            action="tenant.retention_updated",
            user=user,
            resource_type="tenant",
            resource_id=tenant.id,
            detail={"from": old, "to": body.retention_days},
            request=request,
        )
    await db.commit()
    await db.refresh(tenant)
    return TenantSettingsOut(
        name=tenant.name, slug=tenant.slug, retention_days=tenant.retention_days
    )


@router.get("/transcription", response_model=TranscriptionSettingsOut)
async def get_transcription_settings_endpoint(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    tenant = (
        await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    ).scalar_one()
    cfg = get_transcription_settings(tenant)
    return TranscriptionSettingsOut(
        organization_name=cfg["organization_name"],
        hotwords=cfg["hotwords"],
    )


@router.patch("/transcription", response_model=TranscriptionSettingsOut)
async def update_transcription_settings(
    body: TranscriptionSettingsUpdate,
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    tenant = (
        await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    ).scalar_one()
    fields = body.model_fields_set
    if not fields:
        cfg = get_transcription_settings(tenant)
        return TranscriptionSettingsOut(
            organization_name=cfg["organization_name"],
            hotwords=cfg["hotwords"],
        )
    cfg = set_transcription_settings(
        tenant,
        organization_name=body.organization_name if "organization_name" in fields else None,
        hotwords=body.hotwords if "hotwords" in fields else None,
    )
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="tenant.transcription_updated",
        user=user,
        resource_type="tenant",
        resource_id=tenant.id,
        detail={
            "organization_name": cfg["organization_name"],
            "hotwords": cfg["hotwords"],
        },
        request=request,
    )
    await db.commit()
    return TranscriptionSettingsOut(
        organization_name=cfg["organization_name"],
        hotwords=cfg["hotwords"],
    )


@router.get("/license-usage", response_model=LicenseUsageOut)
async def license_usage(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    tenant = (
        await db.execute(select(Tenant).where(Tenant.id == user.tenant_id))
    ).scalar_one()
    used = await count_enabled_extensions(db, user.tenant_id)
    holding_calls = (
        await db.execute(
            select(func.count())
            .select_from(Call)
            .where(
                Call.tenant_id == user.tenant_id,
                Call.holding.is_(True),
                Call.trashed_at.is_(None),
            )
        )
    ).scalar_one()
    allotted = await recording_seats_for_org(tenant.webex_org_id)
    return LicenseUsageOut(allotted=allotted, used=used, holding_calls=holding_calls)


@router.get("/connectors", response_model=list[ConnectorCredentialOut])
async def list_tenant_connectors(
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ConnectorCredential)
        .where(ConnectorCredential.tenant_id == user.tenant_id)
        .order_by(ConnectorCredential.created_at)
    )
    return result.scalars().all()


@router.post("/connectors", response_model=ConnectorCredentialCreated)
async def create_tenant_connector(
    body: ConnectorCredentialCreate,
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    try:
        kind = ConnectorKind(body.kind)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown connector kind: {body.kind}") from None

    token, token_hash = generate_connector_token()
    cred = ConnectorCredential(
        tenant_id=user.tenant_id, name=body.name, kind=kind, token_hash=token_hash
    )
    db.add(cred)
    await db.flush()
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="connector.create",
        user=user,
        resource_type="connector",
        resource_id=cred.id,
        detail={"name": body.name, "kind": kind.value},
        request=request,
    )
    await db.commit()
    await db.refresh(cred)
    base = ConnectorCredentialOut.model_validate(cred, from_attributes=True)
    return ConnectorCredentialCreated(**base.model_dump(), token=token)


@router.post("/connectors/{connector_id}/revoke")
async def revoke_tenant_connector(
    connector_id: int,
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    """Invalidate the connector's API key without removing the credential row."""
    cred = (
        await db.execute(
            select(ConnectorCredential).where(
                ConnectorCredential.id == connector_id,
                ConnectorCredential.tenant_id == user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if cred is None:
        raise HTTPException(status_code=404, detail="Connector not found")
    cred.enabled = False
    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="connector.revoke",
        user=user,
        resource_type="connector",
        resource_id=cred.id,
        request=request,
    )
    await db.commit()
    return {"status": "ok"}


@router.delete("/connectors/{connector_id}")
async def delete_tenant_connector(
    connector_id: int,
    request: Request,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    """Permanently remove a connector credential.

    If the credential backs a hosted Webex connector instance, tear that
    instance down first (CASCADE would only drop the DB row).
    """
    cred = (
        await db.execute(
            select(ConnectorCredential).where(
                ConnectorCredential.id == connector_id,
                ConnectorCredential.tenant_id == user.tenant_id,
            )
        )
    ).scalar_one_or_none()
    if cred is None:
        raise HTTPException(status_code=404, detail="Connector not found")

    linked = (
        await db.execute(
            select(WebexConnectorInstance).where(
                WebexConnectorInstance.connector_credential_id == cred.id
            )
        )
    ).scalar_one_or_none()
    if linked is not None:
        await wxc.teardown_tenant_connector(db, user.tenant_id)

    await record_audit(
        db,
        tenant_id=user.tenant_id,
        action="connector.delete",
        user=user,
        resource_type="connector",
        resource_id=cred.id,
        detail={"name": cred.name, "kind": cred.kind.value},
        request=request,
    )
    await db.delete(cred)
    await db.commit()
    return {"status": "ok"}


@router.get("/storage-stats", response_model=StorageStats)
async def storage_stats(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    tid = user.tenant_id
    group_id = await scoped_call_filter(user)

    def group_scoped(stmt):
        return stmt if group_id is None else stmt.where(Call.group_id == group_id)

    totals = (
        await db.execute(
            group_scoped(
                select(
                    func.coalesce(func.sum(Recording.bytes), 0),
                    func.count(Recording.id),
                )
                .join(Call, Recording.call_id == Call.id)
                .where(Recording.tenant_id == tid)
            )
        )
    ).one()
    total_bytes, recording_count = int(totals[0]), int(totals[1])
    call_count = (await db.execute(distinct_call_count_stmt(tid, group_id))).scalar_one()

    by_source_rows = (
        await db.execute(
            group_scoped(
                select(
                    Call.source,
                    func.coalesce(func.sum(Recording.bytes), 0),
                    func.count(Recording.id),
                )
                .join(Call, Recording.call_id == Call.id)
                .where(Recording.tenant_id == tid)
                .group_by(Call.source)
            )
        )
    ).all()

    twelve_months_ago = datetime.now(timezone.utc).replace(
        day=1, hour=0, minute=0, second=0, microsecond=0
    ) - timedelta(days=365)
    month = func.to_char(func.date_trunc("month", Call.started_at), "YYYY-MM")
    by_month_rows = (
        await db.execute(
            group_scoped(
                select(
                    month.label("month"),
                    func.coalesce(func.sum(Recording.bytes), 0),
                    func.count(Recording.id),
                )
                .join(Call, Recording.call_id == Call.id)
                .where(Recording.tenant_id == tid, Call.started_at >= twelve_months_ago)
                .group_by("month")
                .order_by("month")
            )
        )
    ).all()

    largest_rows = (
        await db.execute(
            group_scoped(
                select(Recording, Call)
                .join(Call, Recording.call_id == Call.id)
                .where(Recording.tenant_id == tid, Recording.bytes.is_not(None))
                .order_by(desc(Recording.bytes))
                .limit(10)
            )
        )
    ).all()

    perms = user_permissions(user)
    backend = (
        settings.storage_backend
        if (user.is_superadmin or Permission.MANAGE_USERS.value in perms)
        else None
    )

    return StorageStats(
        total_bytes=total_bytes,
        recording_count=recording_count,
        call_count=call_count,
        avg_bytes=total_bytes // recording_count if recording_count else 0,
        by_source=[
            {"source": s.value if hasattr(s, "value") else str(s), "bytes": int(b), "count": int(c)}
            for s, b, c in by_source_rows
        ],
        by_month=[{"month": m, "bytes": int(b), "count": int(c)} for m, b, c in by_month_rows],
        largest=[
            {
                "recording_id": rec.id,
                "call_id": call.id,
                "leg": rec.leg.value,
                "bytes": int(rec.bytes or 0),
                "started_at": call.started_at,
                "near_name": format_party(call.near_name, call.near_addr),
                "far_name": format_party(call.far_name, call.far_addr),
                "source": call.source.value,
            }
            for rec, call in largest_rows
        ],
        storage_backend=backend,
    )
