from __future__ import annotations

import pytest
from httpx import AsyncClient


pytestmark = pytest.mark.asyncio


async def test_analytics_churn_predict_endpoint_returns_scores_and_importance(
    client: AsyncClient,
    classification_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/analytics/churn-predict",
        json={
            "data": classification_data,
            "feature_columns": ["feature_a", "feature_b", "plan"],
            "target_column": "churned",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["risk_scores"]) == len(classification_data)
    assert isinstance(payload["feature_importance"], dict)
    assert payload["feature_importance"]


async def test_analytics_cohort_endpoint_returns_summaries(
    client: AsyncClient,
    cohort_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/analytics/cohort",
        json={
            "data": cohort_data,
            "entity_id_column": "user_id",
            "signup_date_column": "signup_date",
            "activity_date_column": "activity_date",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["summaries"], list)
    assert payload["summaries"]


async def test_analytics_ab_test_endpoint_returns_statistics(
    client: AsyncClient,
    ab_test_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/analytics/ab-test",
        json={
            "data": ab_test_data,
            "group_column": "variant",
            "metric_column": "metric",
            "variant_a": "A",
            "variant_b": "B",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "p_value" in payload
    assert "effect_size" in payload


async def test_analytics_forecast_endpoint_returns_seven_points(
    client: AsyncClient,
    forecast_data: list[dict[str, object]],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/analytics/forecast",
        json={
            "data": forecast_data,
            "date_col": "event_date",
            "value_col": "value",
            "periods": 7,
            "method": "holt",
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["forecast_points"]) == 7
