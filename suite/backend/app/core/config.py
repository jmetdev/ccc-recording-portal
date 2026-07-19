from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://suite:suite@db:5432/suite"
    database_url_sync: str = "postgresql://suite:suite@db:5432/suite"
    # Optional discrete connection parts, mirrors portal/backend: when db_host
    # is set, the two URLs above are rebuilt from these.
    db_host: str = ""
    db_port: int = 5432
    db_name: str = "suite"
    db_user: str = ""
    db_password: str = ""

    cors_origins: str = "http://localhost:3000"

    # OIDC / Keycloak — same realm as the recording/fax portals; this service
    # only verifies tokens, it has no local user table.
    oidc_issuer: str = ""
    oidc_audience: str = ""
    oidc_org_claim: str = "webex_org_id"

    # Superadmin recognition for MVP: comma-separated allowlist of emails
    # asserted by the Webex-brokered token. Migrate to a realm role pre-prod.
    superadmin_emails: str = ""

    # Shared secret the recording/fax backends present to call the
    # service-to-service /internal endpoints.
    suite_internal_token: str = ""

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
    def superadmin_email_list(self) -> list[str]:
        return [e.strip().lower() for e in self.superadmin_emails.split(",") if e.strip()]


settings = Settings()
