"""Dataset CRUD unit tests with mocked database interactions."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.api.datasets import delete_dataset, get_dataset, list_datasets


def _dataset(*, user_id, name: str, file_path: str = "uploads/test.csv") -> SimpleNamespace:
    return SimpleNamespace(
        id=uuid4(),
        user_id=user_id,
        name=name,
        file_path=file_path,
        row_count=2,
        column_count=3,
    )


def _list_result(items: list[SimpleNamespace]) -> Mock:
    result = Mock()
    scalars = Mock()
    scalars.all.return_value = items
    result.scalars.return_value = scalars
    return result


def _scalar_result(item: SimpleNamespace | None) -> Mock:
    result = Mock()
    result.scalar_one_or_none.return_value = item
    return result


def _db_session(result: Mock) -> SimpleNamespace:
    return SimpleNamespace(
        execute=AsyncMock(return_value=result),
        delete=AsyncMock(),
        commit=AsyncMock(),
    )


def _compiled_params(statement) -> dict[str, object]:
    return statement.compile().params


@pytest.mark.asyncio
async def test_list_datasets_returns_rows_for_current_user() -> None:
    user_id = uuid4()
    datasets = [
        _dataset(user_id=user_id, name="orders"),
        _dataset(user_id=user_id, name="customers"),
    ]
    db = _db_session(_list_result(datasets))

    result = await list_datasets(
        db=db,
        current_user=SimpleNamespace(id=user_id),
    )

    assert result == datasets

    statement = db.execute.await_args.args[0]
    sql = str(statement)
    params = _compiled_params(statement)

    assert "FROM datasets" in sql
    assert "datasets.user_id" in sql
    assert "ORDER BY datasets.created_at DESC" in sql
    assert user_id in params.values()


@pytest.mark.asyncio
async def test_get_dataset_returns_matching_dataset() -> None:
    user_id = uuid4()
    dataset = _dataset(user_id=user_id, name="customers")
    db = _db_session(_scalar_result(dataset))

    result = await get_dataset(
        dataset_id=dataset.id,
        db=db,
        current_user=SimpleNamespace(id=user_id),
    )

    assert result is dataset

    statement = db.execute.await_args.args[0]
    params = _compiled_params(statement)

    assert dataset.id in params.values()
    assert user_id in params.values()


@pytest.mark.asyncio
async def test_get_dataset_raises_not_found_when_missing() -> None:
    user_id = uuid4()
    dataset_id = uuid4()
    db = _db_session(_scalar_result(None))

    with pytest.raises(HTTPException) as exc_info:
        await get_dataset(
            dataset_id=dataset_id,
            db=db,
            current_user=SimpleNamespace(id=user_id),
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Dataset not found."


@pytest.mark.asyncio
async def test_delete_dataset_removes_file_and_commits(tmp_path: Path) -> None:
    user_id = uuid4()
    file_path = tmp_path / "dataset.csv"
    file_path.write_text("name,amount\nAlice,5\n", encoding="utf-8")

    dataset = _dataset(user_id=user_id, name="sales", file_path=str(file_path))
    db = _db_session(_scalar_result(dataset))

    response = await delete_dataset(
        dataset_id=dataset.id,
        db=db,
        current_user=SimpleNamespace(id=user_id),
    )

    assert response.status_code == 204
    assert not file_path.exists()
    db.delete.assert_awaited_once_with(dataset)
    db.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_delete_dataset_masks_permission_denied_as_not_found() -> None:
    owner_id = uuid4()
    requesting_user_id = uuid4()
    dataset = _dataset(user_id=owner_id, name="private-data")
    db = _db_session(_scalar_result(None))

    with pytest.raises(HTTPException) as exc_info:
        await delete_dataset(
            dataset_id=dataset.id,
            db=db,
            current_user=SimpleNamespace(id=requesting_user_id),
        )

    assert exc_info.value.status_code == 404
    assert exc_info.value.detail == "Dataset not found."
    db.delete.assert_not_awaited()
    db.commit.assert_not_awaited()

    statement = db.execute.await_args.args[0]
    params = _compiled_params(statement)

    assert dataset.id in params.values()
    assert requesting_user_id in params.values()
