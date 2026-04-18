"""Bookmark API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class BookmarkCreate(BaseModel):
    id: str | None = Field(default=None, min_length=1, max_length=255)
    dataset_id: uuid.UUID | None = None
    table_name: str | None = Field(default=None, max_length=255)
    label: str = Field(min_length=1, max_length=255)
    description: str | None = None
    column_name: str | None = Field(default=None, max_length=255)
    sql_text: str | None = None
    view_state: dict[str, Any] | None = None


class BookmarkRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: uuid.UUID
    dataset_id: uuid.UUID | None
    table_name: str | None
    label: str
    description: str | None
    column_name: str | None
    sql_text: str | None
    view_state: dict[str, Any] | None
    created_at: datetime
    updated_at: datetime
