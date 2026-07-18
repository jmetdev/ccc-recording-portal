"""Add tenants.webex_org_id as a real, indexed correlation column.

Tenant<->Webex-org correlation previously lived only in settings_json (JSONB,
no constraint, no index), read ad hoc by core/oauth.py:_tenant_for(). This adds
a first-class column and backfills it from the existing JSONB convention.
settings_json["webex_org_id"] is left in place as a dual-write for now rather
than dropped immediately.

Revision ID: 006
Revises: 005
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "006"
down_revision: Union[str, None] = "005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("webex_org_id", sa.String(128), nullable=True))
    op.create_index("ix_tenants_webex_org_id", "tenants", ["webex_org_id"], unique=True)
    op.execute(
        """
        UPDATE tenants
        SET webex_org_id = settings_json->>'webex_org_id'
        WHERE settings_json ? 'webex_org_id'
        """
    )


def downgrade() -> None:
    op.drop_index("ix_tenants_webex_org_id", table_name="tenants")
    op.drop_column("tenants", "webex_org_id")
