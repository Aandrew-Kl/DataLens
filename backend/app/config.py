from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


# Minimum acceptable length for a JWT signing secret outside development. 32
# bytes = 256 bits, which matches the recommended key size for HS256.
JWT_SECRET_MIN_LENGTH = 32

# Known placeholder / boilerplate values that must never ship to a real
# environment. Extend this list rather than relying on length alone — a
# predictable short string like "password" is still insecure at 8 bytes.
INSECURE_JWT_SECRETS: frozenset[str] = frozenset(
    {
        "",
        "change-me",
        "changeme",
        "changeme-in-production",
        "change-me-in-production",
        "secret",
        "password",
        "jwt-secret",
        "test-only-secret",
    }
)


class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    DATABASE_URL: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/datalens"
    JWT_SECRET: str = "change-me"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24
    CORS_ORIGINS: list[str] = Field(default_factory=lambda: ["http://localhost:3000"])
    OLLAMA_URL: str = "http://localhost:11434"
    LOG_LEVEL: str = "INFO"
    APP_VERSION: str = "0.9.0-beta.0"
    UPLOADS_DIR: str = "./uploads"
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str] | tuple[str, ...] | None) -> list[str]:
        if value is None:
            return ["http://localhost:3000"]
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()] or [
                "http://localhost:3000"
            ]
        return [origin.strip() for origin in value if origin.strip()]

    @model_validator(mode="after")
    def validate_jwt_secret(self) -> "Settings":
        """Fail-fast if JWT_SECRET is missing or weak outside development.

        We accept anything in local development so contributors can run the
        app without ceremony, but every other ENVIRONMENT value (production,
        staging, test, ci, ...) must ship a real secret — generated e.g. with
        ``openssl rand -hex 32``.
        """
        is_dev = self.ENVIRONMENT.strip().lower() == "development"
        secret = (self.JWT_SECRET or "").strip()

        if is_dev:
            return self

        if secret in INSECURE_JWT_SECRETS:
            raise ValueError(
                "JWT_SECRET is missing or set to a known-insecure placeholder. "
                "Generate one with `openssl rand -hex 32` and set it in the "
                "environment before starting the app."
            )
        if len(secret) < JWT_SECRET_MIN_LENGTH:
            raise ValueError(
                f"JWT_SECRET must be at least {JWT_SECRET_MIN_LENGTH} characters "
                f"long outside development (got {len(secret)}). Generate one "
                "with `openssl rand -hex 32`."
            )
        return self


settings = Settings()


def get_settings() -> Settings:
    return settings
