"""Control Hub group -> internal role/group mapping + periodic sync bookkeeping.

Revision ID: 009
Revises: 008
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "009"
down_revision: Union[str, None] = "008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webex_group_role_mappings",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "tenant_id", sa.Integer, sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False, index=True
        ),
        sa.Column("webex_group_id", sa.String(128), nullable=False),
        sa.Column("webex_group_name", sa.String(255)),
        sa.Column("role_id", sa.Integer, sa.ForeignKey("roles.id", ondelete="CASCADE"), nullable=True),
        sa.Column("group_id", sa.Integer, sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "webex_group_id", name="uq_webex_group_role_mappings_tenant_group"),
    )

    op.create_table(
        "webex_group_sync_state",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Integer,
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        sa.Column("last_sync_status", sa.String(20)),
        sa.Column("last_sync_error", sa.Text),
    )

    for table in ("webex_group_role_mappings", "webex_group_sync_state"):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (
                NULLIF(current_setting('app.tenant_id', true), '') IS NULL
                OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int
            )
            """
        )


def downgrade() -> None:
    for table in ("webex_group_role_mappings", "webex_group_sync_state"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_table("webex_group_sync_state")
    op.drop_table("webex_group_role_mappings")
