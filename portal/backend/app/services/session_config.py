"""Tenant-scoped portal session lifetimes (JWT access + refresh)."""

from app.core.config import settings
from app.models import Tenant


def tenant_access_minutes(tenant: Tenant) -> int:
    if tenant.session_access_minutes is not None:
        return tenant.session_access_minutes
    return settings.access_token_expire_minutes


def tenant_refresh_days(tenant: Tenant) -> int:
    if tenant.session_refresh_days is not None:
        return tenant.session_refresh_days
    return settings.refresh_token_expire_days
