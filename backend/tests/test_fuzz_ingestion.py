"""Property-based fuzz coverage for malformed dataset ingestion."""

from __future__ import annotations

import base64
from importlib.util import find_spec, module_from_spec, spec_from_file_location
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

pytest.importorskip("hypothesis", reason="Hypothesis is required for fuzz ingestion tests.")

from hypothesis import given, settings
from hypothesis import strategies as st

from app.schemas.dataset import DatasetCreate


BACKEND_ROOT = Path(__file__).resolve().parents[1]
_DATA_SERVICE_SPEC = spec_from_file_location("tested_data_service", BACKEND_ROOT / "app/services/data_service.py")
assert _DATA_SERVICE_SPEC is not None and _DATA_SERVICE_SPEC.loader is not None
data_service = module_from_spec(_DATA_SERVICE_SPEC)
_DATA_SERVICE_SPEC.loader.exec_module(data_service)

_DATA_INGESTION_ERROR = getattr(data_service, "DataIngestionError", None)
_ALLOWED_REJECTIONS = tuple(
    exc for exc in (HTTPException, _DATA_INGESTION_ERROR) if isinstance(exc, type)
)
_OPENPYXL_AVAILABLE = find_spec("openpyxl") is not None


def _dataset_create(raw_bytes: bytes, *, filename: str) -> DatasetCreate:
    return DatasetCreate(
        filename=filename,
        content_base64=base64.b64encode(raw_bytes).decode("ascii"),
    )


def _assert_process_upload_contract(raw_bytes: bytes, *, filename: str) -> None:
    payload = _dataset_create(raw_bytes, filename=filename)
    with TemporaryDirectory() as upload_dir:
        with patch.object(data_service, "get_settings", return_value=SimpleNamespace(UPLOADS_DIR=upload_dir)):
            try:
                result = data_service.process_upload(payload)
            except _ALLOWED_REJECTIONS as exc:
                if isinstance(exc, HTTPException):
                    assert 400 <= exc.status_code < 500
                return
            except Exception as exc:  # pragma: no cover - exercised via xfail until service normalizes errors
                pytest.fail(
                    f"Unhandled {type(exc).__name__} escaped process_upload() for {filename}: {exc}"
                )

    assert isinstance(result, dict)
    assert Path(result["file_path"]).exists()
    assert not result["dataframe"].empty


@st.composite
def malformed_csv_bytes(draw) -> bytes:
    random_bytes = st.binary(min_size=0, max_size=1024)
    bom_only = st.sampled_from([b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff", b"\x00\x00\xfe\xff"])
    embedded_nul = st.builds(
        lambda left, right: left + b"\x00" + right,
        st.binary(max_size=256),
        st.binary(max_size=256),
    )
    unterminated_quotes = st.builds(
        lambda header, body: header + b"\n\"" + body,
        st.binary(min_size=1, max_size=24),
        st.binary(max_size=256),
    )
    long_line = st.integers(min_value=2048, max_value=8192).map(
        lambda size: b"column\n" + (b"A" * size) + b"\n"
    )
    mixed_encoding = st.one_of(
        st.text(max_size=128).map(lambda text: text.encode("utf-16", errors="ignore")),
        st.text(max_size=128).map(lambda text: text.encode("utf-32", errors="ignore")),
        st.text(max_size=128).map(lambda text: text.encode("latin-1", errors="ignore")),
    )

    return draw(
        st.one_of(
            random_bytes,
            bom_only,
            embedded_nul,
            unterminated_quotes,
            long_line,
            mixed_encoding,
            st.just(b""),
        )
    )


@st.composite
def malformed_xlsx_bytes(draw) -> bytes:
    random_bytes = st.binary(min_size=0, max_size=2048)
    partial_zip = st.builds(
        lambda prefix, tail: prefix + tail,
        st.sampled_from(
            [
                b"PK\x03\x04",
                b"PK\x03\x04\x14\x00\x00\x00\x00\x00",
                b"PK\x05\x06",
            ]
        ),
        st.binary(max_size=512),
    )
    truncated_workbook = st.binary(min_size=1, max_size=512).map(
        lambda tail: b"[Content_Types].xmlPK\x03\x04" + tail
    )

    return draw(
        st.one_of(
            random_bytes,
            partial_zip,
            truncated_workbook,
            st.just(b""),
        )
    )


# TODO: process_upload() should normalize malformed CSV parser/profile failures into a 4xx HTTPException
# or a dedicated DataIngestionError instead of leaking pandas/parser exceptions.
@pytest.mark.xfail(reason="Malformed CSV uploads still leak unhandled parser/profile exceptions.")
@given(raw_bytes=malformed_csv_bytes())
@settings(deadline=3000, max_examples=30)
def test_process_upload_handles_fuzzed_malformed_csv_bytes(raw_bytes: bytes) -> None:
    _assert_process_upload_contract(raw_bytes, filename="fuzz.csv")


# TODO: process_upload() should normalize malformed XLSX parser failures into a 4xx HTTPException
# or a dedicated DataIngestionError instead of leaking openpyxl/zip/pandas exceptions.
@pytest.mark.skipif(not _OPENPYXL_AVAILABLE, reason="XLSX fuzzing requires openpyxl.")
@pytest.mark.xfail(reason="Malformed XLSX uploads still leak unhandled parser exceptions.")
@given(raw_bytes=malformed_xlsx_bytes())
@settings(deadline=3000, max_examples=30)
def test_process_upload_handles_fuzzed_malformed_xlsx_bytes(raw_bytes: bytes) -> None:
    _assert_process_upload_contract(raw_bytes, filename="fuzz.xlsx")
