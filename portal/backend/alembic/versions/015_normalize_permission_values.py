"""Normalize role_permissions.permission to lowercase values.

Revision ID: 015
Revises: 014

SQLAlchemy previously persisted Permission by member name (VIEW_ALL_CALLS)
while some seed/migration paths wrote values (view_all_calls). Reading mixed
rows 500s list_roles. Normalize to values and keep the ORM on values_callable.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "015"
down_revision: Union[str, None] = "014"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_PERMISSION_MAP = {
    "VIEW_ALL_CALLS": "view_all_calls",
    "VIEW_GROUP_CALLS": "view_group_calls",
    "VIEW_OWN_CALLS": "view_own_calls",
    "MANAGE_USERS": "manage_users",
    "MANAGE_TAGS": "manage_tags",
    "VIEW_TRANSCRIPTS": "view_transcripts",
    "MANAGE_RETENTION": "manage_retention",
}


def upgrade() -> None:
    for name, value in _PERMISSION_MAP.items():
        op.execute(
            f"""
            UPDATE role_permissions
            SET permission = '{value}'
            WHERE permission = '{name}'
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp2
                WHERE rp2.role_id = role_permissions.role_id
                  AND rp2.permission = '{value}'
              )
            """
        )
        # Drop leftover uppercase duplicates when lowercase already exists.
        op.execute(
            f"""
            DELETE FROM role_permissions
            WHERE permission = '{name}'
            """
        )


def downgrade() -> None:
    for name, value in _PERMISSION_MAP.items():
        op.execute(
            f"""
            UPDATE role_permissions
            SET permission = '{name}'
            WHERE permission = '{value}'
              AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp2
                WHERE rp2.role_id = role_permissions.role_id
                  AND rp2.permission = '{name}'
              )
            """
        )
        op.execute(
            f"""
            DELETE FROM role_permissions
            WHERE permission = '{value}'
            """
        )
