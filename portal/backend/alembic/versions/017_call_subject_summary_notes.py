"""Add call subject, summary, and notes columns.

Revision ID: 017
Revises: 016
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "017"
down_revision: Union[str, None] = "016"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("calls", sa.Column("subject", sa.String(length=256), nullable=True))
    op.add_column("calls", sa.Column("summary", sa.Text(), nullable=True))
    op.add_column("calls", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("calls", "notes")
    op.drop_column("calls", "summary")
    op.drop_column("calls", "subject")
