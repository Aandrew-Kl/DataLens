import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator


class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8)

    @field_validator("password")
    @classmethod
    def validate_password_complexity(cls, value: str) -> str:
        missing_requirements: list[str] = []

        if not any(char.isupper() for char in value):
            missing_requirements.append("at least one uppercase letter")
        if not any(char.islower() for char in value):
            missing_requirements.append("at least one lowercase letter")
        if not any(char.isdigit() for char in value):
            missing_requirements.append("at least one digit")

        if missing_requirements:
            if len(missing_requirements) == 1:
                requirements = missing_requirements[0]
            else:
                requirements = ", ".join(missing_requirements[:-1]) + f", and {missing_requirements[-1]}"
            raise ValueError(f"Password must contain {requirements}.")

        return value


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    email: str
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
