"""Tests for shared backend dependency helpers."""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException, status
from httpx import AsyncClient
from sqlalchemy import select

from app.api import datasets as datasets_api
from app.api.deps import get_owned_dataset, save_analysis, save_query
from app.database import AsyncSessionLocal
from app.models.analysis import SavedAnalysis
from app.models.query_history import QueryHistory


pytestmark = pytest.mark.asyncio


def _csv_bytes() -> bytes:
    return b"name,age\nAlice,30\nBob,25\n"


@pytest.fixture(autouse=True)
def _isolated_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr(datasets_api, "UPLOAD_DIR", tmp_path)


async def _register_and_login(client: AsyncClient) -> tuple[UUID, dict[str, str]]:
    email = f"{uuid4()}@example.com"
    password = "StrongPass123"

    register_response = await client.post(
        "/auth/register",
        json={"email": email, "password": password},
    )
    assert register_response.status_code == 201
    user_id = UUID(register_response.json()["id"])

    login_response = await client.post(
        "/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == 200

    access_token = login_response.json()["access_token"]
    return user_id, {"Authorization": f"Bearer {access_token}"}


async def _upload_dataset(client: AsyncClient, headers: dict[str, str], *, name: str) -> UUID:
    response = await client.post(
        "/datasets/upload",
        headers=headers,
        data={"name": name},
        files={"file": (f"{name}.csv", _csv_bytes(), "text/csv")},
    )
    assert response.status_code == 201
    return UUID(response.json()["id"])


async def test_get_owned_dataset_returns_dataset_when_user_owns_it(client: AsyncClient) -> None:
    user_id, headers = await _register_and_login(client)
    dataset_id = await _upload_dataset(client, headers, name="owned-dataset")

    async with AsyncSessionLocal() as session:
        dataset = await get_owned_dataset(session, user_id, dataset_id)

    assert dataset.id == dataset_id
    assert dataset.user_id == user_id
    assert dataset.name == "owned-dataset"


async def test_get_owned_dataset_raises_404_when_dataset_not_found(client: AsyncClient) -> None:
    user_id, _headers = await _register_and_login(client)

    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc_info:
            await get_owned_dataset(session, user_id, uuid4())

    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
    assert exc_info.value.detail == "Dataset not found."


async def test_get_owned_dataset_raises_404_when_user_does_not_own_dataset(client: AsyncClient) -> None:
    _owner_user_id, owner_headers = await _register_and_login(client)
    dataset_id = await _upload_dataset(client, owner_headers, name="private-dataset")
    other_user_id, _other_headers = await _register_and_login(client)

    async with AsyncSessionLocal() as session:
        with pytest.raises(HTTPException) as exc_info:
            await get_owned_dataset(session, other_user_id, dataset_id)

    assert exc_info.value.status_code == status.HTTP_404_NOT_FOUND
    assert exc_info.value.detail == "Dataset not found."


async def test_save_analysis_persists_an_analysis_record(client: AsyncClient) -> None:
    user_id, headers = await _register_and_login(client)
    dataset_id = await _upload_dataset(client, headers, name="analysis-source")
    config = {"metric": "retention", "dimensions": ["plan"]}
    result = {"summary": {"rows": 2, "status": "ok"}}

    async with AsyncSessionLocal() as session:
        await save_analysis(
            session,
            user_id=user_id,
            dataset_id=dataset_id,
            analysis_type="retention_summary",
            config=config,
            result=result,
        )

    async with AsyncSessionLocal() as session:
        saved_analysis = (
            await session.execute(
                select(SavedAnalysis).where(
                    SavedAnalysis.user_id == user_id,
                    SavedAnalysis.dataset_id == dataset_id,
                )
            )
        ).scalar_one()

    assert saved_analysis.user_id == user_id
    assert saved_analysis.dataset_id == dataset_id
    assert saved_analysis.analysis_type == "retention_summary"
    assert saved_analysis.config == config
    assert saved_analysis.result == result


async def test_save_query_persists_a_query_history_record(client: AsyncClient) -> None:
    user_id, headers = await _register_and_login(client)
    dataset_id = await _upload_dataset(client, headers, name="query-source")

    async with AsyncSessionLocal() as session:
        await save_query(
            session,
            user_id=user_id,
            dataset_id=dataset_id,
            sql_text="SELECT name, age FROM dataset_rows LIMIT 10",
            duration_ms=87,
        )

    async with AsyncSessionLocal() as session:
        saved_query = (
            await session.execute(
                select(QueryHistory).where(
                    QueryHistory.user_id == user_id,
                    QueryHistory.dataset_id == dataset_id,
                )
            )
        ).scalar_one()

    assert saved_query.user_id == user_id
    assert saved_query.dataset_id == dataset_id
    assert saved_query.sql_text == "SELECT name, age FROM dataset_rows LIMIT 10"
    assert saved_query.duration_ms == 87
