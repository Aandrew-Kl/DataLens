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


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient) -> None:
    payload = {"email": "duplicate@example.com", "password": "super-secret-123"}

    first_response = await client.post("/auth/register", json=payload)
    assert first_response.status_code == 201

    duplicate_response = await client.post("/auth/register", json=payload)
    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["detail"] == "Email is already registered."


@pytest.mark.asyncio
async def test_register_short_password(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register",
        json={"email": "short-password@example.com", "password": "short"},
    )

    assert response.status_code == 422
    assert any(error["loc"] == ["body", "password"] for error in response.json()["detail"])


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient) -> None:
    register_response = await client.post(
        "/auth/register",
        json={"email": "wrong-password@example.com", "password": "super-secret-123"},
    )
    assert register_response.status_code == 201

    login_response = await client.post(
        "/auth/login",
        json={"email": "wrong-password@example.com", "password": "not-the-password"},
    )

    assert login_response.status_code == 401
    assert login_response.json()["detail"] == "Invalid email or password."


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/login",
        json={"email": "missing@example.com", "password": "super-secret-123"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid email or password."


@pytest.mark.asyncio
async def test_me_invalid_token(client: AsyncClient) -> None:
    response = await client.get(
        "/auth/me",
        headers={"Authorization": "Bearer garbage"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid authentication credentials."


@pytest.mark.asyncio
async def test_me_no_auth_header(client: AsyncClient) -> None:
    response = await client.get("/auth/me")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"
