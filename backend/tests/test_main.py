import logging

import pytest
from httpx import AsyncClient

from app.config import settings


@pytest.mark.asyncio
async def test_healthcheck_reports_application_and_database_status(client: AsyncClient) -> None:
    response = await client.get("/v1/health", headers={"x-forwarded-for": "health-test"})

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "version": settings.APP_VERSION,
        "database": {"status": "ok"},
    }


@pytest.mark.asyncio
async def test_cors_preflight_uses_configured_origins(client: AsyncClient) -> None:
    response = await client.options(
        "/v1/health",
        headers={
            "Origin": settings.CORS_ORIGINS[0],
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == settings.CORS_ORIGINS[0]
    assert response.headers["access-control-allow-credentials"] == "true"


@pytest.mark.asyncio
async def test_rate_limiter_returns_429_after_100_requests(client: AsyncClient) -> None:
    headers = {"x-forwarded-for": "rate-limit-test"}

    for _ in range(100):
        response = await client.get("/v1/health", headers=headers)
        assert response.status_code == 200

    response = await client.get("/v1/health", headers=headers)

    assert response.status_code == 429
    assert response.json() == {"detail": "Rate limit exceeded. Please retry later."}


@pytest.mark.asyncio
async def test_request_logging_middleware_logs_request_details(
    client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO, logger="app.request"):
        response = await client.get("/v1/health", headers={"x-forwarded-for": "logging-test"})

    assert response.status_code == 200
    assert any("method=GET" in record.message for record in caplog.records)
    assert any("status_code=200" in record.message for record in caplog.records)
    assert any("duration_ms=" in record.message for record in caplog.records)
