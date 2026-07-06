"""Tenant audit trail.

Records who did what to which recording — a procurement requirement for
government customers (public-records accountability), not just debugging.
"""

from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import AuditLog, User


async def record_audit(
    db: AsyncSession,
    *,
    tenant_id: int,
    action: str,
    user: User | None = None,
    resource_type: str | None = None,
    resource_id: int | str | None = None,
    detail: dict | None = None,
    request: Request | None = None,
    commit: bool = False,
) -> None:
    ip = None
    if request is not None and request.client is not None:
        ip = request.client.host
    db.add(
        AuditLog(
            tenant_id=tenant_id,
            user_id=user.id if user else None,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            detail=detail,
            ip=ip,
        )
    )
    if commit:
        await db.commit()
    else:
        await db.flush()
