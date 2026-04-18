from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from httpx import AsyncClient

from app.api import datasets as datasets_api


pytestmark = pytest.mark.asyncio


def _csv_bytes() -> bytes:
    return b"name,amount\nAlice,10\nBob,20\n"


@pytest.fixture(autouse=True)
def _isolated_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr(datasets_api, "UPLOAD_DIR", tmp_path)


async def _register_and_login(client: AsyncClient) -> dict[str, str]:
    email = f"{uuid4()}@example.com"
    password = "StrongPass123"

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


async def _upload_dataset(client: AsyncClient, headers: dict[str, str], *, name: str) -> UUID:
    response = await client.post(
        "/datasets/upload",
        headers=headers,
        data={"name": name},
        files={"file": (f"{name}.csv", _csv_bytes(), "text/csv")},
    )
    assert response.status_code == 201
    return UUID(response.json()["id"])


async def test_bookmark_crud_round_trip(client: AsyncClient) -> None:
    headers = await _register_and_login(client)
    dataset_id = await _upload_dataset(client, headers, name="bookmark-source")

    create_response = await client.post(
        "/bookmarks",
        headers=headers,
        json={
            "id": "bookmark-1",
            "dataset_id": str(dataset_id),
            "table_name": "orders",
            "label": "Revenue view",
            "description": "Saved revenue slice",
            "view_state": {"selectedTab": "charts", "filters": []},
        },
    )
    assert create_response.status_code == 201
    assert create_response.json()["label"] == "Revenue view"

    update_response = await client.patch(
        "/bookmarks/bookmark-1",
        headers=headers,
        json={
            "dataset_id": str(dataset_id),
            "table_name": "orders",
            "label": "Revenue view updated",
            "description": "Updated view",
            "view_state": {"selectedTab": "table", "filters": []},
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["label"] == "Revenue view updated"

    list_response = await client.get("/bookmarks", headers=headers)
    assert list_response.status_code == 200
    bookmark_payload = list_response.json()
    assert len(bookmark_payload) == 1
    assert bookmark_payload[0]["id"] == "bookmark-1"
    assert bookmark_payload[0]["dataset_id"] == str(dataset_id)
    assert bookmark_payload[0]["table_name"] == "orders"
    assert bookmark_payload[0]["label"] == "Revenue view updated"

    delete_response = await client.delete("/bookmarks/bookmark-1", headers=headers)
    assert delete_response.status_code == 204

    final_list_response = await client.get("/bookmarks", headers=headers)
    assert final_list_response.status_code == 200
    assert final_list_response.json() == []


async def test_bookmark_create_conflicts_when_id_already_exists(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    create_response = await client.post(
        "/bookmarks",
        headers=headers,
        json={
            "id": "bookmark-1",
            "label": "Revenue view",
        },
    )
    assert create_response.status_code == 201

    conflict_response = await client.post(
        "/bookmarks",
        headers=headers,
        json={
            "id": "bookmark-1",
            "label": "Revenue view duplicate",
        },
    )
    assert conflict_response.status_code == 409
    assert conflict_response.json()["detail"] == "Bookmark already exists."


async def test_bookmark_update_returns_not_found_for_missing_record(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    response = await client.patch(
        "/bookmarks/missing-bookmark",
        headers=headers,
        json={
            "label": "Revenue view",
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Bookmark not found."


async def test_pipeline_crud_round_trip(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    create_response = await client.post(
        "/pipelines",
        headers=headers,
        json={
            "id": "pipeline-1",
            "name": "Regional filter",
            "steps": [{"id": "step-1", "type": "filter", "column": "region"}],
        },
    )
    assert create_response.status_code == 201
    assert create_response.json()["name"] == "Regional filter"

    update_response = await client.patch(
        "/pipelines/pipeline-1",
        headers=headers,
        json={
            "name": "Regional filter v2",
            "steps": [{"id": "step-1", "type": "sort", "column": "sales"}],
        },
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Regional filter v2"

    list_response = await client.get("/pipelines", headers=headers)
    assert list_response.status_code == 200
    pipeline_payload = list_response.json()
    assert len(pipeline_payload) == 1
    assert pipeline_payload[0]["id"] == "pipeline-1"
    assert pipeline_payload[0]["name"] == "Regional filter v2"

    delete_response = await client.delete("/pipelines/pipeline-1", headers=headers)
    assert delete_response.status_code == 204

    final_list_response = await client.get("/pipelines", headers=headers)
    assert final_list_response.status_code == 200
    assert final_list_response.json() == []


async def test_pipeline_create_conflicts_when_id_already_exists(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    create_response = await client.post(
        "/pipelines",
        headers=headers,
        json={
            "id": "pipeline-1",
            "name": "Regional filter",
            "steps": [],
        },
    )
    assert create_response.status_code == 201

    conflict_response = await client.post(
        "/pipelines",
        headers=headers,
        json={
            "id": "pipeline-1",
            "name": "Regional filter duplicate",
            "steps": [],
        },
    )
    assert conflict_response.status_code == 409
    assert conflict_response.json()["detail"] == "Pipeline already exists."


async def test_pipeline_update_returns_not_found_for_missing_record(client: AsyncClient) -> None:
    headers = await _register_and_login(client)

    response = await client.patch(
        "/pipelines/missing-pipeline",
        headers=headers,
        json={
            "name": "Regional filter",
            "steps": [],
        },
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Pipeline not found."


async def test_query_history_crud_and_limit(client: AsyncClient) -> None:
    headers = await _register_and_login(client)
    dataset_id = await _upload_dataset(client, headers, name="history-source")

    for index in range(52):
        create_response = await client.post(
            "/history",
            headers=headers,
            json={
                "dataset_id": str(dataset_id),
                "question": f"Question {index}",
                "sql_text": f'SELECT {index} FROM "history_source"',
                "duration_ms": index,
            },
        )
        assert create_response.status_code == 201

    list_response = await client.get("/history", headers=headers)
    assert list_response.status_code == 200
    payload = list_response.json()
    assert len(payload) == 50
    assert payload[0]["question"] == "Question 51"
    assert payload[-1]["question"] == "Question 2"

    delete_response = await client.delete(f'/history/{payload[0]["id"]}', headers=headers)
    assert delete_response.status_code == 204

    final_list_response = await client.get("/history", headers=headers)
    assert final_list_response.status_code == 200
    assert len(final_list_response.json()) == 49


@pytest.mark.parametrize(
    ("method", "path", "payload"),
    [
        ("get", "/bookmarks", None),
        ("post", "/bookmarks", {"label": "Bookmark", "table_name": "orders"}),
        ("patch", "/bookmarks/bookmark-1", {"label": "Bookmark", "table_name": "orders"}),
        ("delete", "/bookmarks/bookmark-1", None),
        ("get", "/pipelines", None),
        ("post", "/pipelines", {"name": "Pipeline", "steps": []}),
        ("patch", "/pipelines/pipeline-1", {"name": "Pipeline", "steps": []}),
        ("delete", "/pipelines/pipeline-1", None),
        ("get", "/history", None),
        ("post", "/history", {"dataset_id": str(uuid4()), "sql_text": "SELECT 1"}),
        ("delete", "/history/1", None),
    ],
)
async def test_persistence_routes_require_auth(
    client: AsyncClient,
    method: str,
    path: str,
    payload: dict[str, object] | None,
) -> None:
    request_kwargs = {"json": payload} if payload is not None else {}
    response = await client.request(method.upper(), path, **request_kwargs)
    assert response.status_code == 401
