"""Add calls.trashed_at for soft-delete / trash recovery.

Revision ID: 012
Revises: 011
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "012"
down_revision: Union[str, None] = "011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("calls", sa.Column("trashed_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_calls_trashed_at", "calls", ["trashed_at"])


def downgrade() -> None:
    op.drop_index("ix_calls_trashed_at", table_name="calls")
    op.drop_column("calls", "trashed_at")
