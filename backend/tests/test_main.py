import logging
from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from app.config import settings
from app.main import HSTS_HEADER_VALUE, app, build_csp_header


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
async def test_rate_limiter_returns_429_after_60_requests(client: AsyncClient) -> None:
    route_path = f"/api/test-rate-limit-{uuid4()}"

    async def limited_route() -> dict[str, str]:
        return {"status": "ok"}

    app.add_api_route(route_path, limited_route, methods=["GET"])
    added_route = app.router.routes[-1]

    try:
        headers = {"x-forwarded-for": "rate-limit-test"}

        for _ in range(60):
            response = await client.get(route_path.removeprefix("/api"), headers=headers)
            assert response.status_code == 200

        response = await client.get(route_path.removeprefix("/api"), headers=headers)
    finally:
        app.router.routes.remove(added_route)

    assert response.status_code == 429
    assert "rate limit exceeded" in response.json()["error"].lower()
    assert response.headers["x-ratelimit-limit"] == "60"
    assert response.headers["x-ratelimit-remaining"] == "0"
    assert response.headers["x-ratelimit-reset"].isdigit()
    assert response.headers["retry-after"].isdigit()


@pytest.mark.asyncio
async def test_request_logging_middleware_logs_request_details(
    client: AsyncClient,
    caplog: pytest.LogCaptureFixture,
) -> None:
    with caplog.at_level(logging.INFO, logger="app.request"):
        response = await client.get("/v1/health", headers={"x-forwarded-for": "logging-test"})

    assert response.status_code == 200
    request_id = response.headers["x-request-id"]
    assert UUID(request_id)
    assert any(f"request_id={request_id}" in record.message for record in caplog.records)
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
    assert response.headers["permissions-policy"] == "camera=(), microphone=(), geolocation=()"
    csp = response.headers["content-security-policy"]
    # API/JSON responses must use the strict CSP: no 'unsafe-inline' and no
    # 'unsafe-eval' on script-src, which is what shuts down reflected-XSS on
    # any path that accidentally returns HTML.
    assert "'unsafe-inline'" not in csp
    assert "'unsafe-eval'" not in csp
    assert "script-src 'self'" in csp
    assert "frame-ancestors 'none'" in csp
    assert "strict-transport-security" not in response.headers


def test_build_csp_header_api_response_is_strict() -> None:
    csp = build_csp_header("/v1/health", environment="production")

    assert "'unsafe-inline'" not in csp
    assert "'unsafe-eval'" not in csp
    assert "script-src 'self';" in csp
    assert "frame-ancestors 'none'" in csp


def test_build_csp_header_dev_api_is_still_strict() -> None:
    # Even in development, API responses must stay strict. There's no valid
    # reason for JSON endpoints to ever need 'unsafe-inline' or 'unsafe-eval'.
    csp = build_csp_header("/v1/health", environment="development")

    assert "'unsafe-eval'" not in csp
    assert "'unsafe-inline'" not in csp
    assert "script-src 'self';" in csp


def test_build_csp_header_docs_path_allows_inline_scripts() -> None:
    # Swagger UI ships inline bootstrap scripts and styles; API-strict CSP
    # would blank-page the interactive docs. Scope the relaxation to doc
    # routes only.
    csp = build_csp_header("/api/docs", environment="production")

    assert "'unsafe-inline'" in csp
    # Even on docs, production must not enable 'unsafe-eval'.
    assert "'unsafe-eval'" not in csp
    assert "cdn.jsdelivr.net" in csp


def test_build_csp_header_docs_dev_adds_unsafe_eval() -> None:
    csp = build_csp_header("/api/docs", environment="development")

    assert "'unsafe-inline'" in csp
    assert "'unsafe-eval'" in csp


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


@pytest.mark.asyncio
async def test_metrics_endpoint_reports_request_totals_and_status_buckets(client: AsyncClient) -> None:
    route_path = f"/api/test-metrics-error-{uuid4()}"

    async def raise_error() -> None:
        raise RuntimeError("metrics failure")

    app.add_api_route(route_path, raise_error, methods=["GET"])
    added_route = app.router.routes[-1]

    try:
        ok_response = await client.get("/v1/health", headers={"x-forwarded-for": "metrics-ok"})
        not_found_response = await client.get("/missing-route", headers={"x-forwarded-for": "metrics-404"})
        error_response = await client.get(route_path.removeprefix("/api"), headers={"x-forwarded-for": "metrics-500"})
        metrics_response = await client.get("/metrics", headers={"x-forwarded-for": "metrics-endpoint"})
    finally:
        app.router.routes.remove(added_route)

    assert ok_response.status_code == 200
    assert not_found_response.status_code == 404
    assert error_response.status_code == 500
    assert metrics_response.status_code == 200
    payload = metrics_response.json()
    assert payload == {
        "total_requests": 3,
        "status_codes": {"2xx": 1, "4xx": 1, "5xx": 1},
        "uptime_seconds": payload["uptime_seconds"],
    }
    assert isinstance(payload["uptime_seconds"], int)
    assert payload["uptime_seconds"] >= 0
