from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.database import get_db
from app.core.rbac import get_current_user, require_permission
from app.models import Permission
from app.services.system_health import build_system_status, fetch_log_lines

router = APIRouter(prefix="/system", tags=["system"])


@router.get(
    "/status",
    dependencies=[Depends(require_permission(Permission.MANAGE_USERS.value))],
)
async def system_status(user=Depends(get_current_user), db=Depends(get_db)):
    return await build_system_status(db, user.tenant_id, is_superadmin=user.is_superadmin)


@router.get(
    "/logs/{source}",
    dependencies=[Depends(require_permission(Permission.MANAGE_USERS.value))],
)
async def system_logs(
    source: str,
    lines: int = Query(120, ge=10, le=500),
    user=Depends(get_current_user),
):
    # Raw container/host logs can carry other tenants' call data on a shared
    # stack (single FreeSWITCH box, single whisper worker) — platform-operator
    # only, unlike the curated /status summary which tenant admins also see.
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Superadmin required")
    return await fetch_log_lines(source, lines)
