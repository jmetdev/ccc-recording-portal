"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-07-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "suite_tenants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("webex_org_id", sa.String(128), unique=True),
        sa.Column("status", sa.String(16), nullable=False, server_default="pending"),
        sa.Column("admin_email", sa.String(255), nullable=False),
        sa.Column("linked_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_suite_tenants_webex_org_id", "suite_tenants", ["webex_org_id"])

    op.create_table(
        "entitlements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tenant_id",
            sa.Integer(),
            sa.ForeignKey("suite_tenants.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("app", sa.String(16), nullable=False),
        sa.Column("licensed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("plan_name", sa.String(64)),
        sa.Column("limits_json", postgresql.JSONB()),
        sa.UniqueConstraint("tenant_id", "app", name="uq_entitlement_tenant_app"),
    )


def downgrade() -> None:
    op.drop_table("entitlements")
    op.drop_table("suite_tenants")
