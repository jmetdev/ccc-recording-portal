"""multi-tenancy: tenants, connector credentials, audit log, RLS

Revision ID: 004
Revises: 003
Create Date: 2026-07-06
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "004"
down_revision: Union[str, None] = "003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Tables that carry a NOT NULL tenant_id and get an RLS policy.
TENANT_TABLES = [
    "users",
    "groups",
    "roles",
    "recorded_extensions",
    "calls",
    "recordings",
    "tags",
    "transcripts",
]


def upgrade() -> None:
    op.create_table(
        "tenants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("retention_days", sa.Integer()),
        sa.Column("settings_json", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    bind = op.get_bind()
    default_tenant_id = bind.execute(
        sa.text(
            "INSERT INTO tenants (slug, name, is_active) "
            "VALUES ('default', 'Default Tenant', true) RETURNING id"
        )
    ).scalar_one()

    op.create_table(
        "connector_credentials",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("version", sa.String(64)),
        sa.Column("stats_json", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_connector_credentials_tenant_id", "connector_credentials", ["tenant_id"])

    op.create_table(
        "audit_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "tenant_id", sa.Integer(), sa.ForeignKey("tenants.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="SET NULL")),
        sa.Column("action", sa.String(64), nullable=False),
        sa.Column("resource_type", sa.String(32)),
        sa.Column("resource_id", sa.String(64)),
        sa.Column("detail", postgresql.JSONB()),
        sa.Column("ip", sa.String(64)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_audit_logs_tenant_id", "audit_logs", ["tenant_id"])
    op.create_index("ix_audit_logs_action", "audit_logs", ["action"])
    op.create_index("ix_audit_logs_created_at", "audit_logs", ["created_at"])

    # tenant_id on every tenant-scoped table: add nullable, backfill, tighten.
    for table in TENANT_TABLES:
        op.add_column(table, sa.Column("tenant_id", sa.Integer(), nullable=True))
        bind.execute(sa.text(f"UPDATE {table} SET tenant_id = :tid"), {"tid": default_tenant_id})
        op.alter_column(table, "tenant_id", nullable=False)
        op.create_foreign_key(
            f"fk_{table}_tenant_id", table, "tenants", ["tenant_id"], ["id"], ondelete="CASCADE"
        )
        op.create_index(f"ix_{table}_tenant_id", table, ["tenant_id"])

    # Jobs are claimed by system workers; tenant_id is informational only.
    op.add_column("jobs", sa.Column("tenant_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_jobs_tenant_id", "jobs", "tenants", ["tenant_id"], ["id"], ondelete="CASCADE")
    op.create_index("ix_jobs_tenant_id", "jobs", ["tenant_id"])

    # Global uniques become per-tenant uniques. Email stays globally unique so
    # login-by-email can resolve the tenant.
    op.drop_constraint("users_username_key", "users", type_="unique")
    op.create_unique_constraint("uq_users_tenant_username", "users", ["tenant_id", "username"])
    op.drop_constraint("groups_name_key", "groups", type_="unique")
    op.create_unique_constraint("uq_groups_tenant_name", "groups", ["tenant_id", "name"])
    op.drop_constraint("roles_name_key", "roles", type_="unique")
    op.create_unique_constraint("uq_roles_tenant_name", "roles", ["tenant_id", "name"])
    op.drop_constraint("recorded_extensions_extension_key", "recorded_extensions", type_="unique")
    op.create_unique_constraint(
        "uq_recorded_extensions_tenant_extension", "recorded_extensions", ["tenant_id", "extension"]
    )

    # Cloud-source and records-management columns.
    op.add_column("calls", sa.Column("external_id", sa.String(256)))
    op.create_index("ix_calls_external_id", "calls", ["external_id"])
    op.add_column("calls", sa.Column("source", sa.String(16), nullable=False, server_default="CUCM"))
    op.create_index("ix_calls_source", "calls", ["source"])
    op.add_column("calls", sa.Column("legal_hold", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.create_index("ix_calls_legal_hold", "calls", ["legal_hold"])

    op.add_column("recordings", sa.Column("media_path", sa.String(512)))
    op.add_column("recordings", sa.Column("media_mime", sa.String(64)))

    op.add_column(
        "transcripts", sa.Column("source", sa.String(16), nullable=False, server_default="WHISPER")
    )

    op.add_column("users", sa.Column("is_superadmin", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("users", sa.Column("oidc_subject", sa.String(255)))
    op.create_index("ix_users_oidc_subject", "users", ["oidc_subject"])

    # Row-level security as defense-in-depth. The request layer sets
    # app.tenant_id (transaction-local); when it is unset the connection is in
    # system context (bootstrap, migrations, media workers) and sees all rows.
    # Application queries additionally filter by tenant_id explicitly.
    for table in TENANT_TABLES + ["connector_credentials", "audit_logs"]:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY tenant_isolation ON {table}
            USING (
                NULLIF(current_setting('app.tenant_id', true), '') IS NULL
                OR tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::int
            )
            """
        )


def downgrade() -> None:
    for table in TENANT_TABLES + ["connector_credentials", "audit_logs"]:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")

    op.drop_index("ix_users_oidc_subject", "users")
    op.drop_column("users", "oidc_subject")
    op.drop_column("users", "is_superadmin")
    op.drop_column("transcripts", "source")
    op.drop_column("recordings", "media_mime")
    op.drop_column("recordings", "media_path")
    op.drop_index("ix_calls_legal_hold", "calls")
    op.drop_column("calls", "legal_hold")
    op.drop_index("ix_calls_source", "calls")
    op.drop_column("calls", "source")
    op.drop_index("ix_calls_external_id", "calls")
    op.drop_column("calls", "external_id")

    op.drop_constraint("uq_recorded_extensions_tenant_extension", "recorded_extensions", type_="unique")
    op.create_unique_constraint("recorded_extensions_extension_key", "recorded_extensions", ["extension"])
    op.drop_constraint("uq_roles_tenant_name", "roles", type_="unique")
    op.create_unique_constraint("roles_name_key", "roles", ["name"])
    op.drop_constraint("uq_groups_tenant_name", "groups", type_="unique")
    op.create_unique_constraint("groups_name_key", "groups", ["name"])
    op.drop_constraint("uq_users_tenant_username", "users", type_="unique")
    op.create_unique_constraint("users_username_key", "users", ["username"])

    op.drop_index("ix_jobs_tenant_id", "jobs")
    op.drop_constraint("fk_jobs_tenant_id", "jobs", type_="foreignkey")
    op.drop_column("jobs", "tenant_id")

    for table in reversed(TENANT_TABLES):
        op.drop_index(f"ix_{table}_tenant_id", table)
        op.drop_constraint(f"fk_{table}_tenant_id", table, type_="foreignkey")
        op.drop_column(table, "tenant_id")

    op.drop_table("audit_logs")
    op.drop_index("ix_connector_credentials_tenant_id", "connector_credentials")
    op.drop_table("connector_credentials")
    op.drop_table("tenants")
