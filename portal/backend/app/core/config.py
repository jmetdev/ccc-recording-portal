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
    cors_origins: str = "http://localhost:3000"
    admin_email: str = "admin@localhost"
    admin_password: str = "admin123"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
