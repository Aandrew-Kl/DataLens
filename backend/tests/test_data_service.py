"""Dataset API and data service tests."""

from __future__ import annotations

import base64
from datetime import date, datetime
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from uuid import uuid4

import numpy as np
import pandas as pd
import pytest
from fastapi import HTTPException
from pandas.testing import assert_frame_equal

from app.api.datasets import delete_dataset, get_dataset, list_datasets
from app.schemas.dataset import DatasetCreate


BACKEND_ROOT = Path(__file__).resolve().parents[1]
_DATA_SERVICE_SPEC = spec_from_file_location("tested_data_service", BACKEND_ROOT / "app/services/data_service.py")
assert _DATA_SERVICE_SPEC is not None and _DATA_SERVICE_SPEC.loader is not None
data_service = module_from_spec(_DATA_SERVICE_SPEC)
_DATA_SERVICE_SPEC.loader.exec_module(data_service)


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


def _dataset_create(raw_bytes: bytes, *, filename: str, fmt: str | None = None) -> DatasetCreate:
    return DatasetCreate(
        filename=filename,
        format=fmt,
        content_base64=base64.b64encode(raw_bytes).decode("ascii"),
    )


def _column_info_by_name(columns) -> dict[str, object]:
    return {column.name: column for column in columns}


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


# TODO: process_upload() does not currently enforce MAX_UPLOAD_SIZE. Request-body limits are applied
# in app.main and covered by tests/test_main.py::test_request_size_limit_returns_413_for_large_payloads.
# TODO: profile_dataset() currently treats boolean columns as numeric, which makes process_upload()
# fail when boolean series reach numpy quantile calculation.


def test_to_native_converts_nested_numpy_and_pandas_values() -> None:
    converted = data_service.to_native(
        {
            7: {
                "ints": np.int64(4),
                "floats": [np.float64(2.5), np.float64(np.inf), np.float64(np.nan)],
                "bool": np.bool_(True),
                "array": np.array([np.int64(2), np.float64(3.25)]),
                "timestamp": pd.Timestamp("2024-03-01T10:15:30"),
                "datetime": datetime(2024, 3, 2, 8, 45, 10),
                "date": date(2024, 3, 3),
                "missing": pd.NA,
            }
        }
    )

    assert converted == {
        "7": {
            "ints": 4,
            "floats": [2.5, None, None],
            "bool": True,
            "array": [2, 3.25],
            "timestamp": "2024-03-01T10:15:30",
            "datetime": "2024-03-02T08:45:10",
            "date": "2024-03-03",
            "missing": None,
        }
    }


def test_filename_and_format_helpers_normalize_and_validate_inputs(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(data_service, "uuid4", lambda: SimpleNamespace(hex="generated-name"))

    assert data_service._sanitize_filename("../../my report?.csv") == "my_report_.csv"
    assert data_service._sanitize_filename("...") == "dataset-generated-name"
    assert data_service._infer_format("report.csv", None) == "csv"
    assert data_service._infer_format("report.anything", "excel") == "xlsx"

    with pytest.raises(ValueError, match="Unsupported dataset format 'yaml'"):
        data_service._infer_format("report.csv", "yaml")

    with pytest.raises(ValueError, match="Could not infer dataset format"):
        data_service._infer_format("report.txt", None)


def test_deduplicate_columns_handles_duplicates_and_blanks() -> None:
    assert data_service._deduplicate_columns([" name ", "name", "", "name", "  "]) == [
        "name",
        "name_1",
        "column",
        "name_2",
        "column_1",
    ]


def test_read_dataframe_supports_csv_and_json_payloads() -> None:
    csv_frame = data_service._read_dataframe(
        b"event_date,amount,active,score\n2024-01-01,\"1,234\",TRUE,10\n2024-01-02,\"2,500\",FALSE,15\n",
        "csv",
    )
    json_frame = data_service._read_dataframe(
        b'[{"country":"GR","users":10},{"country":"FR","users":12}]',
        "json",
    )

    assert csv_frame.dtypes.astype(str).to_dict() == {
        "event_date": "str",
        "amount": "str",
        "active": "bool",
        "score": "int64",
    }
    assert csv_frame.to_dict(orient="records")[0]["amount"] == "1,234"
    assert json_frame.to_dict(orient="records") == [
        {"country": "GR", "users": 10},
        {"country": "FR", "users": 12},
    ]


def test_read_dataframe_falls_back_to_json_loads_when_pandas_reader_rejects(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(data_service.pd, "read_json", lambda buffer: (_ for _ in ()).throw(ValueError("bad json")))

    frame = data_service._read_dataframe(
        b'[{"city":"Athens","orders":11},{"city":"Paris","orders":13}]',
        "json",
    )

    assert frame.to_dict(orient="records") == [
        {"city": "Athens", "orders": 11},
        {"city": "Paris", "orders": 13},
    ]


def test_read_dataframe_uses_excel_reader_when_available(monkeypatch: pytest.MonkeyPatch) -> None:
    expected = pd.DataFrame({"city": ["Athens", "Berlin"], "orders": [11, 14]})
    seen: dict[str, bytes] = {}

    def fake_read_excel(buffer) -> pd.DataFrame:
        seen["payload"] = buffer.read()
        return expected.copy()

    monkeypatch.setattr(data_service.pd, "read_excel", fake_read_excel)

    frame = data_service._read_dataframe(b"binary-xlsx-payload", "xlsx")

    assert seen["payload"] == b"binary-xlsx-payload"
    assert_frame_equal(frame, expected)


def test_read_dataframe_rejects_empty_and_malformed_csv() -> None:
    with pytest.raises(ValueError, match="Uploaded dataset is empty."):
        data_service._read_dataframe(b"column\n", "csv")

    with pytest.raises(UnicodeDecodeError):
        data_service._read_dataframe(b"name\n\xff\xfe\n", "csv")

    with pytest.raises(pd.errors.ParserError):
        data_service._read_dataframe(b'name,age\n"Alice,30\nBob,25\n', "csv")


def test_build_column_info_and_profile_dataset_capture_statistics() -> None:
    frame = pd.DataFrame(
        {
            "sales": [10.0, 20.0, np.nan, 40.0],
            "profit": [1, 2, 3, 4],
            "segment": ["pro", "basic", "pro", "enterprise"],
        }
    )

    columns = data_service.build_column_info(frame)
    profile = data_service.profile_dataset(frame)

    column_info = _column_info_by_name(columns)
    assert column_info["sales"].nullable is True
    assert column_info["sales"].null_count == 1
    assert column_info["sales"].sample_values == ["10.0", "20.0", "40.0"]
    assert column_info["segment"].unique_count == 3

    sales_profile = next(column for column in profile["columns"] if column["name"] == "sales")
    segment_profile = next(column for column in profile["columns"] if column["name"] == "segment")

    assert profile["row_count"] == 4
    assert profile["column_count"] == 3
    assert profile["missing_values"] == {"sales": 1, "profit": 0, "segment": 0}
    assert sales_profile["distribution"]["mean"] == 23.333333333333332
    assert sales_profile["distribution"]["quantiles"] == {"0.25": 15.0, "0.5": 20.0, "0.75": 30.0}
    assert segment_profile["distribution"]["top_values"] == {"pro": 2, "basic": 1, "enterprise": 1}
    assert profile["correlations"][0] == {
        "left": "sales",
        "right": "profit",
        "correlation": 1.0,
        "abs_correlation": 1.0,
    }
    assert profile["describe"]["sales"]["max"] == 40.0


def test_numeric_distribution_returns_empty_for_non_numeric_series() -> None:
    assert data_service._numeric_distribution(pd.Series(["north", "south"])) == {}


def test_process_upload_persists_csv_and_loads_it_back(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(data_service, "get_settings", lambda: SimpleNamespace(UPLOADS_DIR=str(tmp_path)))
    raw_bytes = (
        b"event_date,amount,segment,score,score_2\n"
        b"2024-01-01,\"1,234\",enterprise,10,20\n"
        b"2024-01-02,\"2,500\",smb,15,30\n"
        b"2024-01-03,\"3,750\",enterprise,20,40\n"
    )

    result = data_service.process_upload(_dataset_create(raw_bytes, filename="../Quarterly Report?.csv"))
    persisted_path = Path(result["file_path"])

    assert persisted_path.exists()
    assert persisted_path.parent == tmp_path.resolve()
    assert persisted_path.read_bytes() == raw_bytes
    assert result["row_count"] == 3
    assert result["column_count"] == 5
    assert result["profile"]["correlations"][0]["abs_correlation"] == 1.0

    column_info = _column_info_by_name(result["columns"])
    assert column_info["event_date"].dtype == "str"
    assert column_info["amount"].dtype == "str"
    assert column_info["segment"].dtype == "str"
    assert column_info["score"].dtype == "int64"

    reloaded = data_service.load_dataframe(result["file_path"])
    assert_frame_equal(reloaded, result["dataframe"])


def test_process_upload_is_repeatable_for_the_same_payload(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(data_service, "get_settings", lambda: SimpleNamespace(UPLOADS_DIR=str(tmp_path)))
    raw_bytes = b"name,orders\nAthens,11\nParis,13\n"
    payload = _dataset_create(raw_bytes, filename="cities.csv")

    first = data_service.process_upload(payload)
    second = data_service.process_upload(payload)

    assert first["file_path"] != second["file_path"]
    assert Path(first["file_path"]).read_bytes() == raw_bytes
    assert Path(second["file_path"]).read_bytes() == raw_bytes
    assert first["row_count"] == second["row_count"] == 2
    assert first["column_count"] == second["column_count"] == 2
    assert first["profile"] == second["profile"]
    assert_frame_equal(first["dataframe"], second["dataframe"])


def test_process_upload_rejects_invalid_base64(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(data_service, "get_settings", lambda: SimpleNamespace(UPLOADS_DIR=str(tmp_path)))

    with pytest.raises(ValueError, match="Dataset content_base64 is not valid base64."):
        data_service.process_upload(
            DatasetCreate(filename="broken.csv", content_base64="not base64!!", format="csv")
        )


def test_process_upload_rejects_empty_and_malformed_csv_before_persisting(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(data_service, "get_settings", lambda: SimpleNamespace(UPLOADS_DIR=str(tmp_path)))

    with pytest.raises(ValueError, match="Uploaded dataset is empty."):
        data_service.process_upload(_dataset_create(b"column\n", filename="empty.csv"))

    with pytest.raises(UnicodeDecodeError):
        data_service.process_upload(_dataset_create(b"name\n\xff\xfe\n", filename="bad-encoding.csv"))

    with pytest.raises(pd.errors.ParserError):
        data_service.process_upload(_dataset_create(b'name,age\n"Alice,30\nBob,25\n', filename="bad-quotes.csv"))

    assert list(tmp_path.iterdir()) == []


def test_load_dataframe_and_ensure_columns_exist_validate_inputs(tmp_path: Path) -> None:
    missing_path = tmp_path / "missing.csv"
    unsupported_path = tmp_path / "dataset.txt"
    unsupported_path.write_text("name\nAlice\n", encoding="utf-8")
    frame = pd.DataFrame({"name": ["Alice"], "orders": [11]})

    with pytest.raises(FileNotFoundError, match="does not exist"):
        data_service.load_dataframe(str(missing_path))

    with pytest.raises(ValueError, match="Unsupported dataset format 'txt'."):
        data_service.load_dataframe(str(unsupported_path))

    data_service.ensure_columns_exist(frame, ["name", "orders"])
    with pytest.raises(ValueError, match="Columns not found in dataset: total, status."):
        data_service.ensure_columns_exist(frame, ["name", "total", "status"])
