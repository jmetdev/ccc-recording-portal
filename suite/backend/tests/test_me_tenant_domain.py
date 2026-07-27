"""Domain-based tenant resolution for GET /me/tenant."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from app.api import me as me_api
from app.models import SuiteTenant, TenantStatus


def _tenant(
    *,
    id: int,
    slug: str,
    name: str,
    admin_email: str,
    status: TenantStatus,
    email_domains: list[str] | None = None,
    webex_org_id: str | None = None,
) -> SuiteTenant:
    return SuiteTenant(
        id=id,
        slug=slug,
        name=name,
        admin_email=admin_email,
        status=status,
        email_domains=email_domains or [],
        webex_org_id=webex_org_id,
        linked_at=datetime.now(timezone.utc) if status == TenantStatus.ACTIVE else None,
        created_at=datetime.now(timezone.utc),
        entitlements=[],
    )


def test_email_domain_extracts_lowercase_suffix():
    assert me_api._email_domain("Adam@Hyetechnetworks.COM") == "hyetechnetworks.com"
    assert me_api._email_domain("invalid") is None


def test_normalize_domains_dedupes_and_lowercases():
    assert me_api._normalize_domains([" Example.COM ", "example.com", "Other.ORG"]) == [
        "example.com",
        "other.org",
    ]


@pytest.mark.asyncio
async def test_get_my_tenant_domain_match_active():
    active = _tenant(
        id=1,
        slug="htdemo",
        name="HT Demo",
        admin_email="jmetcalf@hyetechnetworks.com",
        status=TenantStatus.ACTIVE,
        email_domains=["hyetechnetworks.com"],
    )
    db = AsyncMock()
    claims = {"email": "adam@hyetechnetworks.com"}

    with (
        patch.object(me_api, "_tenant_by_org", AsyncMock(return_value=None)),
        patch.object(me_api, "_pending_tenant_by_email", AsyncMock(return_value=None)),
        patch.object(me_api, "_active_tenants_by_domain", AsyncMock(return_value=[active])),
    ):
        result = await me_api.get_my_tenant(tenant_id=None, claims=claims, db=db)

    assert result.status == "active"
    assert result.tenant is not None
    assert result.tenant.slug == "htdemo"


@pytest.mark.asyncio
async def test_get_my_tenant_domain_does_not_match_pending():
    pending = _tenant(
        id=2,
        slug="newco",
        name="New Co",
        admin_email="admin@newco.com",
        status=TenantStatus.PENDING,
        email_domains=["newco.com"],
    )
    db = AsyncMock()
    claims = {"email": "user@newco.com"}

    with (
        patch.object(me_api, "_tenant_by_org", AsyncMock(return_value=None)),
        patch.object(me_api, "_pending_tenant_by_email", AsyncMock(return_value=None)),
        patch.object(me_api, "_active_tenants_by_domain", AsyncMock(return_value=[])) as domain_lookup,
    ):
        result = await me_api.get_my_tenant(tenant_id=None, claims=claims, db=db)

    assert result.status == "unlinked"
    domain_lookup.assert_awaited_once_with(db, "newco.com")
    assert pending.status == TenantStatus.PENDING


@pytest.mark.asyncio
async def test_get_my_tenant_exact_admin_email_still_pending_match():
    pending = _tenant(
        id=3,
        slug="newco",
        name="New Co",
        admin_email="admin@newco.com",
        status=TenantStatus.PENDING,
        email_domains=["newco.com"],
    )
    db = AsyncMock()
    claims = {"email": "admin@newco.com"}

    with (
        patch.object(me_api, "_tenant_by_org", AsyncMock(return_value=None)),
        patch.object(me_api, "_pending_tenant_by_email", AsyncMock(return_value=pending)),
        patch.object(me_api, "_active_tenants_by_domain", AsyncMock()) as domain_lookup,
    ):
        result = await me_api.get_my_tenant(tenant_id=None, claims=claims, db=db)

    assert result.status == "pending_match"
    assert result.tenant is not None
    assert result.tenant.admin_email == "admin@newco.com"
    domain_lookup.assert_not_called()


@pytest.mark.asyncio
async def test_get_my_tenant_ambiguous_multiple_active():
    tenants = [
        _tenant(
            id=1,
            slug="a",
            name="Workspace A",
            admin_email="admin-a@example.com",
            status=TenantStatus.ACTIVE,
            email_domains=["example.com"],
        ),
        _tenant(
            id=2,
            slug="b",
            name="Workspace B",
            admin_email="admin-b@example.com",
            status=TenantStatus.ACTIVE,
            email_domains=["example.com"],
        ),
    ]
    db = AsyncMock()
    claims = {"email": "user@example.com"}

    with (
        patch.object(me_api, "_tenant_by_org", AsyncMock(return_value=None)),
        patch.object(me_api, "_pending_tenant_by_email", AsyncMock(return_value=None)),
        patch.object(me_api, "_active_tenants_by_domain", AsyncMock(return_value=tenants)),
    ):
        result = await me_api.get_my_tenant(tenant_id=None, claims=claims, db=db)

    assert result.status == "ambiguous_match"
    assert result.tenant is None
    assert len(result.tenants) == 2


@pytest.mark.asyncio
async def test_get_my_tenant_sticky_tenant_id():
    tenants = [
        _tenant(
            id=1,
            slug="a",
            name="Workspace A",
            admin_email="admin-a@example.com",
            status=TenantStatus.ACTIVE,
            email_domains=["example.com"],
        ),
        _tenant(
            id=2,
            slug="b",
            name="Workspace B",
            admin_email="admin-b@example.com",
            status=TenantStatus.ACTIVE,
            email_domains=["example.com"],
        ),
    ]
    db = AsyncMock()
    claims = {"email": "user@example.com"}

    with (
        patch.object(me_api, "_tenant_by_org", AsyncMock(return_value=None)),
        patch.object(me_api, "_pending_tenant_by_email", AsyncMock(return_value=None)),
        patch.object(me_api, "_active_tenants_by_domain", AsyncMock(return_value=tenants)),
    ):
        result = await me_api.get_my_tenant(tenant_id=2, claims=claims, db=db)

    assert result.status == "active"
    assert result.tenant is not None
    assert result.tenant.id == 2


@pytest.mark.asyncio
async def test_link_requires_exact_admin_email():
    db = AsyncMock()
    claims = {"email": "user@newco.com", "webex_org_id": "org-123"}

    with patch.object(me_api, "_pending_tenant_by_email", AsyncMock(return_value=None)):
        with pytest.raises(HTTPException) as exc:
            await me_api.link_my_tenant(claims=claims, db=db)

    assert exc.value.status_code == 404
