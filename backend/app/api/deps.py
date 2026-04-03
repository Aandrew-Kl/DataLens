"""Shared API helpers."""

from __future__ import annotations

from fastapi import HTTPException, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.analysis import SavedAnalysis
from app.models.dataset import Dataset
from app.models.query_history import QueryHistory


async def get_owned_dataset(db: AsyncSession, user_id: int, dataset_id: int) -> Dataset:
    """Fetch a dataset owned by the current user or raise a 404."""

    result = await db.execute(
        select(Dataset).where(Dataset.id == dataset_id, Dataset.user_id == user_id)
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found.",
        )
    return dataset


async def save_analysis(
    db: AsyncSession,
    *,
    user_id: int,
    dataset_id: int,
    analysis_type: str,
    config: dict,
    result: dict,
) -> None:
    """Persist an analysis result without affecting the API response."""

    db.add(
        SavedAnalysis(
            user_id=user_id,
            dataset_id=dataset_id,
            analysis_type=analysis_type,
            config_json=jsonable_encoder(config),
            result_json=jsonable_encoder(result),
        )
    )
    await db.commit()


async def save_query(
    db: AsyncSession,
    *,
    user_id: int,
    dataset_id: int,
    sql_text: str,
    duration_ms: int,
) -> None:
    """Persist generated query history."""

    db.add(
        QueryHistory(
            user_id=user_id,
            dataset_id=dataset_id,
            sql_text=sql_text,
            duration_ms=duration_ms,
        )
    )
    await db.commit()
