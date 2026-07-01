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


class CallStatus(str, enum.Enum):
    RECORDING = "recording"
    COMPLETED = "completed"
    FAILED = "failed"


class RecordingLeg(str, enum.Enum):
    NEAR = "near"
    FAR = "far"
    STEREO = "stereo"


class JobType(str, enum.Enum):
    MEDIA_CONVERT = "media_convert"
    TRANSCRIBE = "transcribe"


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class UserRole(Base):
    __tablename__ = "user_roles"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), primary_key=True)


user_roles = UserRole.__table__

class Group(Base):
    __tablename__ = "groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    users: Mapped[list["User"]] = relationship(back_populates="group")
    calls: Mapped[list["Call"]] = relationship(back_populates="group")


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
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

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped["Group | None"] = relationship(back_populates="users")
    roles: Mapped[list["Role"]] = relationship(secondary=user_roles, back_populates="users")


class RecordedExtension(Base):
    __tablename__ = "recorded_extensions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    extension: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    label: Mapped[str | None] = mapped_column(String(128))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Call(Base):
    __tablename__ = "calls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    refci: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    session_id: Mapped[str | None] = mapped_column(String(128))
    guid: Mapped[str | None] = mapped_column(String(128))
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
    group_id: Mapped[int | None] = mapped_column(ForeignKey("groups.id"), index=True)

    group: Mapped["Group | None"] = relationship(back_populates="calls")
    recordings: Mapped[list["Recording"]] = relationship(back_populates="call", cascade="all, delete-orphan")
    tags: Mapped[list["Tag"]] = relationship(back_populates="call", cascade="all, delete-orphan")
    transcripts: Mapped[list["Transcript"]] = relationship(back_populates="call", cascade="all, delete-orphan")


class Recording(Base):
    __tablename__ = "recordings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    call_id: Mapped[int] = mapped_column(ForeignKey("calls.id", ondelete="CASCADE"), index=True)
    leg: Mapped[RecordingLeg] = mapped_column(Enum(RecordingLeg, name="recording_leg_enum", native_enum=False))
    path_wav: Mapped[str | None] = mapped_column(String(512))
    path_m4a: Mapped[str | None] = mapped_column(String(512))
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
    call_id: Mapped[int] = mapped_column(ForeignKey("calls.id", ondelete="CASCADE"), index=True)
    leg: Mapped[RecordingLeg] = mapped_column(Enum(RecordingLeg, name="recording_leg_enum", native_enum=False))
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
