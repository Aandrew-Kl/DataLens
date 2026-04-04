import pytest
from pydantic import ValidationError

from app.config import Settings


def test_settings_reject_default_jwt_secret_outside_development() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET must be changed"):
        Settings(_env_file=None, ENVIRONMENT="production", JWT_SECRET="change-me")

    with pytest.raises(ValidationError, match="JWT_SECRET must be changed"):
        Settings(_env_file=None, ENVIRONMENT="staging", JWT_SECRET="changeme-in-production")


def test_settings_allow_default_jwt_secret_in_development() -> None:
    configured = Settings(_env_file=None, ENVIRONMENT="development", JWT_SECRET="change-me")

    assert configured.JWT_SECRET == "change-me"
