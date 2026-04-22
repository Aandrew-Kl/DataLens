"""Pipeline persistence routes."""

from __future__ import annotations

from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.api.docs import build_error_responses
from app.database import get_db
from app.middleware.rate_limit import limiter
from app.models.pipeline import Pipeline
from app.models.user import User
from app.schemas.pipeline import PipelineCreate, PipelineRead, PipelineUpdate


router = APIRouter(prefix="/pipelines", tags=["pipelines"])


@router.get(
    "",
    response_model=list[PipelineRead],
    status_code=status.HTTP_200_OK,
    summary="List pipelines",
    description="Return all saved pipelines that belong to the authenticated user.",
    response_description="The authenticated user's saved pipelines.",
    responses=build_error_responses(
        unauthorized="Authentication is required to list pipelines.",
    ),
)
@limiter.limit("60/minute")
async def list_pipelines(
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[PipelineRead]:
    result = await db.execute(
        select(Pipeline)
        .where(Pipeline.user_id == current_user.id)
        .order_by(Pipeline.updated_at.desc(), Pipeline.created_at.desc())
    )
    return list(result.scalars().all())


@router.post(
    "",
    response_model=PipelineRead,
    status_code=status.HTTP_201_CREATED,
    summary="Create a pipeline",
    description="Create a new saved pipeline for the authenticated user.",
    response_description="The created pipeline.",
    responses=build_error_responses(
        unauthorized="Authentication is required to create pipelines.",
        extra={409: "A pipeline with the provided identifier already exists."},
    ),
)
@limiter.limit("30/minute")
async def create_pipeline(
    request: Request,
    payload: PipelineCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Pipeline:
    pipeline_id = payload.id or str(uuid4())
    if payload.id is not None:
        result = await db.execute(select(Pipeline).where(Pipeline.id == pipeline_id))
        existing_pipeline = result.scalar_one_or_none()
        if existing_pipeline is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Pipeline already exists.",
            )

    pipeline = Pipeline(id=pipeline_id, user_id=current_user.id)
    db.add(pipeline)

    pipeline.name = payload.name
    pipeline.steps = payload.steps

    await db.commit()
    await db.refresh(pipeline)
    return pipeline


@router.patch(
    "/{pipeline_id}",
    response_model=PipelineRead,
    status_code=status.HTTP_200_OK,
    summary="Update a pipeline",
    description="Update an existing saved pipeline that belongs to the authenticated user.",
    response_description="The updated pipeline.",
    responses=build_error_responses(
        unauthorized="Authentication is required to update pipelines.",
        not_found="No pipeline was found for the provided identifier.",
    ),
)
@limiter.limit("30/minute")
async def update_pipeline(
    request: Request,
    pipeline_id: str,
    payload: PipelineUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Pipeline:
    result = await db.execute(
        select(Pipeline).where(
            Pipeline.id == pipeline_id,
            Pipeline.user_id == current_user.id,
        )
    )
    pipeline = result.scalar_one_or_none()
    if pipeline is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found.")

    pipeline.name = payload.name
    pipeline.steps = payload.steps

    await db.commit()
    await db.refresh(pipeline)
    return pipeline


@router.delete(
    "/{pipeline_id}",
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a pipeline",
    description="Delete a pipeline that belongs to the authenticated user.",
    response_description="The pipeline was deleted successfully.",
    responses=build_error_responses(
        unauthorized="Authentication is required to delete pipelines.",
        not_found="No pipeline was found for the provided identifier.",
    ),
)
@limiter.limit("30/minute")
async def delete_pipeline(
    request: Request,
    pipeline_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    result = await db.execute(
        select(Pipeline).where(
            Pipeline.id == pipeline_id,
            Pipeline.user_id == current_user.id,
        )
    )
    pipeline = result.scalar_one_or_none()
    if pipeline is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Pipeline not found.")

    await db.delete(pipeline)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
