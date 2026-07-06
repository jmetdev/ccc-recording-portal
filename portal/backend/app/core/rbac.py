from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db, set_tenant_context
from app.core.security import decode_token, is_token_type
from app.models import Permission, Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


async def load_user(db: AsyncSession, user_id: int) -> User | None:
    result = await db.execute(
        select(User)
        .options(
            selectinload(User.roles).selectinload(Role.permissions),
            selectinload(User.tenant),
        )
        .where(User.id == user_id)
    )
    return result.scalar_one_or_none()


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    user: User | None = None
    try:
        payload = decode_token(token)
        if not is_token_type(payload, "access"):
            raise credentials_exc
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exc
        user = await load_user(db, int(user_id))
        tid = payload.get("tid")
        if user is not None and tid is not None and user.tenant_id != tid:
            raise credentials_exc
    except JWTError:
        # Not one of our local tokens: try the external IdP if SSO is enabled.
        if not settings.oidc_enabled:
            raise credentials_exc from None
        from app.core.oidc import resolve_oidc_user

        user = await resolve_oidc_user(db, token)

    if user is None or not user.is_active or (user.tenant and not user.tenant.is_active):
        raise credentials_exc

    # Superadmins operate in system context so cross-tenant admin queries work;
    # everyone else gets RLS pinned to their tenant for this transaction.
    if not user.is_superadmin:
        await set_tenant_context(db, user.tenant_id)
    return user


async def require_superadmin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if not user.is_superadmin:
        raise HTTPException(status_code=403, detail="Platform admin required")
    return user


def user_permissions(user: User) -> set[str]:
    perms: set[str] = set()
    for role in user.roles:
        for perm in role.permissions:
            perms.add(perm.permission.value)
    return perms


def require_permission(*required: str):
    async def checker(user: Annotated[User, Depends(get_current_user)]) -> User:
        perms = user_permissions(user)
        if Permission.MANAGE_USERS.value in perms:
            return user
        for p in required:
            if p not in perms:
                raise HTTPException(status_code=403, detail=f"Missing permission: {p}")
        return user

    return checker


def can_view_call(user: User, call_group_id: int | None) -> bool:
    perms = user_permissions(user)
    if Permission.VIEW_ALL_CALLS.value in perms or Permission.MANAGE_USERS.value in perms:
        return True
    if Permission.VIEW_GROUP_CALLS.value in perms and call_group_id == user.group_id:
        return True
    return False


async def scoped_call_filter(user: User):
    perms = user_permissions(user)
    if Permission.VIEW_ALL_CALLS.value in perms or Permission.MANAGE_USERS.value in perms:
        return None
    if Permission.VIEW_GROUP_CALLS.value in perms:
        return user.group_id
    raise HTTPException(status_code=403, detail="No call viewing permission")
