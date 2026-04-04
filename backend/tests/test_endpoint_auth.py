"""Verify that compute endpoints reject unauthenticated requests."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


PROTECTED_POST_ENDPOINTS = [
    # AI endpoints
    "/ai/sentiment",
    "/ai/summarize",
    "/ai/generate-query",
    "/ai/explain",
    # ML endpoints
    "/ml/regression",
    "/ml/cluster",
    "/ml/classify",
    "/ml/anomaly-detect",
    "/ml/pca",
    "/ml/decision-tree",
    # Analytics endpoints
    "/analytics/churn-predict",
    "/analytics/cohort",
    "/analytics/ab-test",
    "/analytics/forecast",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", PROTECTED_POST_ENDPOINTS)
async def test_unauthenticated_request_returns_401(
    client: AsyncClient,
    endpoint: str,
) -> None:
    """Every compute endpoint must reject requests without a Bearer token."""
    response = await client.post(endpoint, json={"data": []})
    assert response.status_code == 401, (
        f"{endpoint} returned {response.status_code} instead of 401"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", PROTECTED_POST_ENDPOINTS)
async def test_invalid_token_returns_401(
    client: AsyncClient,
    endpoint: str,
) -> None:
    """Every compute endpoint must reject requests with an invalid Bearer token."""
    response = await client.post(
        endpoint,
        json={"data": []},
        headers={"Authorization": "Bearer invalid-garbage-token"},
    )
    assert response.status_code == 401, (
        f"{endpoint} returned {response.status_code} instead of 401"
    )
