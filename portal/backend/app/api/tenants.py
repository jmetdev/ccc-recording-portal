"""Platform administration: tenants, connector credentials, audit, retention."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.rbac import get_current_user, require_permission, require_superadmin
from app.core.security import generate_connector_token
from app.models import (
    AuditLog,
    ConnectorCredential,
    ConnectorKind,
    Permission,
    Tenant,
    User,
)
from app.schemas import (
    AuditLogOut,
    ConnectorCredentialCreate,
    ConnectorCredentialCreated,
    ConnectorCredentialOut,
    TenantCreate,
    TenantOut,
    TenantUpdate,
)
from app.services.audit import record_audit
from app.services.retention import sweep_expired_calls

router = APIRouter(prefix="/platform", tags=["platform"])


@router.get("/tenants", response_model=list[TenantOut], dependencies=[Depends(require_superadmin)])
async def list_tenants(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Tenant).order_by(Tenant.slug))
    return result.scalars().all()


@router.post("/tenants", response_model=TenantOut)
async def create_tenant(
    body: TenantCreate,
    request: Request,
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    exists = (await db.execute(select(Tenant).where(Tenant.slug == body.slug))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Tenant slug already exists")
    tenant = Tenant(slug=body.slug, name=body.name, retention_days=body.retention_days)
    db.add(tenant)
    await db.flush()
    await record_audit(
        db,
        tenant_id=tenant.id,
        action="tenant.create",
        user=admin,
        resource_type="tenant",
        resource_id=tenant.id,
        request=request,
    )
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.patch("/tenants/{tenant_id}", response_model=TenantOut)
async def update_tenant(
    tenant_id: int,
    body: TenantUpdate,
    request: Request,
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    changes = body.model_dump(exclude_unset=True)
    for k, v in changes.items():
        setattr(tenant, k, v)
    await record_audit(
        db,
        tenant_id=tenant.id,
        action="tenant.update",
        user=admin,
        resource_type="tenant",
        resource_id=tenant.id,
        detail=changes,
        request=request,
    )
    await db.commit()
    await db.refresh(tenant)
    return tenant


@router.get(
    "/tenants/{tenant_id}/connectors",
    response_model=list[ConnectorCredentialOut],
    dependencies=[Depends(require_superadmin)],
)
async def list_connectors(tenant_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ConnectorCredential)
        .where(ConnectorCredential.tenant_id == tenant_id)
        .order_by(ConnectorCredential.created_at)
    )
    return result.scalars().all()


@router.post("/tenants/{tenant_id}/connectors", response_model=ConnectorCredentialCreated)
async def create_connector(
    tenant_id: int,
    body: ConnectorCredentialCreate,
    request: Request,
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    try:
        kind = ConnectorKind(body.kind)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"Unknown connector kind: {body.kind}") from None

    token, token_hash = generate_connector_token()
    cred = ConnectorCredential(tenant_id=tenant_id, name=body.name, kind=kind, token_hash=token_hash)
    db.add(cred)
    await db.flush()
    await record_audit(
        db,
        tenant_id=tenant_id,
        action="connector.create",
        user=admin,
        resource_type="connector",
        resource_id=cred.id,
        detail={"name": body.name, "kind": kind.value},
        request=request,
    )
    await db.commit()
    await db.refresh(cred)
    out = ConnectorCredentialCreated.model_validate(cred, from_attributes=True)
    out.token = token
    return out


@router.delete("/connectors/{connector_id}")
async def revoke_connector(
    connector_id: int,
    request: Request,
    admin: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
):
    cred = (
        await db.execute(select(ConnectorCredential).where(ConnectorCredential.id == connector_id))
    ).scalar_one_or_none()
    if cred is None:
        raise HTTPException(status_code=404, detail="Connector not found")
    cred.enabled = False
    await record_audit(
        db,
        tenant_id=cred.tenant_id,
        action="connector.revoke",
        user=admin,
        resource_type="connector",
        resource_id=cred.id,
        request=request,
    )
    await db.commit()
    return {"status": "ok"}


@router.get("/audit", response_model=list[AuditLogOut])
async def list_audit_logs(
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    action: str | None = None,
    user: User = Depends(require_permission(Permission.MANAGE_USERS.value)),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc())
    # Tenant admins see their tenant's trail; platform admins see everything.
    if not user.is_superadmin:
        stmt = stmt.where(AuditLog.tenant_id == user.tenant_id)
    if action:
        stmt = stmt.where(AuditLog.action == action)
    result = await db.execute(stmt.offset((page - 1) * page_size).limit(page_size))
    return result.scalars().all()


@router.post("/retention/sweep", dependencies=[Depends(require_superadmin)])
async def run_retention_sweep(db: AsyncSession = Depends(get_db)):
    return await sweep_expired_calls(db)
