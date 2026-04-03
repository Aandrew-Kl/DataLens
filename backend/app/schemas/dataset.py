import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class DatasetUpload(BaseModel):
    name: str | None = None


class DatasetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    name: str
    file_path: str
    row_count: int
    column_count: int
    created_at: datetime


class ColumnInfo(BaseModel):
    name: str
    dtype: str
    nullable: bool
    sample_values: list[Any]
