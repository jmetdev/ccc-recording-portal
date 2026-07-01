from fastapi import APIRouter, Depends, Query

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
    return await build_system_status(db)


@router.get(
    "/logs/{source}",
    dependencies=[Depends(require_permission(Permission.MANAGE_USERS.value))],
)
async def system_logs(
    source: str,
    lines: int = Query(120, ge=10, le=500),
    user=Depends(get_current_user),
):
    return await fetch_log_lines(source, lines)
