from __future__ import annotations

import pytest
from httpx import AsyncClient


pytestmark = pytest.mark.asyncio


async def test_ai_sentiment_endpoint_returns_rows(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ai/sentiment",
        json={"data": [{"text": "I love this"}], "text_column": "text"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["rows"]) == 1
    assert payload["rows"][0]["text"] == "I love this"


async def test_ai_summarize_endpoint_returns_summary_and_top_terms(
    client: AsyncClient,
    sentiment_texts: list[str],
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ai/summarize",
        json={
            "data": [{"text": text} for text in sentiment_texts],
            "text_columns": ["text"],
            "dataset_id": 1,
            "max_terms": 5,
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["summary_text"], str)
    assert payload["summary_text"]
    assert isinstance(payload["top_terms"], list)


async def test_ai_generate_query_endpoint_uses_sent_schema(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ai/generate-query",
        json={
            "schema": [
                {"name": "region", "type": "string"},
                {"name": "revenue", "type": "number"},
            ],
            "data": [],
            "question": "show revenue by region",
            "table_name": "test_table",
            "use_ollama": False,
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "sql" in payload
    assert 'SUM("revenue")' in payload["sql"]
    assert '"region"' in payload["sql"]
    assert "COUNT(*)" not in payload["sql"].upper()


async def test_ai_generate_query_endpoint_returns_count_sql_from_rows(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ai/generate-query",
        json={
            "data": [
                {"name": "Ada", "age": 31},
                {"name": "Linus", "age": 28},
            ],
            "schema": [
                {"name": "name", "type": "string"},
                {"name": "age", "type": "number"},
            ],
            "question": "how many rows",
            "table_name": "test_table",
            "use_ollama": False,
        },
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "sql" in payload
    assert "COUNT(*)" in payload["sql"].upper()


async def test_ai_explain_endpoint_returns_summary_steps_and_tables(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ai/explain",
        json={"sql": "SELECT name FROM users WHERE age > 25"},
        headers=auth_headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert isinstance(payload["summary"], str)
    assert payload["summary"]
    assert isinstance(payload["steps"], list)
    assert payload["steps"]
    assert "users" in payload["tables"]


async def test_ai_sentiment_endpoint_requires_text_column(
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    response = await client.post(
        "/ai/sentiment",
        json={"data": [{"text": "I love this"}]},
        headers=auth_headers,
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "text_column is required."
