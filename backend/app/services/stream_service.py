"""Streaming utilities for websocket-based dataset and query result delivery."""

from __future__ import annotations

from pathlib import Path

import pandas as pd

from app.services.data_service import to_native


def _count_rows(path: Path) -> int:
    """Return the number of data rows in a CSV file."""

    with path.open("r", encoding="utf-8") as handle:
        total_lines = sum(1 for _ in handle)
    return max(total_lines - 1, 0)


def _clamp_percent(value: int) -> int:
    """Clamp progress percent into the inclusive 0-100 range."""

    if value < 0:
        return 0
    if value > 100:
        return 100
    return value


async def send_profiling_progress(
    websocket,
    *,
    percent: int,
    rows_processed: int,
    total_rows: int,
) -> None:
    """Send a profiling progress event."""

    await websocket.send_json(
        {
            "type": "profiling",
            "percent": _clamp_percent(percent),
            "rows_processed": rows_processed,
            "rows_total": total_rows,
        }
    )


async def broadcast_query_results(
    websocket,
    *,
    row_index: int,
    row: dict,
    rows_total: int,
) -> None:
    """Send one query-result row to websocket clients."""

    await websocket.send_json(
        {
            "type": "query_result",
            "row_index": row_index,
            "rows_total": rows_total,
            "row": row,
        }
    )


async def stream_csv_rows(
    websocket,
    *,
    file_path: str,
    query: str | None = None,
    chunk_size: int = 500,
    progress_step: int = 5,
) -> dict[str, int]:
    """Stream a CSV file row-by-row with progress updates over a websocket."""

    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Dataset file '{file_path}' does not exist.")

    total_rows = _count_rows(path)
    await send_profiling_progress(
        websocket,
        percent=0,
        rows_processed=0,
        total_rows=total_rows,
    )

    rows_processed = 0
    rows_sent = 0
    last_percent = 0

    for chunk in pd.read_csv(path, chunksize=chunk_size):
        rows_processed += int(len(chunk))
        working = chunk

        if query:
            try:
                working = chunk.query(query)
            except Exception as exc:
                raise ValueError(f"Invalid query expression: {exc}") from exc

        if not working.empty:
            for row in working.to_dict(orient="records"):
                rows_sent += 1
                await broadcast_query_results(
                    websocket,
                    row_index=rows_sent,
                    row=to_native(row),
                    rows_total=total_rows,
                )

        processed_percent = int((rows_processed / total_rows) * 100) if total_rows else 100
        if processed_percent - last_percent >= progress_step:
            last_percent = processed_percent
            await send_profiling_progress(
                websocket,
                percent=last_percent,
                rows_processed=rows_processed,
                total_rows=total_rows,
            )

    await send_profiling_progress(
        websocket,
        percent=100,
        rows_processed=rows_processed,
        total_rows=total_rows,
    )

    return {
        "rows_processed": rows_processed,
        "rows_sent": rows_sent,
        "total_rows": total_rows,
    }
