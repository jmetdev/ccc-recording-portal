"""Docker backend columns for per-tenant Webex connector (VPS).

Revision ID: 010
Revises: 009
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "010"
down_revision: Union[str, None] = "009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("webex_connector_instances", sa.Column("container_name", sa.String(128)))
    op.alter_column("webex_connector_instances", "ssm_prefix", existing_type=sa.String(255), nullable=True)


def downgrade() -> None:
    op.alter_column("webex_connector_instances", "ssm_prefix", existing_type=sa.String(255), nullable=False)
    op.drop_column("webex_connector_instances", "container_name")
