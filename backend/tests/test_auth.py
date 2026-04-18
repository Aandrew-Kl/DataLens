"""Authentication endpoint tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from httpx import AsyncClient
from jose import jwt
from sqlalchemy.exc import SQLAlchemyError

from app.config import settings
from app.database import get_db
from app.main import app
from app.utils.security import hash_password, verify_password


@pytest.mark.asyncio
async def test_register_login_and_me(client: AsyncClient) -> None:
    """Users can register, log in, and retrieve their own profile."""

    register_response = await client.post(
        "/auth/register",
        json={"email": "auth@example.com", "password": "StrongPass123"},
    )
    assert register_response.status_code == 201
    register_payload = register_response.json()
    assert register_payload["email"] == "auth@example.com"
    assert register_payload["token_type"] == "bearer"
    assert register_payload["access_token"]
    assert register_payload["user"]["email"] == "auth@example.com"

    login_response = await client.post(
        "/auth/login",
        json={"email": "auth@example.com", "password": "StrongPass123"},
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
    payload = {"email": "duplicate@example.com", "password": "StrongPass123"}

    first_response = await client.post("/auth/register", json=payload)
    assert first_response.status_code == 201

    duplicate_response = await client.post("/auth/register", json=payload)
    assert duplicate_response.status_code == 409
    assert duplicate_response.json()["detail"] == "Email is already registered."


@pytest.mark.asyncio
async def test_register_db_error_returns_friendly_message(client: AsyncClient) -> None:
    class DummyResult:
        def scalar_one_or_none(self) -> None:
            return None

    class FailingSession:
        async def execute(self, _statement):
            return DummyResult()

        def add(self, _instance) -> None:
            return None

        async def commit(self) -> None:
            raise SQLAlchemyError("database unavailable")

        async def rollback(self) -> None:
            return None

        async def refresh(self, _instance) -> None:
            raise AssertionError("refresh should not run after commit failure")

    async def override_get_db():
        yield FailingSession()

    app.dependency_overrides[get_db] = override_get_db

    try:
        response = await client.post(
            "/auth/register",
            json={"email": "db-error@example.com", "password": "StrongPass123"},
        )
    finally:
        app.dependency_overrides.pop(get_db, None)

    assert response.status_code == 500
    assert response.json() == {"detail": "Account creation failed. Try again."}


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
        json={"email": "wrong-password@example.com", "password": "StrongPass123"},
    )
    assert register_response.status_code == 201

    login_response = await client.post(
        "/auth/login",
        json={"email": "wrong-password@example.com", "password": "WrongPass123"},
    )

    assert login_response.status_code == 401
    assert login_response.json()["detail"] == "Invalid email or password."


@pytest.mark.asyncio
async def test_login_nonexistent_user(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/login",
        json={"email": "missing@example.com", "password": "StrongPass123"},
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


@pytest.mark.asyncio
async def test_me_expired_token(client: AsyncClient) -> None:
    register_response = await client.post(
        "/auth/register",
        json={"email": "expired-token@example.com", "password": "StrongPass123"},
    )
    assert register_response.status_code == 201

    user_payload = register_response.json()
    expired_token = jwt.encode(
        {
            "sub": user_payload["id"],
            "email": user_payload["email"],
            "exp": datetime.now(timezone.utc) - timedelta(minutes=5),
        },
        settings.JWT_SECRET,
        algorithm=settings.JWT_ALGORITHM,
    )

    response = await client.get(
        "/auth/me",
        headers={"Authorization": f"Bearer {expired_token}"},
    )

    assert response.status_code == 401
    assert response.json()["detail"] == "Invalid authentication credentials."


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("password", "message_fragment"),
    [
        ("lowercase123", "uppercase"),
        ("UPPERCASE123", "lowercase"),
        ("NoDigitsHere", "digit"),
    ],
)
async def test_register_requires_password_complexity(
    client: AsyncClient,
    password: str,
    message_fragment: str,
) -> None:
    response = await client.post(
        "/auth/register",
        json={"email": "complexity@example.com", "password": password},
    )

    assert response.status_code == 422
    assert any(error["loc"] == ["body", "password"] for error in response.json()["detail"])
    assert any(message_fragment in error["msg"].lower() for error in response.json()["detail"])


@pytest.mark.asyncio
async def test_register_rejects_invalid_email(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/register",
        json={"email": "not-an-email", "password": "StrongPass123"},
    )

    assert response.status_code == 422
    assert any(error["loc"] == ["body", "email"] for error in response.json()["detail"])


@pytest.mark.asyncio
async def test_login_rejects_invalid_email(client: AsyncClient) -> None:
    response = await client.post(
        "/auth/login",
        json={"email": "not-an-email", "password": "StrongPass123"},
    )

    assert response.status_code == 422
    assert any(error["loc"] == ["body", "email"] for error in response.json()["detail"])


def test_password_hashing_verification() -> None:
    password = "StrongPass123"

    hashed_password = hash_password(password)

    assert hashed_password != password
    assert verify_password(password, hashed_password) is True
    assert verify_password("not-the-password", hashed_password) is False
