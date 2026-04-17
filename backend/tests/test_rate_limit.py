from __future__ import annotations

from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.api.auth import _login_attempts
from app.main import app
from app.middleware.rate_limit import limiter


def _auth_client() -> TestClient:
    limiter.reset()
    _login_attempts.clear()
    return TestClient(app)


def _register(client: TestClient, email: str, password: str, ip: str) -> None:
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": password},
        headers={"x-forwarded-for": ip},
    )
    assert response.status_code == 201


def _token(client: TestClient, email: str, password: str, ip: str) -> str:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
        headers={"x-forwarded-for": ip},
    )
    assert response.status_code == 200
    return response.json()["access_token"]


def test_login_rate_limit_returns_retry_after_header() -> None:
    with _auth_client() as client:
        email = f"login-limit-{uuid4()}@example.com"
        _register(client, email, "StrongPass123", "10.0.0.1")

        for _ in range(5):
            response = client.post(
                "/api/auth/login",
                json={"email": email, "password": "wrong"},
                headers={"x-forwarded-for": "10.0.0.1"},
            )
            assert response.status_code == 401

        response = client.post(
            "/api/auth/login",
            json={"email": email, "password": "wrong"},
            headers={"x-forwarded-for": "10.0.0.1"},
        )

        assert response.status_code == 429
        assert response.headers["Retry-After"].isdigit()


def test_authenticated_requests_use_user_scoped_limit_keys() -> None:
    with _auth_client() as client:
        ip = "10.0.0.2"
        payload = {"data": [{"text": "alpha"}], "text_columns": ["text"], "dataset_id": 1}
        first_email = f"ai-user-a-{uuid4()}@example.com"
        second_email = f"ai-user-b-{uuid4()}@example.com"
        _register(client, first_email, "StrongPass123", ip)
        _register(client, second_email, "StrongPass123", ip)
        first_headers = {
            "Authorization": f"Bearer {_token(client, first_email, 'StrongPass123', ip)}",
            "x-forwarded-for": ip,
        }
        second_headers = {
            "Authorization": f"Bearer {_token(client, second_email, 'StrongPass123', ip)}",
            "x-forwarded-for": ip,
        }

        for _ in range(20):
            response = client.post("/api/ai/summarize", json=payload, headers=first_headers)
            assert response.status_code == 200

        blocked = client.post("/api/ai/summarize", json=payload, headers=first_headers)
        allowed = client.post("/api/ai/summarize", json=payload, headers=second_headers)

        assert blocked.status_code == 429
        assert blocked.headers["Retry-After"].isdigit()
        assert allowed.status_code == 200


@pytest.mark.parametrize("path", ["/health", "/metrics"])
def test_health_and_metrics_routes_are_exempt_from_rate_limits(path: str) -> None:
    with _auth_client() as client:
        for _ in range(70):
            response = client.get(path, headers={"x-forwarded-for": "10.0.0.3"})
            assert response.status_code == 200
