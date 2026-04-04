import logging
from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.config import settings
from app.main import HSTS_HEADER_VALUE, app


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


@pytest.mark.asyncio
async def test_security_headers_are_applied(client: AsyncClient) -> None:
    response = await client.get(
        "/v1/health",
        headers={
            "host": "localhost:8000",
            "x-forwarded-for": "security-headers-test",
        },
    )

    assert response.status_code == 200
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-xss-protection"] == "1; mode=block"
    assert response.headers["referrer-policy"] == "strict-origin-when-cross-origin"
    assert "strict-transport-security" not in response.headers


@pytest.mark.asyncio
async def test_security_headers_include_hsts_for_non_local_hosts(client: AsyncClient) -> None:
    response = await client.get(
        "/v1/health",
        headers={
            "host": "api.example.com",
            "x-forwarded-for": "security-headers-remote-test",
        },
    )

    assert response.status_code == 200
    assert response.headers["strict-transport-security"] == HSTS_HEADER_VALUE


@pytest.mark.asyncio
async def test_request_size_limit_returns_413_for_large_payloads(
    client: AsyncClient,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from tests.test_datasets import _register_and_login

    headers = await _register_and_login(client)
    monkeypatch.setattr(settings, "MAX_UPLOAD_SIZE", 64)

    response = await client.post(
        "/datasets/upload",
        headers=headers,
        files={"file": ("large.csv", b"column\n" + (b"a" * 1024), "text/csv")},
    )

    assert response.status_code == 413
    assert response.json() == {"detail": "Request body too large."}


@pytest.mark.asyncio
async def test_unhandled_exception_handler_returns_generic_500(client: AsyncClient) -> None:
    route_path = f"/api/test-error-{uuid4()}"

    async def raise_error() -> None:
        raise RuntimeError("secret stack trace detail")

    app.add_api_route(route_path, raise_error, methods=["GET"])
    added_route = app.router.routes[-1]

    try:
        response = await client.get(route_path.removeprefix("/api"))
    finally:
        app.router.routes.remove(added_route)

    assert response.status_code == 500
    assert response.json() == {"detail": "Internal server error"}
    assert "secret stack trace detail" not in response.text
