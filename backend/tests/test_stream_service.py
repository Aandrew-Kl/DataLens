"""Direct streaming service tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from app.services.stream_service import stream_csv_rows


class FakeWebSocket:
    def __init__(self) -> None:
        self.messages: list[dict[str, object]] = []

    async def send_json(self, payload: dict[str, object]) -> None:
        self.messages.append(payload)


def _write_csv(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8")


@pytest.mark.asyncio
async def test_stream_csv_rows_sends_all_rows_and_final_progress(tmp_path: Path) -> None:
    file_path = tmp_path / "rows.csv"
    _write_csv(file_path, "name,amount\nAlice,5\nBob,12\nCara,25\n")
    websocket = FakeWebSocket()

    summary = await stream_csv_rows(
        websocket,
        file_path=str(file_path),
        chunk_size=2,
        progress_step=101,
    )

    assert summary == {
        "rows_processed": 3,
        "rows_sent": 3,
        "total_rows": 3,
    }
    assert websocket.messages[0] == {
        "type": "profiling",
        "percent": 0,
        "rows_processed": 0,
        "rows_total": 3,
    }
    assert websocket.messages[-1] == {
        "type": "profiling",
        "percent": 100,
        "rows_processed": 3,
        "rows_total": 3,
    }

    query_messages = [message for message in websocket.messages if message["type"] == "query_result"]
    assert [message["row_index"] for message in query_messages] == [1, 2, 3]
    assert [message["row"] for message in query_messages] == [
        {"name": "Alice", "amount": 5},
        {"name": "Bob", "amount": 12},
        {"name": "Cara", "amount": 25},
    ]


@pytest.mark.asyncio
async def test_stream_csv_rows_filters_rows_with_query(tmp_path: Path) -> None:
    file_path = tmp_path / "filtered.csv"
    _write_csv(file_path, "name,amount,category\nAlice,5,A\nBob,12,B\nCara,25,A\nDan,8,C\n")
    websocket = FakeWebSocket()

    summary = await stream_csv_rows(
        websocket,
        file_path=str(file_path),
        query="amount > 10",
        chunk_size=2,
        progress_step=101,
    )

    query_messages = [message for message in websocket.messages if message["type"] == "query_result"]

    assert summary == {
        "rows_processed": 4,
        "rows_sent": 2,
        "total_rows": 4,
    }
    assert [message["row_index"] for message in query_messages] == [1, 2]
    assert [message["row"] for message in query_messages] == [
        {"name": "Bob", "amount": 12, "category": "B"},
        {"name": "Cara", "amount": 25, "category": "A"},
    ]


@pytest.mark.asyncio
async def test_stream_csv_rows_rejects_disallowed_query_patterns(tmp_path: Path) -> None:
    file_path = tmp_path / "unsafe.csv"
    _write_csv(file_path, "name,amount\nAlice,5\n")
    websocket = FakeWebSocket()

    with pytest.raises(ValueError, match="disallowed patterns"):
        await stream_csv_rows(
            websocket,
            file_path=str(file_path),
            query="__import__('os').system('echo nope')",
        )

    assert websocket.messages == [
        {
            "type": "profiling",
            "percent": 0,
            "rows_processed": 0,
            "rows_total": 1,
        }
    ]


@pytest.mark.asyncio
async def test_stream_csv_rows_raises_for_missing_file() -> None:
    websocket = FakeWebSocket()

    with pytest.raises(FileNotFoundError, match="does not exist"):
        await stream_csv_rows(
            websocket,
            file_path="/tmp/definitely-missing-stream-file.csv",
        )

    assert websocket.messages == []
