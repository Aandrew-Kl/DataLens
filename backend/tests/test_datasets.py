from __future__ import annotations

from uuid import uuid4

import pytest
from httpx import AsyncClient

from app.api import datasets as datasets_api


def _csv_bytes() -> bytes:
    return b"name,age\nAlice,30\nBob,25\n"


@pytest.fixture(autouse=True)
def _isolated_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr(datasets_api, "UPLOAD_DIR", tmp_path)


async def _register_and_login(client: AsyncClient) -> dict[str, str]:
    email = f"{uuid4()}@example.com"
    password = "super-secret-123"

    register_response = await client.post(
        "/auth/register",
        json={"email": email, "password": password},
    )
    assert register_response.status_code == 201

    login_response = await client.post(
        "/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == 200

    access_token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {access_token}"}


@pytest.mark.asyncio
async def test_upload_csv(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    response = await client.post(
        "/datasets/upload",
        headers=headers,
        files={"file": ("test.csv", _csv_bytes(), "text/csv")},
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["id"]
    assert payload["name"] == "test"
    assert payload["row_count"] == 2
    assert payload["column_count"] == 2


@pytest.mark.asyncio
async def test_upload_non_csv(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    response = await client.post(
        "/datasets/upload",
        headers=headers,
        files={"file": ("notes.txt", b"plain text", "text/plain")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Only CSV uploads are supported."


@pytest.mark.asyncio
async def test_upload_no_filename(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    response = await client.post(
        "/datasets/upload",
        headers=headers,
        files={"file": ("", _csv_bytes(), "text/csv")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "Uploaded file must have a filename."


@pytest.mark.asyncio
async def test_list_datasets(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    first_upload = await client.post(
        "/datasets/upload",
        headers=headers,
        data={"name": "customers"},
        files={"file": ("customers.csv", _csv_bytes(), "text/csv")},
    )
    assert first_upload.status_code == 201

    second_upload = await client.post(
        "/datasets/upload",
        headers=headers,
        data={"name": "orders"},
        files={"file": ("orders.csv", _csv_bytes(), "text/csv")},
    )
    assert second_upload.status_code == 201

    response = await client.get("/datasets/", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 2
    assert {dataset["name"] for dataset in payload} == {"customers", "orders"}


@pytest.mark.asyncio
async def test_get_dataset_by_id(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    upload_response = await client.post(
        "/datasets/upload",
        headers=headers,
        data={"name": "customers"},
        files={"file": ("customers.csv", _csv_bytes(), "text/csv")},
    )
    assert upload_response.status_code == 201
    dataset_id = upload_response.json()["id"]

    response = await client.get(f"/datasets/{dataset_id}", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["id"] == dataset_id
    assert payload["name"] == "customers"
    assert payload["row_count"] == 2
    assert payload["column_count"] == 2


@pytest.mark.asyncio
async def test_get_dataset_not_found(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    response = await client.get(f"/datasets/{uuid4()}", headers=headers)

    assert response.status_code == 404
    assert response.json()["detail"] == "Dataset not found."


@pytest.mark.asyncio
async def test_delete_dataset(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    upload_response = await client.post(
        "/datasets/upload",
        headers=headers,
        files={"file": ("test.csv", _csv_bytes(), "text/csv")},
    )
    assert upload_response.status_code == 201
    dataset_id = upload_response.json()["id"]

    delete_response = await client.delete(f"/datasets/{dataset_id}", headers=headers)
    assert delete_response.status_code == 204
    assert delete_response.content == b""

    get_response = await client.get(f"/datasets/{dataset_id}", headers=headers)
    assert get_response.status_code == 404
    assert get_response.json()["detail"] == "Dataset not found."


@pytest.mark.asyncio
async def test_datasets_require_auth(client: AsyncClient) -> None:
    response = await client.get("/datasets/")

    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"
