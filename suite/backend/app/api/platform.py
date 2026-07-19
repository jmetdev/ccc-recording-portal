"""Superadmin tenant/entitlement administration."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import require_superadmin
from app.core.database import get_db
from app.models import Entitlement, SuiteTenant
from app.schemas import EntitlementIn, TenantCreate, TenantOut, TenantUpdate

router = APIRouter(prefix="/platform", tags=["platform"], dependencies=[Depends(require_superadmin)])


async def _get_tenant(db: AsyncSession, tenant_id: int) -> SuiteTenant:
    tenant = (await db.execute(select(SuiteTenant).where(SuiteTenant.id == tenant_id))).scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant


async def _apply_entitlements(db: AsyncSession, tenant_id: int, entitlements: list[EntitlementIn]) -> None:
    # Query/insert Entitlement rows directly by tenant_id rather than through
    # the SuiteTenant.entitlements relationship: touching a lazy collection on
    # a just-flushed object triggers an implicit sync load that the async
    # driver can't service (MissingGreenlet).
    existing = (
        await db.execute(select(Entitlement).where(Entitlement.tenant_id == tenant_id))
    ).scalars().all()
    by_app = {e.app: e for e in existing}
    for item in entitlements:
        row = by_app.get(item.app)
        if row is not None:
            row.licensed = item.licensed
            row.plan_name = item.plan_name
            row.limits_json = item.limits_json
        else:
            db.add(
                Entitlement(
                    tenant_id=tenant_id,
                    app=item.app,
                    licensed=item.licensed,
                    plan_name=item.plan_name,
                    limits_json=item.limits_json,
                )
            )


@router.get("/tenants", response_model=list[TenantOut])
async def list_tenants(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SuiteTenant).order_by(SuiteTenant.slug))
    return result.scalars().all()


@router.post("/tenants", response_model=TenantOut)
async def create_tenant(body: TenantCreate, db: AsyncSession = Depends(get_db)):
    exists = (await db.execute(select(SuiteTenant).where(SuiteTenant.slug == body.slug))).scalar_one_or_none()
    if exists:
        raise HTTPException(status_code=409, detail="Tenant slug already exists")
    tenant = SuiteTenant(slug=body.slug, name=body.name, admin_email=body.admin_email.lower())
    db.add(tenant)
    await db.flush()
    await _apply_entitlements(db, tenant.id, body.entitlements)
    await db.commit()
    return await _get_tenant(db, tenant.id)


@router.get("/tenants/{tenant_id}", response_model=TenantOut)
async def get_tenant(tenant_id: int, db: AsyncSession = Depends(get_db)):
    return await _get_tenant(db, tenant_id)


@router.patch("/tenants/{tenant_id}", response_model=TenantOut)
async def update_tenant(tenant_id: int, body: TenantUpdate, db: AsyncSession = Depends(get_db)):
    tenant = await _get_tenant(db, tenant_id)
    changes = body.model_dump(exclude_unset=True, exclude={"entitlements"})
    if "admin_email" in changes and changes["admin_email"]:
        changes["admin_email"] = changes["admin_email"].lower()
    for k, v in changes.items():
        setattr(tenant, k, v)
    if body.entitlements is not None:
        await _apply_entitlements(db, tenant_id, body.entitlements)
    await db.commit()
    return await _get_tenant(db, tenant_id)
