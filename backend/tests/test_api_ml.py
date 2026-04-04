from __future__ import annotations

import pytest
from httpx import AsyncClient


pytestmark = pytest.mark.asyncio


async def test_ml_regression_endpoint_returns_metrics_and_coefficients(
    client: AsyncClient,
    regression_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ml/regression",
        json={
            "data": regression_data,
            "feature_columns": ["feature_a", "feature_b"],
            "target_column": "target",
            "algorithm": "linear",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "r2" in payload["metrics"]
    assert isinstance(payload["metrics"]["r2"], float)
    assert set(payload["coefficients"]) == {"feature_a", "feature_b"}


async def test_ml_cluster_endpoint_returns_labels(
    client: AsyncClient,
    cluster_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ml/cluster",
        json={
            "data": cluster_data,
            "feature_columns": ["feature_a", "feature_b"],
            "algorithm": "kmeans",
            "n_clusters": 2,
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["labels"]) == len(cluster_data)


async def test_ml_classify_endpoint_returns_accuracy(
    client: AsyncClient,
    classification_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ml/classify",
        json={
            "data": classification_data,
            "feature_columns": ["feature_a", "feature_b"],
            "target_column": "target",
            "algorithm": "random_forest",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "accuracy" in payload["metrics"]
    assert 0.0 <= payload["metrics"]["accuracy"] <= 1.0


async def test_ml_anomaly_detect_endpoint_returns_labels_and_scores(
    client: AsyncClient,
    regression_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ml/anomaly-detect",
        json={
            "data": regression_data,
            "feature_columns": ["feature_a", "feature_b", "feature_c"],
            "algorithm": "isolation_forest",
            "contamination": 0.05,
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["labels"]) == len(regression_data)
    assert len(payload["anomaly_scores"]) == len(regression_data)


async def test_ml_pca_endpoint_returns_variance_and_transformed_rows(
    client: AsyncClient,
    cluster_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ml/pca",
        json={
            "data": cluster_data,
            "feature_columns": ["feature_a", "feature_b"],
            "n_components": 2,
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["explained_variance_ratio"]) == 2
    assert len(payload["transformed_data"]) == len(cluster_data)
    assert len(payload["transformed_data"][0]) == 2


async def test_ml_decision_tree_endpoint_returns_tree_and_importance(
    client: AsyncClient,
    classification_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ml/decision-tree",
        json={
            "data": classification_data,
            "feature_columns": ["feature_a", "feature_b"],
            "target_column": "target",
            "max_depth": 3,
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tree_structure"]
    assert isinstance(payload["feature_importance"], dict)


@pytest.mark.parametrize(
    "request_body",
    [
        {
            "data": [],
            "feature_columns": ["feature_a", "feature_b"],
            "target_column": "target",
            "algorithm": "linear",
        },
        {
            "data": [{"feature_a": 1.0, "target": 2.0}],
            "feature_columns": ["feature_a", "feature_b"],
            "target_column": "target",
            "algorithm": "linear",
        },
    ],
)
async def test_ml_regression_endpoint_rejects_invalid_payloads(
    client: AsyncClient,
    request_body: dict[str, object],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post("/ml/regression", json=request_body, headers=auth_headers)

    assert response.status_code == 400
