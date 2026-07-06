"""normalize enum name casing for source columns added in 004

Revision ID: 005
Revises: 004
Create Date: 2026-07-06
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "005"
down_revision: Union[str, None] = "004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    bind.execute(sa.text("UPDATE calls SET source = 'CUCM' WHERE lower(source) = 'cucm'"))
    bind.execute(sa.text("UPDATE calls SET source = 'WEBEX' WHERE lower(source) = 'webex'"))
    bind.execute(sa.text("UPDATE transcripts SET source = 'WHISPER' WHERE lower(source) = 'whisper'"))
    bind.execute(sa.text("UPDATE transcripts SET source = 'WEBEX' WHERE lower(source) = 'webex'"))
    bind.execute(sa.text("UPDATE transcripts SET source = 'CONNECTOR' WHERE lower(source) = 'connector'"))


def downgrade() -> None:
    pass
