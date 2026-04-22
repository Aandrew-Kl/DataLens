from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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
        insecure_secrets = {"change-me", "changeme-in-production", "change-me-in-production"}
        if self.ENVIRONMENT.strip().lower() != "development" and self.JWT_SECRET in insecure_secrets:
            raise ValueError("JWT_SECRET must be changed from the insecure default outside development.")
        return self


settings = Settings()


def get_settings() -> Settings:
    return settings
