from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://portal:portal@db:5432/portal"
    database_url_sync: str = "postgresql://portal:portal@db:5432/portal"
    # Optional discrete connection parts. When db_host is set (e.g. injected
    # from a Secrets Manager secret on ECS), the two URLs above are rebuilt from
    # these — so infra never has to compose a full URL string.
    db_host: str = ""
    db_port: int = 5432
    db_name: str = "portal"
    db_user: str = ""
    db_password: str = ""
    # "default" keeps a normal connection pool; "nullpool" opens a fresh
    # connection per checkout so an idle app holds nothing open — required for
    # Aurora Serverless v2 to scale to zero (auto-pause).
    db_pool_mode: str = "default"
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
    # Transcripts are delivered by connectors (Webex VTT, on-prem CUCM whisper),
    # not a portal-managed worker; this only gates the legacy in-portal
    # whisper-worker job queue, which is off unless explicitly enabled.
    transcription_enabled: str = "false"
    whisper_container_name: str = "portal-whisper"
    system_containers: str = "portal-backend,portal-db,portal-frontend,portal-media-handler,freeswitch"
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

    # ---- OAuth login providers (Webex / Zoom) ----
    # Users authenticate through the same platform that runs their calling
    # (Webex Control Hub / Zoom). Server-side authorization-code flow: exchange
    # the code, then read identity from the provider's /me endpoint. A provider
    # is "enabled" once its client id + secret are set to real values.
    # Public origin of the portal, used to build OAuth redirect URIs
    # (e.g. https://dev.cloudcorecollab.com). Falls back to the request origin.
    public_base_url: str = ""
    webex_client_id: str = ""
    webex_client_secret: str = ""
    webex_scopes: str = "spark:people_read"
    zoom_client_id: str = ""
    zoom_client_secret: str = ""
    zoom_scopes: str = "user:read"

    # Retention sweep cadence; 0 disables the background task.
    retention_sweep_interval_s: int = 3600

    @model_validator(mode="after")
    def _assemble_db_urls(self) -> "Settings":
        if self.db_host and self.db_user:
            from urllib.parse import quote

            loc = (
                f"{quote(self.db_user, safe='')}:{quote(self.db_password, safe='')}"
                f"@{self.db_host}:{self.db_port}/{self.db_name}"
            )
            self.database_url = f"postgresql+asyncpg://{loc}"
            self.database_url_sync = f"postgresql://{loc}"
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def system_container_list(self) -> list[str]:
        return [c.strip() for c in self.system_containers.split(",") if c.strip()]


settings = Settings()
