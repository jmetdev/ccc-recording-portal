"""Caller-scoped endpoints: resolve tenant from token claims, bind a pending
tenant on first login, read entitlements.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.auth import get_claims
from app.core.config import settings
from app.core.database import get_db
from app.models import SuiteTenant, TenantStatus
from app.schemas import EntitlementOut, LinkResult, MeTenantOut, TenantOut

router = APIRouter(prefix="/me", tags=["me"])


def _email_domain(email: str) -> str | None:
    if "@" not in email:
        return None
    return email.rsplit("@", 1)[1].lower()


def _normalize_domains(domains: list[str]) -> list[str]:
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in domains:
        domain = raw.strip().lower()
        if domain and domain not in seen:
            seen.add(domain)
            normalized.append(domain)
    return normalized


def _is_superadmin(claims: dict) -> bool:
    email = (claims.get("email") or "").lower()
    return bool(email) and email in settings.superadmin_email_list


async def _tenant_by_org(db: AsyncSession, org_id: str) -> SuiteTenant | None:
    return (
        await db.execute(
            select(SuiteTenant)
            .where(SuiteTenant.webex_org_id == org_id)
            .options(selectinload(SuiteTenant.entitlements))
        )
    ).scalar_one_or_none()


async def _pending_tenant_by_email(db: AsyncSession, email: str) -> SuiteTenant | None:
    return (
        await db.execute(
            select(SuiteTenant)
            .where(SuiteTenant.admin_email == email, SuiteTenant.status == TenantStatus.PENDING)
            .options(selectinload(SuiteTenant.entitlements))
        )
    ).scalar_one_or_none()


async def _active_tenants_by_domain(db: AsyncSession, domain: str) -> list[SuiteTenant]:
    result = await db.execute(
        select(SuiteTenant)
        .where(
            SuiteTenant.status == TenantStatus.ACTIVE,
            SuiteTenant.email_domains.contains([domain]),
        )
        .options(selectinload(SuiteTenant.entitlements))
        .order_by(SuiteTenant.slug)
    )
    return list(result.scalars().all())


def _me_out(
    *,
    status: str,
    claims: dict,
    tenant: SuiteTenant | None = None,
    tenants: list[SuiteTenant] | None = None,
) -> MeTenantOut:
    return MeTenantOut(
        status=status,
        is_superadmin=_is_superadmin(claims),
        tenant=TenantOut.model_validate(tenant) if tenant is not None else None,
        tenants=[TenantOut.model_validate(t) for t in (tenants or [])],
    )


@router.get("/tenant", response_model=MeTenantOut)
async def get_my_tenant(
    tenant_id: int | None = Query(None),
    claims: dict = Depends(get_claims),
    db: AsyncSession = Depends(get_db),
):
    org_id = claims.get(settings.oidc_org_claim)
    email = (claims.get("email") or "").lower()

    if org_id:
        tenant = await _tenant_by_org(db, org_id)
        if tenant is not None:
            return _me_out(status="active", claims=claims, tenant=tenant)

    if email:
        pending = await _pending_tenant_by_email(db, email)
        if pending is not None:
            return _me_out(status="pending_match", claims=claims, tenant=pending)

        domain = _email_domain(email)
        if domain:
            matches = await _active_tenants_by_domain(db, domain)
            if tenant_id is not None:
                chosen = next((t for t in matches if t.id == tenant_id), None)
                if chosen is not None:
                    return _me_out(status="active", claims=claims, tenant=chosen)
            if len(matches) == 1:
                return _me_out(status="active", claims=claims, tenant=matches[0])
            if len(matches) > 1:
                return _me_out(status="ambiguous_match", claims=claims, tenants=matches)

    return _me_out(status="unlinked", claims=claims)


@router.post("/link", response_model=LinkResult)
async def link_my_tenant(claims: dict = Depends(get_claims), db: AsyncSession = Depends(get_db)):
    email = (claims.get("email") or "").lower()
    org_id = claims.get(settings.oidc_org_claim)
    if not email:
        raise HTTPException(status_code=400, detail="Token has no email claim")
    if not org_id:
        raise HTTPException(
            status_code=400,
            detail="Token has no Webex org claim — the Webex login scope may be missing spark:people_read",
        )

    pending = await _pending_tenant_by_email(db, email)
    if pending is None:
        raise HTTPException(status_code=404, detail="No pending tenant registered for this email")

    already = await _tenant_by_org(db, org_id)
    if already is not None and already.id != pending.id:
        raise HTTPException(status_code=409, detail="This Webex organization is already linked to another tenant")

    pending.webex_org_id = org_id
    pending.status = TenantStatus.ACTIVE
    pending.linked_at = datetime.now(timezone.utc)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=409, detail="This Webex organization is already linked to another tenant") from None

    result = (
        await db.execute(
            select(SuiteTenant).where(SuiteTenant.id == pending.id).options(selectinload(SuiteTenant.entitlements))
        )
    ).scalar_one()
    return LinkResult(tenant=TenantOut.model_validate(result))


@router.get("/entitlements", response_model=list[EntitlementOut])
async def get_my_entitlements(claims: dict = Depends(get_claims), db: AsyncSession = Depends(get_db)):
    org_id = claims.get(settings.oidc_org_claim)
    if not org_id:
        return []
    tenant = await _tenant_by_org(db, org_id)
    if tenant is None:
        return []
    return [EntitlementOut.model_validate(e) for e in tenant.entitlements]
