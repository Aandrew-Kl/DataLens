"""Authentication endpoint tests."""

from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_login_and_me(client: AsyncClient) -> None:
    """Users can register, log in, and retrieve their own profile."""

    register_response = await client.post(
        "/auth/register",
        json={"email": "auth@example.com", "password": "super-secret-123"},
    )
    assert register_response.status_code == 201
    assert register_response.json()["email"] == "auth@example.com"

    login_response = await client.post(
        "/auth/login",
        json={"email": "auth@example.com", "password": "super-secret-123"},
    )
    assert login_response.status_code == 200
    token_payload = login_response.json()
    assert token_payload["token_type"] == "bearer"
    assert token_payload["access_token"]

    me_response = await client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {token_payload['access_token']}"},
    )
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "auth@example.com"
