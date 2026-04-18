"""Bookmark persistence routes."""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.api.deps import get_owned_dataset
from app.api.docs import build_error_responses
from app.database import get_db
from app.middleware.rate_limit import limiter
from app.models.bookmark import Bookmark
from app.models.user import User
from app.schemas.bookmark import BookmarkCreate, BookmarkRead


router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])


@router.get(
    "",
    response_model=list[BookmarkRead],
    status_code=status.HTTP_200_OK,
    summary="List bookmarks",
    description="Return all bookmarks that belong to the authenticated user.",
    response_description="The authenticated user's bookmarks.",
    responses=build_error_responses(
        unauthorized="Authentication is required to list bookmarks.",
    ),
)
@limiter.limit("60/minute")
async def list_bookmarks(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[BookmarkRead]:
    result = await db.execute(
        select(Bookmark)
        .where(Bookmark.user_id == current_user.id)
        .order_by(Bookmark.updated_at.desc(), Bookmark.created_at.desc())
    )
    return list(result.scalars().all())


@router.post(
    "",
    response_model=BookmarkRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create or update a bookmark",
    description="Create a new bookmark or replace an existing bookmark owned by the authenticated user.",
    response_description="The persisted bookmark.",
    responses=build_error_responses(
        unauthorized="Authentication is required to save bookmarks.",
        not_found="The referenced dataset was not found.",
    ),
)
@limiter.limit("30/minute")
async def create_or_update_bookmark(
    request: Request,
    payload: BookmarkCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Bookmark:
    if payload.dataset_id is not None:
        await get_owned_dataset(db, current_user.id, payload.dataset_id)

    bookmark_id = payload.id or str(uuid4())
    result = await db.execute(
        select(Bookmark).where(
            Bookmark.id == bookmark_id,
            Bookmark.user_id == current_user.id,
        )
    )
    bookmark = result.scalar_one_or_none()

    if bookmark is None:
        bookmark = Bookmark(id=bookmark_id, user_id=current_user.id)
        db.add(bookmark)

    bookmark.dataset_id = payload.dataset_id
    bookmark.table_name = payload.table_name
    bookmark.label = payload.label
    bookmark.description = payload.description
    bookmark.column_name = payload.column_name
    bookmark.sql_text = payload.sql_text
    bookmark.view_state = payload.view_state

    await db.commit()
    await db.refresh(bookmark)
    return bookmark


@router.delete(
    "/{bookmark_id}",
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a bookmark",
    description="Delete a bookmark that belongs to the authenticated user.",
    response_description="The bookmark was deleted successfully.",
    responses=build_error_responses(
        unauthorized="Authentication is required to delete bookmarks.",
        not_found="No bookmark was found for the provided identifier.",
    ),
)
@limiter.limit("30/minute")
async def delete_bookmark(
    request: Request,
    bookmark_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    result = await db.execute(
        select(Bookmark).where(
            Bookmark.id == bookmark_id,
            Bookmark.user_id == current_user.id,
        )
    )
    bookmark = result.scalar_one_or_none()
    if bookmark is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bookmark not found.")

    await db.delete(bookmark)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
