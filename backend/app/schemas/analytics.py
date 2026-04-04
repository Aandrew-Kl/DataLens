from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ChurnPredictRequest(BaseModel):
    data: list[dict[str, Any]]
    feature_columns: list[str]
    target_column: str
    test_size: float = Field(default=0.2, gt=0, lt=1)


ChurnRequest = ChurnPredictRequest


class ChurnResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    row_count: int
    metrics: dict[str, Any]
    feature_importance: dict[str, float]
    risk_scores: list[float]


class CohortRequest(BaseModel):
    data: list[dict[str, Any]]
    entity_id_column: str
    signup_date_column: str
    activity_date_column: str
    frequency: str = "monthly"


class CohortResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    total_users: int
    cohort_count: int
    retention_rows: list[dict[str, Any]]
    summaries: list[dict[str, Any]]


class AbTestRequest(BaseModel):
    data: list[dict[str, Any]]
    group_column: str
    metric_column: str
    variant_a: str
    variant_b: str
    metric_type: str = "continuous"
    confidence_level: float = Field(default=0.95, gt=0, lt=1)


ABTestRequest = AbTestRequest


class ABTestResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    test_used: str
    p_value: float
    statistic: float
    confidence_interval: list[float]
    effect_size: float
    significant: bool
    summary: dict[str, Any]


class ForecastRequest(BaseModel):
    data: list[dict[str, Any]]
    date_col: str
    value_col: str
    periods: int = Field(default=7, ge=1)
    method: str = "holt_winters"


class ForecastResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    method: str
    history_points: int
    forecast_points: list[dict[str, Any]]
    metrics: dict[str, Any]
