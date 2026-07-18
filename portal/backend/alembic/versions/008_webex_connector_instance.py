"""Per-tenant isolated Webex connector instances (own ECS service, own secrets).

Revision ID: 008
Revises: 007
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "008"
down_revision: Union[str, None] = "007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "webex_connector_instances",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Integer,
            sa.ForeignKey("tenants.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
            index=True,
        ),
        sa.Column(
            "connector_credential_id",
            sa.Integer,
            sa.ForeignKey("connector_credentials.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ecs_service_arn", sa.String(512)),
        sa.Column("alb_target_group_arn", sa.String(512)),
        sa.Column("alb_listener_rule_arn", sa.String(512)),
        sa.Column("ssm_prefix", sa.String(255), nullable=False),
        sa.Column("webhook_url", sa.String(512)),
        sa.Column("status", sa.String(20), nullable=False, server_default="provisioning"),
        sa.Column("error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
    )

    op.execute("ALTER TABLE webex_connector_instances ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE webex_connector_instances FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY tenant_isolation ON webex_connector_instances
        USING (
            NULLIF(current_setting('app.tenant_id', true), '') IS NULL
            OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int
        )
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_isolation ON webex_connector_instances")
    op.execute("ALTER TABLE webex_connector_instances NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE webex_connector_instances DISABLE ROW LEVEL SECURITY")
    op.drop_table("webex_connector_instances")
