import pytest
from pydantic import ValidationError

from app.config import JWT_SECRET_MIN_LENGTH, Settings


def test_settings_reject_default_jwt_secret_outside_development() -> None:
    with pytest.raises(ValidationError, match="known-insecure placeholder"):
        Settings(_env_file=None, ENVIRONMENT="production", JWT_SECRET="change-me")

    with pytest.raises(ValidationError, match="known-insecure placeholder"):
        Settings(_env_file=None, ENVIRONMENT="staging", JWT_SECRET="changeme-in-production")


def test_settings_allow_default_jwt_secret_in_development() -> None:
    configured = Settings(_env_file=None, ENVIRONMENT="development", JWT_SECRET="change-me")

    assert configured.JWT_SECRET == "change-me"


def test_settings_reject_empty_jwt_secret_outside_development() -> None:
    with pytest.raises(ValidationError, match="known-insecure placeholder"):
        Settings(_env_file=None, ENVIRONMENT="production", JWT_SECRET="")

    with pytest.raises(ValidationError, match="known-insecure placeholder"):
        Settings(_env_file=None, ENVIRONMENT="production", JWT_SECRET="   ")


def test_settings_reject_short_jwt_secret_outside_development() -> None:
    # 20 chars, not in the insecure list, but too short for HS256.
    short_secret = "a1b2c3d4e5f6g7h8i9j0"
    assert len(short_secret) < JWT_SECRET_MIN_LENGTH

    with pytest.raises(ValidationError, match="at least 32 characters"):
        Settings(_env_file=None, ENVIRONMENT="production", JWT_SECRET=short_secret)


def test_settings_accept_strong_jwt_secret_outside_development() -> None:
    # 64 hex chars — what `openssl rand -hex 32` produces.
    strong_secret = "7c9a4f1b3e2d8a6f4c9b2e7a5d1f3b8c6e9a4d2f1b7c3e8a9d4f2b6c1e3a7d9f"
    configured = Settings(
        _env_file=None, ENVIRONMENT="production", JWT_SECRET=strong_secret
    )

    assert configured.JWT_SECRET == strong_secret


def test_settings_allow_weak_secrets_in_development() -> None:
    # Empty secrets are acceptable locally so contributors don't trip on the
    # first run. The production guard is where it matters.
    configured = Settings(_env_file=None, ENVIRONMENT="development", JWT_SECRET="")
    assert configured.JWT_SECRET == ""
