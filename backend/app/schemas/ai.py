from typing import Any

from pydantic import BaseModel


class SentimentRequest(BaseModel):
    texts: list[str]


class SentimentResponse(BaseModel):
    results: list[dict[str, Any]]


class SummarizeRequest(BaseModel):
    data: list[dict[str, Any]]
    columns: list[str]


class SummarizeResponse(BaseModel):
    top_terms: list[str]
    descriptive_stats: dict[str, Any]


class QueryGenerateRequest(BaseModel):
    question: str
    schema: dict[str, list[str]]


class QueryGenerateResponse(BaseModel):
    query: str
    reasoning: list[str]
