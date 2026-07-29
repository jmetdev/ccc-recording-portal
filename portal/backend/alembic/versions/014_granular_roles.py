"""Granular viewer roles + user extension for self_viewer.

Revision ID: 014
Revises: 013
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "014"
down_revision: Union[str, None] = "013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_NEW_ROLES: dict[str, tuple[str, list[str]]] = {
    "manager": (
        "View all team recordings",
        ["view_all_calls", "manage_tags", "view_transcripts"],
    ),
    "self_viewer": (
        "View own recordings only",
        ["view_own_calls", "manage_tags", "view_transcripts"],
    ),
}


def upgrade() -> None:
    op.add_column("users", sa.Column("extension", sa.String(length=64), nullable=True))

    op.execute(
        """
        UPDATE roles
        SET name = 'team_viewer', description = 'View calls in assigned teams'
        WHERE name = 'viewer'
        """
    )

    conn = op.get_bind()
    tenants = conn.execute(sa.text("SELECT id FROM tenants")).fetchall()
    for (tenant_id,) in tenants:
        for role_name, (description, perms) in _NEW_ROLES.items():
            existing = conn.execute(
                sa.text("SELECT id FROM roles WHERE tenant_id = :tid AND name = :name"),
                {"tid": tenant_id, "name": role_name},
            ).fetchone()
            if existing:
                continue
            role_id = conn.execute(
                sa.text(
                    "INSERT INTO roles (tenant_id, name, description) "
                    "VALUES (:tid, :name, :desc) RETURNING id"
                ),
                {"tid": tenant_id, "name": role_name, "desc": description},
            ).scalar_one()
            for perm in perms:
                conn.execute(
                    sa.text(
                        "INSERT INTO role_permissions (role_id, permission) "
                        "VALUES (:rid, :perm) ON CONFLICT DO NOTHING"
                    ),
                    {"rid": role_id, "perm": perm},
                )


def downgrade() -> None:
    op.execute(
        """
        UPDATE roles
        SET name = 'viewer', description = 'Group-scoped call viewer'
        WHERE name = 'team_viewer'
        """
    )
    op.execute("DELETE FROM role_permissions WHERE permission = 'view_own_calls'")
    op.execute("DELETE FROM roles WHERE name IN ('manager', 'self_viewer')")
    op.drop_column("users", "extension")
