from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class RegressionRequest(BaseModel):
    data: list[dict[str, Any]] = Field(max_length=50000)
    feature_columns: list[str] = Field(max_length=100)
    target_column: str
    algorithm: str = "linear"
    cv_folds: int = Field(default=5, ge=2)
    test_size: float = Field(default=0.2, gt=0, lt=1)
    alpha: float = Field(default=1.0, gt=0)


class RegressionResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    algorithm: str
    row_count: int
    metrics: dict[str, Any]
    coefficients: dict[str, float]
    intercept: float


class ClusterRequest(BaseModel):
    data: list[dict[str, Any]] = Field(max_length=50000)
    feature_columns: list[str] = Field(max_length=100)
    algorithm: str = "kmeans"
    n_clusters: int = Field(default=3, ge=1)
    eps: float = Field(default=0.5, gt=0)
    min_samples: int = Field(default=5, ge=1)
    linkage: str = "ward"


class ClusterResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    algorithm: str
    row_count: int
    labels: list[int]
    silhouette_score: Optional[float]


class ClassificationRequest(BaseModel):
    data: list[dict[str, Any]] = Field(max_length=50000)
    feature_columns: list[str] = Field(max_length=100)
    target_column: str
    algorithm: str = "random_forest"
    test_size: float = Field(default=0.2, gt=0, lt=1)


ClassifyRequest = ClassificationRequest


class ClassifyResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    algorithm: str
    row_count: int
    class_labels: list[str]
    metrics: dict[str, Any]


class AnomalyRequest(BaseModel):
    data: list[dict[str, Any]] = Field(max_length=50000)
    feature_columns: list[str] = Field(max_length=100)
    algorithm: str = "isolation_forest"
    contamination: float = Field(default=0.1, gt=0, lt=0.5)
    n_neighbors: int = Field(default=20, ge=1)


class AnomalyResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    algorithm: str
    row_count: int
    labels: list[int]
    anomaly_scores: list[float]
    anomaly_count: int


class PCARequest(BaseModel):
    data: list[dict[str, Any]] = Field(max_length=50000)
    feature_columns: list[str] = Field(max_length=100)
    n_components: Optional[int] = Field(default=2, ge=1)


class PCAResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    row_count: int
    explained_variance_ratio: list[float]
    loadings: list[dict[str, Any]]
    transformed_data: list[list[float]]


class DecisionTreeRequest(BaseModel):
    data: list[dict[str, Any]] = Field(max_length=50000)
    feature_columns: list[str] = Field(max_length=100)
    target_column: str
    max_depth: Optional[int] = None
    test_size: float = Field(default=0.2, gt=0, lt=1)


class DecisionTreeResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    row_count: int
    feature_importance: dict[str, float]
    tree_structure: str
    metrics: dict[str, Any]
    class_labels: list[str]
