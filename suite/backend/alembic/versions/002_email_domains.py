"""add email_domains to suite_tenants

Revision ID: 002
Revises: 001
Create Date: 2026-07-27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "suite_tenants",
        sa.Column(
            "email_domains",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.execute(
        """
        UPDATE suite_tenants
        SET email_domains = ARRAY[lower(split_part(admin_email, '@', 2))]
        WHERE admin_email LIKE '%@%'
        """
    )


def downgrade() -> None:
    op.drop_column("suite_tenants", "email_domains")
