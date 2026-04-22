"""Pipeline API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class PipelineCreate(BaseModel):
    id: str | None = Field(default=None, min_length=1, max_length=255)
    name: str = Field(min_length=1, max_length=255)
    steps: list[dict[str, Any]] = Field(default_factory=list)


class PipelineUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    steps: list[dict[str, Any]] = Field(default_factory=list)


class PipelineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: uuid.UUID
    name: str
    steps: list[dict[str, Any]]
    created_at: datetime
    updated_at: datetime
