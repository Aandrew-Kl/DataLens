from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class NLQueryRequest(BaseModel):
    question: str
    use_ollama: bool = False
    table_name: str = ""
    data: list[dict[str, Any]] = []
    schema_info: dict[str, list[str]] = {}


class SentimentRequest(BaseModel):
    data: list[dict[str, Any]]
    text_column: str = ""
    limit: Optional[int] = None


class SentimentResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    text_column: str
    row_count: int
    aggregate: dict[str, Any]
    rows: list[dict[str, Any]]
    top_terms: list[dict[str, Any]]


class SummarizeRequest(BaseModel):
    data: list[dict[str, Any]]
    dataset_id: int = 0
    text_columns: list[str] = []
    max_terms: int = 20


class SummarizeResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    dataset_id: int
    summary_text: str
    key_statistics: dict[str, Any]
    top_terms: list[dict[str, Any]]


class QueryGenerateRequest(BaseModel):
    question: str
    schema: dict[str, list[str]] = Field(default_factory=dict)
    table_name: str = ""
    data: list[dict[str, Any]] = []
    use_ollama: bool = False


class QueryGenerateResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    sql: str
    explanation: str


class ExplainRequest(BaseModel):
    sql: str


class ExplainResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    summary: str
    steps: list[str]
    tables: list[str]
    columns: list[str]
