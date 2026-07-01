import enum
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.security import decode_token, is_token_type
from app.models import Permission, Role, User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


async def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[AsyncSession, Depends(get_db)],
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if not is_token_type(payload, "access"):
            raise credentials_exc
        user_id = payload.get("sub")
        if user_id is None:
            raise credentials_exc
    except JWTError as exc:
        raise credentials_exc from exc

    result = await db.execute(
        select(User)
        .options(selectinload(User.roles).selectinload(Role.permissions))
        .where(User.id == int(user_id))
    )
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise credentials_exc
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
