from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://portal:portal@db:5432/portal"
    database_url_sync: str = "postgresql://portal:portal@db:5432/portal"
    jwt_secret: str = "change-me-jwt-secret-min-32-chars!!"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7
    # Legacy single-tenant connector auth; maps to the default tenant. New
    # deployments should use per-tenant connector credentials (ingest v2).
    ingest_token: str = "change-me-ingest-token"
    worker_token: str = "change-me-worker-token"
    recordings_dir: str = "/recordings"
    freeswitch_fs_cli: str = ""
    # Empty = auto-detect via whisper container at startup; true/false to override.
    transcription_enabled: str = ""
    whisper_container_name: str = "portal-whisper"
    system_containers: str = (
        "portal-backend,portal-db,portal-frontend,portal-media-handler,portal-whisper,freeswitch"
    )
    cors_origins: str = "http://localhost:3000"
    admin_email: str = "admin@localhost"
    admin_password: str = "admin123"

    # Tenancy
    default_tenant_slug: str = "default"

    # Media storage: "local" streams from recordings_dir; "s3" stores connector
    # uploads in the bucket and serves playback via presigned URLs.
    storage_backend: str = "local"
    s3_bucket: str = ""
    s3_prefix: str = ""
    s3_region: str = ""
    s3_endpoint_url: str = ""
    s3_presign_expire_s: int = 900

    # OIDC / Keycloak SSO. When enabled, bearer tokens from the issuer are
    # accepted alongside locally issued JWTs.
    oidc_enabled: bool = False
    oidc_issuer: str = ""
    oidc_client_id: str = "ccc-portal"
    oidc_audience: str = ""
    oidc_tenant_claim: str = "tenant"
    oidc_auto_provision: bool = True

    # Retention sweep cadence; 0 disables the background task.
    retention_sweep_interval_s: int = 3600

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def system_container_list(self) -> list[str]:
        return [c.strip() for c in self.system_containers.split(",") if c.strip()]


settings = Settings()
