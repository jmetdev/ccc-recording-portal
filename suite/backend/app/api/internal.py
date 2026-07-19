"""Service-to-service endpoints for product backends (recording, fax)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import require_internal_token
from app.core.database import get_db
from app.models import SuiteTenant
from app.schemas import TenantOut

router = APIRouter(prefix="/internal", tags=["internal"], dependencies=[Depends(require_internal_token)])


@router.get("/tenants/by-org/{org_id}", response_model=TenantOut)
async def get_tenant_by_org(org_id: str, db: AsyncSession = Depends(get_db)):
    tenant = (
        await db.execute(
            select(SuiteTenant).where(SuiteTenant.webex_org_id == org_id).options(selectinload(SuiteTenant.entitlements))
        )
    ).scalar_one_or_none()
    if tenant is None:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return tenant
