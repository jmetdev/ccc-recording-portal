from datetime import datetime
from enum import Enum

from pydantic import BaseModel, EmailStr, Field


class PermissionEnum(str, Enum):
    view_all_calls = "view_all_calls"
    view_group_calls = "view_group_calls"
    manage_users = "manage_users"
    manage_tags = "manage_tags"
    view_transcripts = "view_transcripts"


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    username: str
    is_active: bool
    group_id: int | None
    roles: list[str]
    permissions: list[str]

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    email: EmailStr
    username: str
    password: str = Field(min_length=6)
    group_id: int | None = None
    role_ids: list[int] = []
    is_active: bool = True


class UserUpdate(BaseModel):
    email: EmailStr | None = None
    username: str | None = None
    password: str | None = None
    group_id: int | None = None
    role_ids: list[int] | None = None
    is_active: bool | None = None


class GroupOut(BaseModel):
    id: int
    name: str
    created_at: datetime

    model_config = {"from_attributes": True}


class GroupCreate(BaseModel):
    name: str


class RoleOut(BaseModel):
    id: int
    name: str
    description: str | None
    permissions: list[str]

    model_config = {"from_attributes": True}


class RoleCreate(BaseModel):
    name: str
    description: str | None = None
    permissions: list[PermissionEnum] = []


class RecordedExtensionOut(BaseModel):
    id: int
    extension: str
    label: str | None
    enabled: bool
    group_ids: list[int]


class RecordedExtensionCreate(BaseModel):
    extension: str
    label: str | None = None
    enabled: bool = True
    group_ids: list[int] = []


class RecordedExtensionUpdate(BaseModel):
    extension: str | None = None
    label: str | None = None
    enabled: bool | None = None
    group_ids: list[int] | None = None


class IngestStartPayload(BaseModel):
    refci: str
    session: str | None = None
    near_addr: str | None = None
    far_addr: str | None = None
    near_name: str | None = None
    far_name: str | None = None
    guid: str | None = None
    direction: str | None = None


class IngestCompletePayload(BaseModel):
    refci: str
    files: dict[str, str]  # leg -> relative path under recordings dir
    duration_s: float | None = None


class IngestFailPayload(BaseModel):
    refci: str
    reason: str | None = None


class CallOut(BaseModel):
    id: int
    refci: str
    session_id: str | None
    guid: str | None
    near_addr: str | None
    far_addr: str | None
    near_name: str | None
    far_name: str | None
    direction: str | None
    started_at: datetime
    ended_at: datetime | None
    duration_s: float | None
    status: str
    status_message: str | None = None
    group_id: int | None
    sentiment: str | None = None

    model_config = {"from_attributes": True}


class CallListResponse(BaseModel):
    items: list[CallOut]
    total: int
    page: int
    page_size: int


class RecordingOut(BaseModel):
    id: int
    call_id: int
    leg: str
    path_wav: str | None
    path_m4a: str | None
    sample_rate: int | None
    channels: int | None
    bytes: int | None
    has_peaks: bool = False

    model_config = {"from_attributes": True}


class PeaksOut(BaseModel):
    recording_id: int
    peaks: dict


class TagCreate(BaseModel):
    call_id: int
    recording_id: int | None = None
    channel: str = "mix"
    start_s: float
    end_s: float
    note: str | None = None


class TagOut(BaseModel):
    id: int
    call_id: int
    recording_id: int | None
    channel: str
    start_s: float
    end_s: float
    note: str | None
    created_by: int | None
    created_at: datetime

    model_config = {"from_attributes": True}


class TranscriptOut(BaseModel):
    id: int
    call_id: int
    leg: str
    language: str | None
    text: str
    segments_json: list | None
    sentiment: str | None
    sentiment_score: float | None

    model_config = {"from_attributes": True}


class TranscriptSearchResult(BaseModel):
    transcript_id: int
    call_id: int
    leg: str
    headline: str
    sentiment: str | None
    rank: float


class DashboardStats(BaseModel):
    calls_today: int
    calls_total: int
    recording_now: int
    extensions_enabled: int


class LiveChannelOut(BaseModel):
    uuid: str
    refci: str | None = None
    near_addr: str | None = None
    far_addr: str | None = None
    leg: str | None = None
    dest: str | None = None
    direction: str | None = None
    cid_num: str | None = None
    cid_name: str | None = None
    application: str | None = None
    read_codec: str | None = None
    write_codec: str | None = None
    callstate: str | None = None
    created_epoch: float | None = None
    duration_s: float | None = None


class JobClaim(BaseModel):
    id: int
    job_type: str
    payload: dict


class JobComplete(BaseModel):
    result: dict | None = None
    error: str | None = None


class RecordingUpdate(BaseModel):
    path_m4a: str | None = None
    peaks_json: dict | None = None
    bytes: int | None = None
    sample_rate: int | None = None
    channels: int | None = None


class TranscriptCreate(BaseModel):
    call_id: int
    leg: str
    language: str | None = None
    text: str
    segments_json: list | None = None
    sentiment: str | None = None
    sentiment_score: float | None = None
    embedding: list[float] | None = None
