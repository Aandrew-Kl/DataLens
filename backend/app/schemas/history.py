"""Query history API schemas."""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class QueryHistoryCreate(BaseModel):
    dataset_id: uuid.UUID
    question: str | None = None
    sql_text: str = Field(min_length=1)
    duration_ms: int = Field(default=0, ge=0)


class QueryHistoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: uuid.UUID
    dataset_id: uuid.UUID
    question: str | None
    sql_text: str
    duration_ms: int
    created_at: datetime
