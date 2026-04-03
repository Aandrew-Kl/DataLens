from typing import Any

from pydantic import BaseModel, Field


class RegressionRequest(BaseModel):
    data: list[dict[str, Any]]
    target: str
    features: list[str]
    method: str = "linear"


class RegressionResponse(BaseModel):
    r2: float
    rmse: float
    coefficients: dict[str, float]
    intercept: float


class ClusterRequest(BaseModel):
    data: list[dict[str, Any]]
    features: list[str]
    method: str = "kmeans"
    n_clusters: int = Field(default=3, ge=1)


class ClusterResponse(BaseModel):
    labels: list[int]
    centers: list[list[float]] | None
    silhouette: float | None


class ClassifyRequest(BaseModel):
    data: list[dict[str, Any]]
    target: str
    features: list[str]
    method: str = "random_forest"


class ClassifyResponse(BaseModel):
    accuracy: float
    precision: float
    recall: float
    f1: float
    confusion_matrix: list[list[int]]
    classes: list[str]


class AnomalyRequest(BaseModel):
    data: list[dict[str, Any]]
    features: list[str]
    method: str = "isolation_forest"


class AnomalyResponse(BaseModel):
    labels: list[int]
    scores: list[float]


class PCARequest(BaseModel):
    data: list[dict[str, Any]]
    features: list[str]
    n_components: int = Field(default=2, ge=1)


class PCAResponse(BaseModel):
    components: list[list[float]]
    explained_variance: list[float]
    transformed: list[list[float]]
