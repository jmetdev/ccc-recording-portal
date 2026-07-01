from collections.abc import Callable
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.database import get_db
from app.core.permissions import Permission
from app.core.security import decode_token
from app.models import Role, RolePermission, User, UserRole

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: Annotated[str, Depends(oauth2_scheme)],
    db: Annotated[Session, Depends(get_db)],
) -> User:
    credentials_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(token)
        if payload.get("type") != "access":
            raise credentials_exc
        username: str | None = payload.get("sub")
        if not username:
            raise credentials_exc
    except JWTError:
        raise credentials_exc from None

    user = (
        db.query(User)
        .options(
            joinedload(User.roles).joinedload(UserRole.role).joinedload(Role.permissions),
            joinedload(User.group),
        )
        .filter(User.username == username)
        .first()
    )
    if not user or not user.is_active:
        raise credentials_exc
    return user


def get_user_permissions(user: User, db: Session) -> set[str]:
    role_ids = [ur.role_id for ur in user.roles]
    if not role_ids:
        return set()
    perms = (
        db.query(RolePermission.permission)
        .filter(RolePermission.role_id.in_(role_ids))
        .all()
    )
    return {p[0] for p in perms}


def require_permission(permission: Permission) -> Callable:
    def checker(
        user: Annotated[User, Depends(get_current_user)],
        db: Annotated[Session, Depends(get_db)],
    ) -> User:
        perms = get_user_permissions(user, db)
        if permission.value not in perms:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return checker


def verify_ingest_token(x_ingest_token: Annotated[str | None, Header()] = None) -> None:
    settings = get_settings()
    if not x_ingest_token or x_ingest_token != settings.ingest_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid ingest token")


def verify_internal_token(x_internal_token: Annotated[str | None, Header()] = None) -> None:
    settings = get_settings()
    if not x_internal_token or x_internal_token != settings.internal_api_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal token")


def call_scope_filter(user: User, db: Session):
    perms = get_user_permissions(user, db)
    if Permission.VIEW_ALL_CALLS.value in perms:
        return None
    if Permission.VIEW_GROUP_CALLS.value in perms and user.group_id:
        return user.group_id
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No call access")
