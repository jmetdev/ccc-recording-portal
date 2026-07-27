from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr

from app.models import App, TenantStatus


class EntitlementIn(BaseModel):
    app: App
    licensed: bool = False
    plan_name: str | None = None
    limits_json: dict | None = None


class EntitlementOut(EntitlementIn):
    model_config = ConfigDict(from_attributes=True)


class TenantCreate(BaseModel):
    slug: str
    name: str
    admin_email: EmailStr
    email_domains: list[str] = []
    entitlements: list[EntitlementIn] = []


class TenantUpdate(BaseModel):
    name: str | None = None
    admin_email: EmailStr | None = None
    email_domains: list[str] | None = None
    status: TenantStatus | None = None
    entitlements: list[EntitlementIn] | None = None


class TenantOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    slug: str
    name: str
    webex_org_id: str | None
    status: TenantStatus
    admin_email: str
    email_domains: list[str] = []
    linked_at: datetime | None
    created_at: datetime
    entitlements: list[EntitlementOut] = []


class MeTenantOut(BaseModel):
    status: str  # "active" | "pending_match" | "ambiguous_match" | "unlinked"
    is_superadmin: bool
    tenant: TenantOut | None = None
    tenants: list[TenantOut] = []


class LinkResult(BaseModel):
    tenant: TenantOut
