from __future__ import annotations

from pathlib import Path

import pytest
from httpx import AsyncClient

from app.api import datasets as datasets_api


pytestmark = pytest.mark.asyncio


def _csv_bytes() -> bytes:
    return b"name,age\nAlice,30\nBob,25\n"


@pytest.fixture(autouse=True)
def _isolated_upload_dir(monkeypatch: pytest.MonkeyPatch, tmp_path) -> None:
    monkeypatch.setattr(datasets_api, "UPLOAD_DIR", tmp_path)


@pytest.mark.xfail(
    strict=True,
    reason="Dataset upload still reflects raw filename stems and paths in the JSON response.",
)
async def test_upload_filename_payload_is_not_reflected_in_response(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    payload_filename = "<script>alert('xss')</script>.csv"

    response = await client.post(
        "/datasets/upload",
        headers=auth_headers,
        files={"file": (payload_filename, _csv_bytes(), "text/csv")},
    )

    assert response.status_code == 201
    response_text = response.text.lower()
    assert "<script>" not in response_text
    assert "onerror=" not in response_text
    assert "onload=" not in response_text
    assert "javascript:" not in response_text

    payload = response.json()
    stored_path = Path(payload["file_path"])
    assert stored_path.name.endswith(".csv")
    assert "/" not in stored_path.name
    assert "\\" not in stored_path.name


@pytest.mark.xfail(
    strict=True,
    reason="AI SQL generation still reflects raw WHERE-clause injection fragments into generated SQL.",
)
async def test_generate_query_rejects_sql_injection_patterns(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ai/generate-query",
        headers=auth_headers,
        json={
            "data": [
                {"name": "Ada", "age": 31},
                {"name": "Linus", "age": 28},
            ],
            "question": "how many rows where 1=1; DROP TABLE users; --",
            "table_name": "test_table",
            "use_ollama": False,
        },
    )

    if response.status_code == 400:
        assert response.json()["detail"]
        return

    assert response.status_code == 200
    payload = response.json()
    assert "sql" in payload
    assert "DROP TABLE" not in payload["sql"].upper()
    assert "--" not in payload["sql"]
