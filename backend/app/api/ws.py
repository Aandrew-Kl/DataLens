"""WebSocket endpoint for real-time query streaming."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect, status
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.websockets import WebSocketState

from app.database import get_db
from app.models.dataset import Dataset
from app.models.user import User
from app.services.stream_service import stream_csv_rows
from app.utils.security import decode_access_token


router = APIRouter(tags=["websocket"])


async def _authenticate_user(token: str, db: AsyncSession) -> User | None:
    """Validate a websocket token and return the matching user."""

    try:
        payload = decode_access_token(token)
        subject = payload.get("sub")
        if not subject:
            return None
        user_id = uuid.UUID(str(subject))
    except (JWTError, ValueError, TypeError):
        return None

    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


@router.websocket("/ws/data-stream")
async def data_stream_websocket(
    websocket: WebSocket,
    token: str = Query(...),
    dataset_id: uuid.UUID = Query(...),
    query: str | None = Query(default=None),
    chunk_size: int = Query(default=500, ge=1, le=5000),
    db: AsyncSession = Depends(get_db),
) -> None:
    user = await _authenticate_user(token=token, db=db)
    if user is None:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Invalid authentication token.",
        )
        return

    await websocket.accept()

    result = await db.execute(
        select(Dataset).where(
            Dataset.id == dataset_id,
            Dataset.user_id == user.id,
        )
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        await websocket.close(
            code=status.WS_1008_POLICY_VIOLATION,
            reason="Dataset not found or access denied.",
        )
        return

    try:
        stream_summary = await stream_csv_rows(
            websocket=websocket,
            file_path=dataset.file_path,
            query=query,
            chunk_size=chunk_size,
        )
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.send_json(
                {
                    "type": "complete",
                    "rows_processed": stream_summary["rows_processed"],
                    "rows_sent": stream_summary["rows_sent"],
                    "rows_total": stream_summary["total_rows"],
                }
            )
    except ValueError as exc:
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.send_json({"type": "error", "message": str(exc)})
            await websocket.close(
                code=status.WS_1003_UNSUPPORTED_DATA,
                reason="Invalid stream request.",
            )
    except WebSocketDisconnect:
        return
    except Exception as exc:
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.close(
                code=status.WS_1011_INTERNAL_ERROR,
                reason=str(exc),
            )
    finally:
        if websocket.client_state != WebSocketState.DISCONNECTED:
            await websocket.close()
