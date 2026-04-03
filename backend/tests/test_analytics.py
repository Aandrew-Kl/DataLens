"""Analytics endpoint tests."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


def build_churn_csv() -> str:
    """Build a separable churn dataset."""

    rows = ["sessions,last_seen_days,support_tickets,plan,churned"]
    for index in range(1, 41):
        sessions = max(1, 15 - index // 3)
        last_seen_days = index
        support_tickets = index % 4
        plan = "pro" if index % 2 == 0 else "basic"
        churned = "yes" if last_seen_days > 20 or sessions < 5 else "no"
        rows.append(f"{sessions},{last_seen_days},{support_tickets},{plan},{churned}")
    return "\n".join(rows)


def build_cohort_csv() -> str:
    """Build a simple cohort-retention dataset."""

    return "\n".join(
        [
            "user_id,signup_date,activity_date",
            "u1,2024-01-03,2024-01-03",
            "u1,2024-01-03,2024-02-10",
            "u1,2024-01-03,2024-03-09",
            "u2,2024-01-15,2024-01-15",
            "u2,2024-01-15,2024-02-18",
            "u3,2024-02-01,2024-02-01",
            "u3,2024-02-01,2024-03-01",
            "u4,2024-02-12,2024-02-12",
        ]
    )


def build_ab_csv() -> str:
    """Build a continuous A/B test dataset."""

    rows = ["variant,metric"]
    for value in (10, 11, 9, 10, 12, 11, 10, 9):
        rows.append(f"A,{value}")
    for value in (13, 14, 12, 15, 14, 13, 15, 14):
        rows.append(f"B,{value}")
    return "\n".join(rows)


@pytest.mark.asyncio
async def test_churn_predict_endpoint(client: AsyncClient, auth_headers: dict[str, str], upload_dataset) -> None:
    """Churn prediction returns risk scores and feature importance."""

    dataset = await upload_dataset("churn", build_churn_csv())
    response = await client.post(
        "/analytics/churn-predict",
        headers=auth_headers,
        json={
            "dataset_id": dataset["id"],
            "feature_columns": ["sessions", "last_seen_days", "support_tickets", "plan"],
            "target_column": "churned",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["row_count"] == 40
    assert payload["risk_scores"]
    assert payload["feature_importance"]


@pytest.mark.asyncio
async def test_cohort_endpoint(client: AsyncClient, auth_headers: dict[str, str], upload_dataset) -> None:
    """Cohort analysis returns retention rows."""

    dataset = await upload_dataset("cohorts", build_cohort_csv())
    response = await client.post(
        "/analytics/cohort",
        headers=auth_headers,
        json={
            "dataset_id": dataset["id"],
            "entity_id_column": "user_id",
            "signup_date_column": "signup_date",
            "activity_date_column": "activity_date",
            "frequency": "monthly",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["cohort_count"] == 2
    assert payload["retention_rows"]


@pytest.mark.asyncio
async def test_ab_test_endpoint(client: AsyncClient, auth_headers: dict[str, str], upload_dataset) -> None:
    """A/B testing returns a statistical result with p-value and effect size."""

    dataset = await upload_dataset("ab-test", build_ab_csv())
    response = await client.post(
        "/analytics/ab-test",
        headers=auth_headers,
        json={
            "dataset_id": dataset["id"],
            "group_column": "variant",
            "metric_column": "metric",
            "variant_a": "A",
            "variant_b": "B",
            "metric_type": "continuous",
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["test_used"] == "ttest_ind"
    assert payload["p_value"] >= 0
    assert len(payload["confidence_interval"]) == 2
