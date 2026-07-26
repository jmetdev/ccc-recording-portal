"""Add calls.holding for unconfigured extension pool.

Revision ID: 011
Revises: 010
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "011"
down_revision: Union[str, None] = "010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "calls",
        sa.Column("holding", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index("ix_calls_holding", "calls", ["holding"])


def downgrade() -> None:
    op.drop_index("ix_calls_holding", table_name="calls")
    op.drop_column("calls", "holding")
