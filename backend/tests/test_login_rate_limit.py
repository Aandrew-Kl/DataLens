"""Tests for login brute-force protection."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_login_rate_limit_blocks_after_max_attempts(client: AsyncClient) -> None:
    """After 5 failed login attempts the endpoint should return 429."""
    email = "brute-force-test@example.com"

    register_resp = await client.post(
        "/auth/register",
        json={"email": email, "password": "CorrectPassword123"},
        headers={"x-forwarded-for": "10.0.0.1"},
    )
    assert register_resp.status_code == 201

    for attempt in range(5):
        resp = await client.post(
            "/auth/login",
            json={"email": email, "password": "wrong"},
            headers={"x-forwarded-for": f"10.0.1.{attempt}"},
        )
        assert resp.status_code == 401

    resp = await client.post(
        "/auth/login",
        json={"email": email, "password": "wrong"},
        headers={"x-forwarded-for": "10.0.1.99"},
    )
    assert resp.status_code == 429
    assert "too many" in resp.json()["detail"].lower()


@pytest.mark.asyncio
async def test_successful_login_resets_attempts(client: AsyncClient) -> None:
    """A successful login should reset the attempt counter."""
    email = "reset-test@example.com"
    password = "CorrectPassword123"

    await client.post(
        "/auth/register",
        json={"email": email, "password": password},
        headers={"x-forwarded-for": "10.0.0.2"},
    )

    for attempt in range(3):
        await client.post(
            "/auth/login",
            json={"email": email, "password": "wrong"},
            headers={"x-forwarded-for": f"10.0.2.{attempt}"},
        )

    resp = await client.post(
        "/auth/login",
        json={"email": email, "password": password},
        headers={"x-forwarded-for": "10.0.2.99"},
    )
    assert resp.status_code == 200

    for attempt in range(5):
        resp = await client.post(
            "/auth/login",
            json={"email": email, "password": "wrong"},
            headers={"x-forwarded-for": f"10.0.3.{attempt}"},
        )
        assert resp.status_code == 401

    resp = await client.post(
        "/auth/login",
        json={"email": email, "password": "wrong"},
        headers={"x-forwarded-for": "10.0.3.99"},
    )
    assert resp.status_code == 429
