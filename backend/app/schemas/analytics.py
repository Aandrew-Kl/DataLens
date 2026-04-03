from typing import Any

from pydantic import BaseModel, Field


class ChurnRequest(BaseModel):
    data: list[dict[str, Any]]
    features: list[str]


class ChurnResponse(BaseModel):
    risk_scores: list[float]
    feature_importance: dict[str, float]


class CohortRequest(BaseModel):
    data: list[dict[str, Any]]
    date_col: str
    user_col: str


class CohortResponse(BaseModel):
    retention: dict[str, dict[str, float]]


class ABTestRequest(BaseModel):
    control: list[float]
    treatment: list[float]
    alpha: float = Field(default=0.05, gt=0, lt=1)


class ABTestResponse(BaseModel):
    p_value: float
    confidence_interval: list[float]
    effect_size: float
    control_mean: float
    treatment_mean: float
    significant: bool


class ForecastRequest(BaseModel):
    data: list[dict[str, Any]]
    date_col: str
    value_col: str
    periods: int = Field(default=7, ge=1)


class ForecastResponse(BaseModel):
    predictions: list[dict[str, Any]]
