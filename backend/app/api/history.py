"""Query history persistence routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.api.deps import get_owned_dataset
from app.api.docs import build_error_responses
from app.database import get_db
from app.middleware.rate_limit import limiter
from app.models.query_history import QueryHistory
from app.models.user import User
from app.schemas.history import QueryHistoryCreate, QueryHistoryRead


MAX_HISTORY_ITEMS = 50

router = APIRouter(prefix="/history", tags=["history"])


@router.get(
    "",
    response_model=list[QueryHistoryRead],
    status_code=status.HTTP_200_OK,
    summary="List query history",
    description="Return the most recent query history entries for the authenticated user.",
    response_description="The authenticated user's query history.",
    responses=build_error_responses(
        unauthorized="Authentication is required to list query history.",
    ),
)
@limiter.limit("60/minute")
async def list_query_history(
    request: Request,
    limit: int = MAX_HISTORY_ITEMS,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[QueryHistoryRead]:
    safe_limit = max(1, min(limit, MAX_HISTORY_ITEMS))
    result = await db.execute(
        select(QueryHistory)
        .where(QueryHistory.user_id == current_user.id)
        .order_by(QueryHistory.created_at.desc(), QueryHistory.id.desc())
        .limit(safe_limit)
    )
    return list(result.scalars().all())


@router.post(
    "",
    response_model=QueryHistoryRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a query history entry",
    description="Persist a new query history entry for the authenticated user and keep only the most recent entries.",
    response_description="The persisted query history entry.",
    responses=build_error_responses(
        unauthorized="Authentication is required to save query history.",
        not_found="The referenced dataset was not found.",
    ),
)
@limiter.limit("60/minute")
async def create_query_history_entry(
    request: Request,
    payload: QueryHistoryCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> QueryHistory:
    await get_owned_dataset(db, current_user.id, payload.dataset_id)

    entry = QueryHistory(
        user_id=current_user.id,
        dataset_id=payload.dataset_id,
        question=payload.question,
        sql_text=payload.sql_text,
        duration_ms=payload.duration_ms,
    )
    db.add(entry)
    await db.flush()

    stale_ids = list(
        (
            await db.execute(
                select(QueryHistory.id)
                .where(QueryHistory.user_id == current_user.id)
                .order_by(QueryHistory.created_at.desc(), QueryHistory.id.desc())
                .offset(MAX_HISTORY_ITEMS)
            )
        )
        .scalars()
        .all()
    )
    if stale_ids:
        await db.execute(delete(QueryHistory).where(QueryHistory.id.in_(stale_ids)))

    await db.commit()
    await db.refresh(entry)
    return entry


@router.delete(
    "/{history_id}",
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a query history entry",
    description="Delete a query history entry that belongs to the authenticated user.",
    response_description="The query history entry was deleted successfully.",
    responses=build_error_responses(
        unauthorized="Authentication is required to delete query history.",
        not_found="No query history entry was found for the provided identifier.",
    ),
)
@limiter.limit("30/minute")
async def delete_query_history_entry(
    request: Request,
    history_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    result = await db.execute(
        select(QueryHistory).where(
            QueryHistory.id == history_id,
            QueryHistory.user_id == current_user.id,
        )
    )
    entry = result.scalar_one_or_none()
    if entry is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Query history entry not found.",
        )

    await db.delete(entry)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
