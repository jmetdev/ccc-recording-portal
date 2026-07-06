from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Tenant

_default_tenant_id: int | None = None


async def get_default_tenant_id(db: AsyncSession) -> int:
    """Tenant that legacy (v1) single-tenant integrations map onto."""
    global _default_tenant_id
    if _default_tenant_id is None:
        result = await db.execute(select(Tenant.id).where(Tenant.slug == settings.default_tenant_slug))
        _default_tenant_id = result.scalar_one()
    return _default_tenant_id
