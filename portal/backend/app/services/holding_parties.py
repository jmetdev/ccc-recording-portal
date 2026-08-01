"""Discover near parties on holding calls and bulk-enable recording seats."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models import Call, CallSource, RecordedExtension, RecordedUser, recorded_extension_groups, recorded_user_groups
from app.services.party_identity import looks_like_email, normalize_email
from app.services.recorded_extensions import (
    group_id_for_extension,
    normalize_extension,
    release_holding_calls_for_extension,
)
from app.services.recorded_users import group_id_for_recorded_user, release_holding_calls_for_email

PartyKind = Literal["extension", "email"]


@dataclass
class HoldingPartyRow:
    near_addr: str
    near_name: str | None
    kind: PartyKind
    call_count: int
    source_hint: str
    already_configured: bool


def infer_party_kind(near_addr: str | None) -> PartyKind:
    return "email" if looks_like_email(near_addr) else "extension"


def source_hint_from_sources(sources: set[str]) -> str:
    if not sources:
        return "unknown"
    if len(sources) == 1:
        return next(iter(sources))
    return "mixed"


def party_value_for_kind(kind: PartyKind, near_addr: str) -> str:
    if kind == "email":
        email = normalize_email(near_addr)
        if not email:
            raise ValueError("Invalid email near_addr")
        return email
    ext = normalize_extension(near_addr)
    if not ext:
        raise ValueError("Invalid extension near_addr")
    return ext


async def list_holding_parties(db: AsyncSession, *, tenant_id: int) -> list[HoldingPartyRow]:
    rows = (
        await db.execute(
            select(Call.near_addr, Call.near_name, Call.source, Call.started_at)
            .where(
                Call.tenant_id == tenant_id,
                Call.holding.is_(True),
                Call.trashed_at.is_(None),
                Call.near_addr.is_not(None),
                Call.near_addr != "",
            )
            .order_by(Call.started_at.desc())
        )
    ).all()

    by_addr: dict[str, dict] = {}
    for near_addr, near_name, source, _started_at in rows:
        key = near_addr.strip()
        bucket = by_addr.get(key)
        if bucket is None:
            by_addr[key] = {
                "near_name": near_name,
                "call_count": 1,
                "sources": {source.value if isinstance(source, CallSource) else str(source)},
            }
        else:
            bucket["call_count"] += 1
            bucket["sources"].add(source.value if isinstance(source, CallSource) else str(source))
            if near_name and not bucket["near_name"]:
                bucket["near_name"] = near_name

    enabled_exts = {
        normalize_extension(e.extension)
        for e in (
            await db.execute(
                select(RecordedExtension.extension).where(
                    RecordedExtension.tenant_id == tenant_id,
                    RecordedExtension.enabled.is_(True),
                )
            )
        ).scalars()
        if normalize_extension(e)
    }
    enabled_emails = {
        e.lower()
        for e in (
            await db.execute(
                select(RecordedUser.email).where(
                    RecordedUser.tenant_id == tenant_id,
                    RecordedUser.enabled.is_(True),
                )
            )
        ).scalars()
    }

    parties: list[HoldingPartyRow] = []
    for near_addr, data in by_addr.items():
        kind = infer_party_kind(near_addr)
        if kind == "email":
            value = normalize_email(near_addr)
            configured = bool(value and value in enabled_emails)
        else:
            value = normalize_extension(near_addr)
            configured = bool(value and value in enabled_exts)
        parties.append(
            HoldingPartyRow(
                near_addr=near_addr,
                near_name=data["near_name"],
                kind=kind,
                call_count=data["call_count"],
                source_hint=source_hint_from_sources(data["sources"]),
                already_configured=configured,
            )
        )

    parties.sort(key=lambda p: (-p.call_count, p.near_addr.lower()))
    return parties


@dataclass
class HoldingEnableItem:
    kind: PartyKind
    value: str
    display_name: str | None = None
    group_ids: list[int] | None = None


@dataclass
class HoldingEnableResult:
    extensions_enabled: int
    users_enabled: int
    calls_released: int
    skipped_already_configured: int


async def _set_extension_groups(db: AsyncSession, ext: RecordedExtension, group_ids: list[int]) -> None:
    await db.execute(
        delete(recorded_extension_groups).where(recorded_extension_groups.c.extension_id == ext.id)
    )
    for group_id in group_ids:
        await db.execute(
            recorded_extension_groups.insert().values(extension_id=ext.id, group_id=group_id)
        )


async def _set_recorded_user_groups(db: AsyncSession, user: RecordedUser, group_ids: list[int]) -> None:
    await db.execute(delete(recorded_user_groups).where(recorded_user_groups.c.user_id == user.id))
    for group_id in group_ids:
        await db.execute(recorded_user_groups.insert().values(user_id=user.id, group_id=group_id))


async def _find_extension(
    db: AsyncSession, *, tenant_id: int, extension: str
) -> RecordedExtension | None:
    return (
        await db.execute(
            select(RecordedExtension)
            .options(selectinload(RecordedExtension.groups))
            .where(
                RecordedExtension.tenant_id == tenant_id,
                RecordedExtension.extension == extension,
            )
        )
    ).scalar_one_or_none()


async def _find_recorded_user(db: AsyncSession, *, tenant_id: int, email: str) -> RecordedUser | None:
    return (
        await db.execute(
            select(RecordedUser)
            .options(selectinload(RecordedUser.groups))
            .where(RecordedUser.tenant_id == tenant_id, RecordedUser.email == email)
        )
    ).scalar_one_or_none()


async def bulk_enable_holding_parties(
    db: AsyncSession,
    *,
    tenant_id: int,
    items: list[HoldingEnableItem],
) -> HoldingEnableResult:
    extensions_enabled = 0
    users_enabled = 0
    calls_released = 0
    skipped = 0

    for item in items:
        if item.kind == "extension":
            ext_value = normalize_extension(item.value)
            if not ext_value:
                raise ValueError(f"Invalid extension: {item.value}")
            ext = await _find_extension(db, tenant_id=tenant_id, extension=ext_value)
            was_enabled = bool(ext and ext.enabled)
            if ext is None:
                ext = RecordedExtension(
                    tenant_id=tenant_id,
                    extension=ext_value,
                    label=item.display_name,
                    enabled=True,
                )
                db.add(ext)
                await db.flush()
                if item.group_ids:
                    await _set_extension_groups(db, ext, item.group_ids)
            else:
                if ext.enabled and item.display_name and not ext.label:
                    ext.label = item.display_name
                if not ext.enabled:
                    ext.enabled = True
                if item.group_ids is not None:
                    await _set_extension_groups(db, ext, item.group_ids)
            if was_enabled:
                skipped += 1
            else:
                extensions_enabled += 1
            group_id = item.group_ids[0] if item.group_ids else group_id_for_extension(ext)
            calls_released += await release_holding_calls_for_extension(
                db, tenant_id=tenant_id, extension=ext_value, group_id=group_id
            )
        else:
            email = normalize_email(item.value) or item.value.strip().lower()
            if not email or "@" not in email:
                raise ValueError(f"Invalid email: {item.value}")
            user = await _find_recorded_user(db, tenant_id=tenant_id, email=email)
            was_enabled = bool(user and user.enabled)
            if user is None:
                user = RecordedUser(
                    tenant_id=tenant_id,
                    email=email,
                    label=item.display_name,
                    enabled=True,
                )
                db.add(user)
                await db.flush()
                if item.group_ids:
                    await _set_recorded_user_groups(db, user, item.group_ids)
            else:
                if user.enabled and item.display_name and not user.label:
                    user.label = item.display_name
                if not user.enabled:
                    user.enabled = True
                if item.group_ids is not None:
                    await _set_recorded_user_groups(db, user, item.group_ids)
            if was_enabled:
                skipped += 1
            else:
                users_enabled += 1
            group_id = item.group_ids[0] if item.group_ids else group_id_for_recorded_user(user)
            calls_released += await release_holding_calls_for_email(
                db, tenant_id=tenant_id, email=email, group_id=group_id
            )

    return HoldingEnableResult(
        extensions_enabled=extensions_enabled,
        users_enabled=users_enabled,
        calls_released=calls_released,
        skipped_already_configured=skipped,
    )
