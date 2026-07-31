"""Unit tests for call visibility helpers."""

from types import SimpleNamespace

from app.services.call_visibility import (
    CallVisibilityScope,
    append_visibility_scope,
    user_group_ids,
    user_matches_call_near,
)


def _user(*, group_ids: list[int] | None = None, extension: str | None = None, email: str | None = None):
    groups = [SimpleNamespace(id=gid) for gid in (group_ids or [])]
    return SimpleNamespace(
        groups=groups,
        group_id=group_ids[0] if group_ids else None,
        extension=extension,
        email=email,
    )


def test_user_group_ids_prefers_m2m():
    user = _user(group_ids=[3, 4])
    assert user_group_ids(user) == [3, 4]


def test_user_group_ids_falls_back_to_legacy_group_id():
    user = SimpleNamespace(groups=[], group_id=7)
    assert user_group_ids(user) == [7]


def test_append_visibility_scope_all_is_noop():
    filters: list = []
    append_visibility_scope(filters, CallVisibilityScope.all(), _user())
    assert filters == []


def test_append_visibility_scope_groups():
    filters: list = []
    append_visibility_scope(filters, CallVisibilityScope.groups([1, 2]), _user())
    assert len(filters) == 1


def test_append_visibility_scope_own_matches_near_addr():
    filters: list = []
    append_visibility_scope(filters, CallVisibilityScope.own(), _user(extension="1034"))
    assert len(filters) == 1


def test_append_visibility_scope_own_without_extension_blocks_all():
    filters: list = []
    append_visibility_scope(filters, CallVisibilityScope.own(), _user(extension=None))
    assert len(filters) == 1


def test_user_matches_call_near():
    user = _user(extension="1034")
    assert user_matches_call_near(user, "1034")
    assert user_matches_call_near(user, "1034@host")
    assert not user_matches_call_near(user, "1035")
