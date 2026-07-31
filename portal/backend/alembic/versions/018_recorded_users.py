"""Migration 018: email-based recorded users for WXC (Webex Cloud) ingest."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "018"
down_revision: Union[str, None] = "017"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recorded_users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("email", sa.String(255), nullable=False),
        sa.Column("label", sa.String(128)),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("tenant_id", "email", name="uq_recorded_users_tenant_email"),
    )

    op.create_table(
        "recorded_user_groups",
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("recorded_users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "group_id",
            sa.Integer(),
            sa.ForeignKey("groups.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    for table in ("recorded_users", "recorded_user_groups"):
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
            if table == "recorded_users"
            else f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (
                NULLIF(current_setting('app.tenant_id', true), '') IS NULL
                OR user_id IN (
                    SELECT id FROM recorded_users
                    WHERE tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int
                )
            )
            """
        )


def downgrade() -> None:
    for table in ("recorded_user_groups", "recorded_users"):
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
    op.drop_table("recorded_user_groups")
    op.drop_table("recorded_users")
