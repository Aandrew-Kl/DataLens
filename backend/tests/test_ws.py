"""WebSocket integration tests."""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from urllib.parse import urlencode

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

import app.api.datasets as datasets_api
from app.config import settings
from app.database import Base, engine
from app.main import app, rate_limiter


async def _reset_database() -> None:
    await engine.dispose()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()


async def _drop_database() -> None:
    await engine.dispose()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()


def _run_async(coro) -> None:
    asyncio.run(coro)


@pytest.fixture
def ws_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    uploads_dir = tmp_path / "uploads"
    monkeypatch.setattr(settings, "UPLOADS_DIR", str(uploads_dir))
    monkeypatch.setattr(datasets_api, "UPLOAD_DIR", uploads_dir)

    rate_limiter.clear()
    _run_async(_reset_database())

    with TestClient(app) as client:
        yield client

    rate_limiter.clear()
    _run_async(_drop_database())


def _register_login_user(client: TestClient) -> str:
    email = f"ws-{uuid.uuid4().hex}@example.com"
    password = "StrongPass123"

    register_response = client.post(
        "/api/auth/register",
        json={"email": email, "password": password},
    )
    assert register_response.status_code == 201, register_response.text

    login_response = client.post(
        "/api/auth/login",
        json={"email": email, "password": password},
    )
    assert login_response.status_code == 200, login_response.text

    payload = login_response.json()
    assert payload["token_type"] == "bearer"
    assert payload["access_token"]
    return payload["access_token"]


def _upload_csv_dataset(client: TestClient, token: str, csv_content: str) -> dict[str, object]:
    upload_response = client.post(
        "/api/datasets/upload",
        headers={"Authorization": f"Bearer {token}"},
        data={"name": "stream-test"},
        files={"file": ("stream.csv", csv_content.encode("utf-8"), "text/csv")},
    )
    assert upload_response.status_code == 201, upload_response.text
    return upload_response.json()


def _websocket_url(token: str, dataset_id: str, **params: object) -> str:
    query_params = {
        "token": token,
        "dataset_id": dataset_id,
        **{key: value for key, value in params.items() if value is not None},
    }
    return f"/api/ws/data-stream?{urlencode(query_params)}"


def _receive_until_complete(websocket) -> list[dict[str, object]]:
    messages: list[dict[str, object]] = []
    while True:
        message = websocket.receive_json()
        messages.append(message)
        if message["type"] in {"complete", "error"}:
            return messages


def test_ws_rejects_invalid_token(ws_client: TestClient) -> None:
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with ws_client.websocket_connect(
            _websocket_url(token="bad-token", dataset_id=str(uuid.uuid4()))
        ) as websocket:
            websocket.receive_json()

    assert excinfo.value.code == 1008
    assert excinfo.value.reason == "Invalid authentication token."


def test_ws_rejects_missing_dataset(ws_client: TestClient) -> None:
    token = _register_login_user(ws_client)

    with pytest.raises(WebSocketDisconnect) as excinfo:
        with ws_client.websocket_connect(
            _websocket_url(token=token, dataset_id=str(uuid.uuid4()))
        ) as websocket:
            websocket.receive_json()

    assert excinfo.value.code == 1008
    assert excinfo.value.reason == "Dataset not found or access denied."


def test_ws_streams_csv_rows(ws_client: TestClient) -> None:
    token = _register_login_user(ws_client)
    dataset = _upload_csv_dataset(
        ws_client,
        token,
        "name,amount,category\nAlice,5,A\nBob,12,B\nCara,25,A\nDan,8,C\n",
    )

    with ws_client.websocket_connect(
        _websocket_url(
            token=token,
            dataset_id=str(dataset["id"]),
            chunk_size=2,
        )
    ) as websocket:
        messages = _receive_until_complete(websocket)

    profiling_messages = [message for message in messages if message["type"] == "profiling"]
    query_messages = [message for message in messages if message["type"] == "query_result"]
    complete_message = messages[-1]

    assert messages[0] == {
        "type": "profiling",
        "percent": 0,
        "rows_processed": 0,
        "rows_total": 4,
    }
    assert profiling_messages
    assert profiling_messages[-1]["percent"] == 100
    assert query_messages
    assert [message["row_index"] for message in query_messages] == [1, 2, 3, 4]
    assert [message["rows_total"] for message in query_messages] == [4, 4, 4, 4]
    assert [message["row"] for message in query_messages] == [
        {"name": "Alice", "amount": 5, "category": "A"},
        {"name": "Bob", "amount": 12, "category": "B"},
        {"name": "Cara", "amount": 25, "category": "A"},
        {"name": "Dan", "amount": 8, "category": "C"},
    ]
    assert complete_message == {
        "type": "complete",
        "rows_processed": 4,
        "rows_sent": 4,
        "rows_total": 4,
    }


def test_ws_handles_query_filter(ws_client: TestClient) -> None:
    token = _register_login_user(ws_client)
    dataset = _upload_csv_dataset(
        ws_client,
        token,
        "name,amount,category\nAlice,5,A\nBob,12,B\nCara,25,A\nDan,8,C\n",
    )

    with ws_client.websocket_connect(
        _websocket_url(
            token=token,
            dataset_id=str(dataset["id"]),
            query="amount > 10",
            chunk_size=2,
        )
    ) as websocket:
        messages = _receive_until_complete(websocket)

    query_messages = [message for message in messages if message["type"] == "query_result"]
    complete_message = messages[-1]

    assert [message["row_index"] for message in query_messages] == [1, 2]
    assert [message["row"]["name"] for message in query_messages] == ["Bob", "Cara"]
    assert [message["row"]["amount"] for message in query_messages] == [12, 25]
    assert all(message["row"]["amount"] > 10 for message in query_messages)
    assert complete_message["type"] == "complete"
    assert complete_message["rows_processed"] == 4
    assert complete_message["rows_sent"] == 2
    assert complete_message["rows_total"] == 4
    assert complete_message["rows_sent"] < complete_message["rows_processed"]
