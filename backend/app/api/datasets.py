import io
import uuid
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.auth import get_current_user
from app.api.docs import build_error_responses
from app.database import get_db
from app.models.dataset import Dataset
from app.models.user import User
from app.schemas.dataset import DatasetResponse


router = APIRouter(prefix="/datasets", tags=["datasets"])
UPLOAD_DIR = Path("uploads")


@router.post(
    "/upload",
    response_model=DatasetResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Upload a dataset",
    description="Upload a CSV file, store it on disk, and create dataset metadata for the authenticated user.",
    response_description="The stored dataset metadata.",
    responses=build_error_responses(
        bad_request="The uploaded file is missing, is not a CSV file, or could not be parsed.",
        unauthorized="Authentication is required to upload a dataset.",
    ),
)
async def upload_dataset(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dataset:
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded file must have a filename.")
    if not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only CSV uploads are supported.")

    contents = await file.read()
    try:
        dataframe = pd.read_csv(io.BytesIO(contents))
    except Exception as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unable to parse CSV file.") from exc

    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    safe_filename = file.filename.replace("/", "_").replace("\\", "_").replace("\0", "_")
    file_id = f"{uuid.uuid4()}_{safe_filename}"
    upload_dir = UPLOAD_DIR.resolve()
    file_path = (UPLOAD_DIR / file_id).resolve()
    if not str(file_path).startswith(str(upload_dir)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid filename.")
    file_path.write_bytes(contents)

    dataset = Dataset(
        user_id=current_user.id,
        name=name or Path(file.filename).stem,
        file_path=str(file_path),
        row_count=int(len(dataframe)),
        column_count=int(len(dataframe.columns)),
    )
    db.add(dataset)
    await db.commit()
    await db.refresh(dataset)
    return dataset


@router.get(
    "/",
    response_model=list[DatasetResponse],
    status_code=status.HTTP_200_OK,
    summary="List datasets",
    description="Return all datasets that belong to the authenticated user, ordered by newest first.",
    response_description="A list of datasets owned by the authenticated user.",
    responses=build_error_responses(
        unauthorized="Authentication is required to list datasets.",
    ),
)
async def list_datasets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[Dataset]:
    result = await db.execute(
        select(Dataset).where(Dataset.user_id == current_user.id).order_by(Dataset.created_at.desc())
    )
    return list(result.scalars().all())


@router.get(
    "/{dataset_id}",
    response_model=DatasetResponse,
    status_code=status.HTTP_200_OK,
    summary="Get a dataset",
    description="Fetch a single dataset owned by the authenticated user.",
    response_description="The requested dataset metadata.",
    responses=build_error_responses(
        unauthorized="Authentication is required to access dataset details.",
        not_found="No dataset was found for the provided identifier.",
    ),
)
async def get_dataset(
    dataset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Dataset:
    result = await db.execute(
        select(Dataset).where(Dataset.id == dataset_id, Dataset.user_id == current_user.id)
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found.")
    return dataset


@router.delete(
    "/{dataset_id}",
    response_model=None,
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a dataset",
    description="Delete a dataset record and remove its uploaded file from storage.",
    response_description="The dataset was deleted successfully.",
    responses=build_error_responses(
        unauthorized="Authentication is required to delete a dataset.",
        not_found="No dataset was found for the provided identifier.",
    ),
)
async def delete_dataset(
    dataset_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    result = await db.execute(
        select(Dataset).where(Dataset.id == dataset_id, Dataset.user_id == current_user.id)
    )
    dataset = result.scalar_one_or_none()
    if dataset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found.")

    file_path = Path(dataset.file_path)
    if file_path.exists():
        file_path.unlink()

    await db.delete(dataset)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
