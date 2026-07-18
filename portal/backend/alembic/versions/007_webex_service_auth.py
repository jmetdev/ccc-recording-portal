"""Webex Service App authorization storage (one row per tenant/org).

Revision ID: 007
Revises: 006
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "007"
down_revision: Union[str, None] = "006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webex_service_auths",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Integer,
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column("org_id", sa.String(128), nullable=False, unique=True, index=True),
        sa.Column("org_name", sa.String(255)),
        sa.Column("app_id", sa.String(255)),
        sa.Column("refresh_token_encrypted", sa.Text),
        sa.Column("access_token_encrypted", sa.Text),
        sa.Column("access_expires_at", sa.DateTime(timezone=True)),
        sa.Column("status", sa.String(20), nullable=False, server_default="authorized"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )

    op.execute("ALTER TABLE webex_service_auths ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE webex_service_auths FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON webex_service_auths
        USING (
            NULLIF(current_setting('app.tenant_id', true), '') IS NULL
            OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON webex_service_auths")
    op.execute("ALTER TABLE webex_service_auths NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE webex_service_auths DISABLE ROW LEVEL SECURITY")
    op.drop_table("webex_service_auths")
