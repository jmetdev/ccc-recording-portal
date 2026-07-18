import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship
from pgvector.sqlalchemy import Vector

from app.core.database import Base


class Permission(str, enum.Enum):
    VIEW_ALL_CALLS = "view_all_calls"
    VIEW_GROUP_CALLS = "view_group_calls"
    MANAGE_USERS = "manage_users"
    MANAGE_TAGS = "manage_tags"
    VIEW_TRANSCRIPTS = "view_transcripts"
    MANAGE_RETENTION = "manage_retention"


class CallStatus(str, enum.Enum):
    RECORDING = "recording"
    PROCESSING = "processing"
    TRANSCRIBING = "transcribing"
    COMPLETED = "completed"
    FAILED = "failed"


class CallSource(str, enum.Enum):
    CUCM = "cucm"
    WEBEX = "webex"


class ConnectorKind(str, enum.Enum):
    CUCM = "cucm"
    WEBEX = "webex"


class RecordingLeg(str, enum.Enum):
    NEAR = "near"
    FAR = "far"
    STEREO = "stereo"
    MIX = "mix"


class TranscriptSource(str, enum.Enum):
    WHISPER = "whisper"
    WEBEX = "webex"
    CONNECTOR = "connector"


class JobType(str, enum.Enum):
    MEDIA_CONVERT = "media_convert"
    TRANSCRIBE = "transcribe"


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # None = retain forever. Calls past retention are purged unless legal_hold.
    retention_days: Mapped[int | None] = mapped_column(Integer)
    settings_json: Mapped[dict | None] = mapped_column(JSONB)
    # Real correlation column for the Webex org that owns this tenant (replaces
    # the settings_json["webex_org_id"] convention as the source of truth).
    webex_org_id: Mapped[str | None] = mapped_column(String(128), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    users: Mapped[list["User"]] = relationship(back_populates="tenant")
    connectors: Mapped[list["ConnectorCredential"]] = relationship(back_populates="tenant")


class ConnectorCredential(Base):
    """Per-tenant credential presented by an on-prem or hosted connector.

    The plaintext token (format ``ccck_<id>_<secret>``) is returned exactly once
    at creation time; only its SHA-256 digest is stored.
    """

    __tablename__ = "connector_credentials"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[ConnectorKind] = mapped_column(
        Enum(ConnectorKind, name="connector_kind_enum", native_enum=False)
    )
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    version: Mapped[str | None] = mapped_column(String(64))
    stats_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="connectors")


class WebexServiceAuth(Base):
    """One row per tenant: the Webex org's Service App authorization + tokens.

    Tokens are Fernet-encrypted at rest (app/core/crypto.py); status flips to
    "deauthorized" when the org revokes the app in Control Hub.
    """

    __tablename__ = "webex_service_auths"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), unique=True, index=True
    )
    org_id: Mapped[str] = mapped_column(String(128), unique=True, index=True, nullable=False)
    org_name: Mapped[str | None] = mapped_column(String(255))
    app_id: Mapped[str | None] = mapped_column(String(255))
    refresh_token_encrypted: Mapped[str | None] = mapped_column(Text)
    access_token_encrypted: Mapped[str | None] = mapped_column(Text)
    access_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="authorized")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WebexConnectorInstance(Base):
    """A tenant's own isolated hosted Webex connector (own ECS service, own
    secrets under its own SSM prefix, own ALB target) — deliberately not a
    shared multi-tenant process, for credential/connection isolation."""

    __tablename__ = "webex_connector_instances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), unique=True, index=True
    )
    connector_credential_id: Mapped[int] = mapped_column(
        ForeignKey("connector_credentials.id", ondelete="CASCADE"), nullable=False
    )
    ecs_service_arn: Mapped[str | None] = mapped_column(String(512))
    alb_target_group_arn: Mapped[str | None] = mapped_column(String(512))
    alb_listener_rule_arn: Mapped[str | None] = mapped_column(String(512))
    ssm_prefix: Mapped[str] = mapped_column(String(255), nullable=False)
    webhook_url: Mapped[str | None] = mapped_column(String(512))
    status: Mapped[str] = mapped_column(String(20), default="provisioning")
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class WebexGroupRoleMapping(Base):
    """Admin-configured mapping: a Control Hub group -> an internal Role
    and/or (call-visibility) Group. Populated/consumed by services/group_sync.py."""

    __tablename__ = "webex_group_role_mappings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "webex_group_id", name="uq_webex_group_role_mappings_tenant_group"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    webex_group_id: Mapped[str] = mapped_column(String(128), nullable=False)
    webex_group_name: Mapped[str | None] = mapped_column(String(255))
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"))
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class WebexGroupSyncState(Base):
    """Bookkeeping for the periodic Control Hub group -> role sync job."""

    __tablename__ = "webex_group_sync_state"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), unique=True, index=True
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_sync_status: Mapped[str | None] = mapped_column(String(20))
    last_sync_error: Mapped[str | None] = mapped_column(Text)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    resource_type: Mapped[str | None] = mapped_column(String(32))
    resource_id: Mapped[str | None] = mapped_column(String(64))
    detail: Mapped[dict | None] = mapped_column(JSONB)
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)


user_roles = UserRole.__table__

class RecordedExtensionGroup(Base):
    __tablename__ = "recorded_extension_groups"

    extension_id: Mapped[int] = mapped_column(
        ForeignKey("recorded_extensions.id", ondelete="CASCADE"), primary_key=True
    )
    group_id: Mapped[int] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), primary_key=True)


recorded_extension_groups = RecordedExtensionGroup.__table__


class Group(Base):
    __tablename__ = "groups"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_groups_tenant_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    users: Mapped[list["User"]] = relationship(back_populates="group")
    calls: Mapped[list["Call"]] = relationship(back_populates="group")
    recorded_extensions: Mapped[list["RecordedExtension"]] = relationship(
        secondary=recorded_extension_groups, back_populates="groups"
    )


class Role(Base):
    __tablename__ = "roles"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_roles_tenant_name"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(64), nullable=False)
    description: Mapped[str | None] = mapped_column(String(256))

    users: Mapped[list["User"]] = relationship(secondary=user_roles, back_populates="roles")
    permissions: Mapped[list["RolePermission"]] = relationship(
        back_populates="role", cascade="all, delete-orphan"
    )


class RolePermission(Base):
    __tablename__ = "role_permissions"

    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)
    permission: Mapped[Permission] = mapped_column(
        Enum(Permission, name="permission_enum", native_enum=False), primary_key=True
    )

    role: Mapped["Role"] = relationship(back_populates="permissions")


class User(Base):
    __tablename__ = "users"
    __table_args__ = (UniqueConstraint("tenant_id", "username", name="uq_users_tenant_username"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    # Email stays globally unique so login-by-email can resolve the tenant.
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Platform operator: may manage tenants and connector credentials across tenants.
    is_superadmin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set when the account is provisioned/matched via an external IdP (Keycloak).
    oidc_subject: Mapped[str | None] = mapped_column(String(255), index=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="users")
    group: Mapped["Group | None"] = relationship(back_populates="users")
    roles: Mapped[list["Role"]] = relationship(secondary=user_roles, back_populates="users")


class RecordedExtension(Base):
    __tablename__ = "recorded_extensions"
    __table_args__ = (
        UniqueConstraint("tenant_id", "extension", name="uq_recorded_extensions_tenant_extension"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    extension: Mapped[str] = mapped_column(String(32), nullable=False)
    label: Mapped[str | None] = mapped_column(String(128))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    groups: Mapped[list["Group"]] = relationship(
        secondary=recorded_extension_groups, back_populates="recorded_extensions"
    )


class Call(Base):
    __tablename__ = "calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    refci: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(128))
    guid: Mapped[str | None] = mapped_column(String(128))
    # Upstream identifier for cloud sources (e.g. Webex recording id) for dedup.
    external_id: Mapped[str | None] = mapped_column(String(256), index=True)
    source: Mapped[CallSource] = mapped_column(
        Enum(CallSource, name="call_source_enum", native_enum=False),
        default=CallSource.CUCM,
        index=True,
    )
    near_addr: Mapped[str | None] = mapped_column(String(64))
    far_addr: Mapped[str | None] = mapped_column(String(64))
    near_name: Mapped[str | None] = mapped_column(String(128))
    far_name: Mapped[str | None] = mapped_column(String(128))
    direction: Mapped[str | None] = mapped_column(String(32))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_s: Mapped[float | None] = mapped_column(Float)
    status: Mapped[CallStatus] = mapped_column(
        Enum(CallStatus, name="call_status_enum", native_enum=False),
        default=CallStatus.RECORDING,
        index=True,
    )
    status_message: Mapped[str | None] = mapped_column(Text)
    # Excluded from retention sweeps while true (litigation/public-records hold).
    legal_hold: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), index=True)

    group: Mapped["Group | None"] = relationship(back_populates="calls")
    recordings: Mapped[list["Recording"]] = relationship(back_populates="call", cascade="all, delete-orphan")
    tags: Mapped[list["Tag"]] = relationship(back_populates="call", cascade="all, delete-orphan")
    transcripts: Mapped[list["Transcript"]] = relationship(back_populates="call", cascade="all, delete-orphan")


class Recording(Base):
    __tablename__ = "recordings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    call_id: Mapped[int] = mapped_column(ForeignKey("calls.id", ondelete="CASCADE"), index=True)
    leg: Mapped[RecordingLeg] = mapped_column(Enum(RecordingLeg, name="recording_leg_enum", native_enum=False))
    path_wav: Mapped[str | None] = mapped_column(String(512))
    path_m4a: Mapped[str | None] = mapped_column(String(512))
    # Storage key of connector-finished media (e.g. Webex MP3, on-prem M4A) and its
    # MIME type. When set, playback serves this and skips the legacy wav/m4a paths.
    media_path: Mapped[str | None] = mapped_column(String(512))
    media_mime: Mapped[str | None] = mapped_column(String(64))
    sample_rate: Mapped[int | None] = mapped_column(Integer)
    channels: Mapped[int | None] = mapped_column(Integer)
    bytes: Mapped[int | None] = mapped_column(Integer)
    peaks_json: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    call: Mapped["Call"] = relationship(back_populates="recordings")
    tags: Mapped[list["Tag"]] = relationship(back_populates="recording")


class Tag(Base):
    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    call_id: Mapped[int] = mapped_column(ForeignKey("calls.id", ondelete="CASCADE"), index=True)
    recording_id: Mapped[int | None] = mapped_column(ForeignKey("recordings.id", ondelete="SET NULL"))
    channel: Mapped[str] = mapped_column(String(16), default="mix")
    start_s: Mapped[float] = mapped_column(Float, nullable=False)
    end_s: Mapped[float] = mapped_column(Float, nullable=False)
    note: Mapped[str | None] = mapped_column(Text)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    call: Mapped["Call"] = relationship(back_populates="tags")
    recording: Mapped["Recording | None"] = relationship(back_populates="tags")


class Transcript(Base):
    __tablename__ = "transcripts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    call_id: Mapped[int] = mapped_column(ForeignKey("calls.id", ondelete="CASCADE"), index=True)
    leg: Mapped[RecordingLeg] = mapped_column(Enum(RecordingLeg, name="recording_leg_enum", native_enum=False))
    source: Mapped[TranscriptSource] = mapped_column(
        Enum(TranscriptSource, name="transcript_source_enum", native_enum=False),
        default=TranscriptSource.WHISPER,
    )
    language: Mapped[str | None] = mapped_column(String(16))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    segments_json: Mapped[list | None] = mapped_column(JSONB)
    sentiment: Mapped[str | None] = mapped_column(String(32), index=True)
    sentiment_score: Mapped[float | None] = mapped_column(Float)
    search_tsv = mapped_column(TSVECTOR)
    embedding = mapped_column(Vector(384), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    call: Mapped["Call"] = relationship(back_populates="transcripts")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("job_type", "payload_hash", name="uq_job_type_payload"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tenant_id: Mapped[int | None] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    job_type: Mapped[JobType] = mapped_column(Enum(JobType, name="job_type_enum", native_enum=False), index=True)
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus, name="job_status_enum", native_enum=False), default=JobStatus.PENDING, index=True
    )
    payload: Mapped[dict] = mapped_column(JSONB, nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    result: Mapped[dict | None] = mapped_column(JSONB)
    error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
