"""Add tenant session timeout settings.

Revision ID: 016
Revises: 015
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "016"
down_revision: Union[str, None] = "015"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("session_access_minutes", sa.Integer(), nullable=True))
    op.add_column("tenants", sa.Column("session_refresh_days", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("tenants", "session_refresh_days")
    op.drop_column("tenants", "session_access_minutes")
