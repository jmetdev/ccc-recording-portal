"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-06-30
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "groups",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(128), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "roles",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(64), nullable=False, unique=True),
        sa.Column("description", sa.String(256)),
    )

    op.create_table(
        "role_permissions",
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("permission", sa.String(32), primary_key=True),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("username", sa.String(64), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "user_roles",
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("role_id", sa.Integer(), sa.ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True),
    )

    op.create_table(
        "recorded_extensions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("extension", sa.String(32), nullable=False, unique=True),
        sa.Column("label", sa.String(128)),
        sa.Column("enabled", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )

    op.create_table(
        "calls",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("refci", sa.String(128), nullable=False),
        sa.Column("session_id", sa.String(128)),
        sa.Column("guid", sa.String(128)),
        sa.Column("near_addr", sa.String(64)),
        sa.Column("far_addr", sa.String(64)),
        sa.Column("near_name", sa.String(128)),
        sa.Column("far_name", sa.String(128)),
        sa.Column("direction", sa.String(32)),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("duration_s", sa.Float()),
        sa.Column("status", sa.String(32), server_default="recording"),
        sa.Column("group_id", sa.Integer(), sa.ForeignKey("groups.id")),
    )
    op.create_index("ix_calls_refci", "calls", ["refci"])
    op.create_index("ix_calls_status", "calls", ["status"])
    op.create_index("ix_calls_group_id", "calls", ["group_id"])

    op.create_table(
        "recordings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("call_id", sa.Integer(), sa.ForeignKey("calls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("leg", sa.String(16), nullable=False),
        sa.Column("path_wav", sa.String(512)),
        sa.Column("path_m4a", sa.String(512)),
        sa.Column("sample_rate", sa.Integer()),
        sa.Column("channels", sa.Integer()),
        sa.Column("bytes", sa.Integer()),
        sa.Column("peaks_json", postgresql.JSONB()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_recordings_call_id", "recordings", ["call_id"])

    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("call_id", sa.Integer(), sa.ForeignKey("calls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recording_id", sa.Integer(), sa.ForeignKey("recordings.id", ondelete="SET NULL")),
        sa.Column("channel", sa.String(16), server_default="mix"),
        sa.Column("start_s", sa.Float(), nullable=False),
        sa.Column("end_s", sa.Float(), nullable=False),
        sa.Column("note", sa.Text()),
        sa.Column("created_by", sa.Integer(), sa.ForeignKey("users.id")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_tags_call_id", "tags", ["call_id"])

    op.create_table(
        "transcripts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("call_id", sa.Integer(), sa.ForeignKey("calls.id", ondelete="CASCADE"), nullable=False),
        sa.Column("leg", sa.String(16), nullable=False),
        sa.Column("language", sa.String(16)),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("segments_json", postgresql.JSONB()),
        sa.Column("sentiment", sa.String(32)),
        sa.Column("sentiment_score", sa.Float()),
        sa.Column("search_tsv", postgresql.TSVECTOR()),
        sa.Column("embedding", Vector(384)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.create_index("ix_transcripts_call_id", "transcripts", ["call_id"])
    op.create_index("ix_transcripts_sentiment", "transcripts", ["sentiment"])
    op.execute("CREATE INDEX ix_transcripts_search_tsv ON transcripts USING GIN (search_tsv)")

    op.create_table(
        "jobs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("job_type", sa.String(32), nullable=False),
        sa.Column("status", sa.String(32), server_default="pending"),
        sa.Column("payload", postgresql.JSONB(), nullable=False),
        sa.Column("payload_hash", sa.String(64), nullable=False),
        sa.Column("result", postgresql.JSONB()),
        sa.Column("error", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.UniqueConstraint("job_type", "payload_hash", name="uq_job_type_payload"),
    )
    op.create_index("ix_jobs_job_type", "jobs", ["job_type"])
    op.create_index("ix_jobs_status", "jobs", ["status"])


def downgrade() -> None:
    op.drop_table("jobs")
    op.drop_table("transcripts")
    op.drop_table("tags")
    op.drop_table("recordings")
    op.drop_table("calls")
    op.drop_table("recorded_extensions")
    op.drop_table("user_roles")
    op.drop_table("users")
    op.drop_table("role_permissions")
    op.drop_table("roles")
    op.drop_table("groups")
