from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://portal:portal@db:5432/portal"
    database_url_sync: str = "postgresql://portal:portal@db:5432/portal"
    jwt_secret: str = "change-me-jwt-secret-min-32-chars!!"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 7
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

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def system_container_list(self) -> list[str]:
        return [c.strip() for c in self.system_containers.split(",") if c.strip()]


settings = Settings()
