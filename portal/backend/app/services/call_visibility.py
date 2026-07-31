"""RBAC helpers for call visibility and per-user read state."""

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Call, CallRead, Group, User
from app.services.recorded_extensions import near_addr_matches_extension, normalize_extension
from app.services.party_identity import looks_like_email


@dataclass(frozen=True)
class CallVisibilityScope:
    mode: Literal["all", "groups", "own"]
    group_ids: tuple[int, ...] = ()

    @staticmethod
    def all() -> "CallVisibilityScope":
        return CallVisibilityScope("all")

    @staticmethod
    def groups(group_ids: list[int]) -> "CallVisibilityScope":
        return CallVisibilityScope("groups", tuple(group_ids))

    @staticmethod
    def own() -> "CallVisibilityScope":
        return CallVisibilityScope("own")


def user_group_ids(user: User) -> list[int]:
    if user.groups:
        return [g.id for g in user.groups]
    return [user.group_id] if user.group_id is not None else []


def user_matches_call_near(user: User, near_addr: str | None) -> bool:
    if not near_addr:
        return False
    email = getattr(user, "email", None)
    if looks_like_email(near_addr) and email:
        return email.strip().lower() == near_addr.strip().lower()
    ext = normalize_extension(user.extension)
    if not ext:
        return False
    return near_addr_matches_extension(near_addr, ext)


def append_visibility_scope(filters: list, scope: CallVisibilityScope, user: User) -> None:
    """Mutate *filters* with tenant call visibility for the current user."""
    if scope.mode == "all":
        return
    if scope.mode == "groups":
        if not scope.group_ids:
            filters.append(Call.id == -1)
        else:
            filters.append(Call.group_id.in_(scope.group_ids))
        return
    ext = normalize_extension(user.extension)
    if not ext:
        filters.append(Call.id == -1)
    else:
        filters.append(or_(Call.near_addr == ext, Call.near_addr.like(f"{ext}@%")))


async def read_call_ids_for_user(db: AsyncSession, user_id: int, call_ids: list[int]) -> set[int]:
    if not call_ids:
        return set()
    rows = (
        await db.execute(
            select(CallRead.call_id).where(CallRead.user_id == user_id, CallRead.call_id.in_(call_ids))
        )
    ).scalars().all()
    return set(rows)


async def group_names_by_id(db: AsyncSession, tenant_id: int, group_ids: set[int]) -> dict[int, str]:
    if not group_ids:
        return {}
    rows = (
        await db.execute(
            select(Group.id, Group.name).where(Group.tenant_id == tenant_id, Group.id.in_(group_ids))
        )
    ).all()
    return {gid: name for gid, name in rows}
