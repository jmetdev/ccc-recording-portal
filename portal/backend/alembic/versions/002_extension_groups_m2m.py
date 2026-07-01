"""extension groups many-to-many

Revision ID: 002
Revises: 001
Create Date: 2026-07-01
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recorded_extension_groups",
        sa.Column(
            "extension_id",
            sa.Integer(),
            sa.ForeignKey("recorded_extensions.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "group_id",
            sa.Integer(),
            sa.ForeignKey("groups.id", ondelete="CASCADE"),
            primary_key=True,
        ),
    )

    op.execute(
        """
        INSERT INTO recorded_extension_groups (extension_id, group_id)
        SELECT id, group_id FROM recorded_extensions WHERE group_id IS NOT NULL
        """
    )

    op.drop_column("recorded_extensions", "group_id")


def downgrade() -> None:
    op.add_column("recorded_extensions", sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id")))

    op.execute(
        """
        UPDATE recorded_extensions re
        SET group_id = (
            SELECT group_id FROM recorded_extension_groups reg
            WHERE reg.extension_id = re.id
            LIMIT 1
        )
        """
    )

    op.drop_table("recorded_extension_groups")
