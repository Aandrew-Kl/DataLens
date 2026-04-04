"""Dataset upload, loading, and profiling helpers."""

from __future__ import annotations

import base64
import json
import math
import re
import logging
from datetime import date, datetime
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import numpy as np
import pandas as pd

from app.config import get_settings
from app.schemas.dataset import ColumnInfo, DatasetCreate

logger = logging.getLogger(__name__)

SUPPORTED_FORMATS = {"csv", "json", "xlsx", "xls", "excel"}
_SANITIZE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def to_native(value):
    """Recursively convert pandas and numpy values into JSON-safe Python objects."""

    if isinstance(value, dict):
        return {str(key): to_native(inner) for key, inner in value.items()}
    if isinstance(value, list | tuple | set):
        return [to_native(item) for item in value]
    if isinstance(value, np.ndarray):
        return [to_native(item) for item in value.tolist()]
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        if math.isinf(float(value)) or math.isnan(float(value)):
            return None
        return float(value)
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, datetime | date):
        return value.isoformat()
    if pd.isna(value):
        return None
    return value


def _sanitize_filename(filename: str) -> str:
    """Generate a filesystem-safe filename."""

    safe_name = _SANITIZE_RE.sub("_", Path(filename).name).strip("._")
    return safe_name or f"dataset-{uuid4().hex}"


def _infer_format(filename: str, explicit_format: str | None) -> str:
    """Infer the dataset serialization format."""

    if explicit_format:
        fmt = explicit_format.lower()
        if fmt not in SUPPORTED_FORMATS:
            raise ValueError(f"Unsupported dataset format '{explicit_format}'.")
        return "xlsx" if fmt == "excel" else fmt

    suffix = Path(filename).suffix.lower().lstrip(".")
    if suffix in {"csv", "json", "xlsx", "xls"}:
        return suffix
    raise ValueError("Could not infer dataset format. Provide filename with csv/json/xlsx/xls extension.")


def _deduplicate_columns(columns: list[str]) -> list[str]:
    """Ensure dataframe column names are unique and human-readable."""

    seen: dict[str, int] = {}
    deduped: list[str] = []
    for column in columns:
        base = str(column).strip() or "column"
        counter = seen.get(base, 0)
        deduped.append(base if counter == 0 else f"{base}_{counter}")
        seen[base] = counter + 1
    return deduped


def _read_dataframe(raw_bytes: bytes, fmt: str) -> pd.DataFrame:
    """Read dataframe bytes using pandas based on the supplied format."""

    buffer = BytesIO(raw_bytes)
    if fmt == "csv":
        frame = pd.read_csv(buffer)
    elif fmt == "json":
        try:
            frame = pd.read_json(buffer)
        except ValueError:
            payload = json.loads(raw_bytes.decode("utf-8"))
            frame = pd.DataFrame(payload)
    elif fmt in {"xlsx", "xls"}:
        frame = pd.read_excel(buffer)
    else:  # pragma: no cover - guarded by _infer_format
        raise ValueError(f"Unsupported format '{fmt}'.")

    if frame.empty:
        raise ValueError("Uploaded dataset is empty.")

    frame.columns = _deduplicate_columns([str(column) for column in frame.columns])
    return frame


def build_column_info(frame: pd.DataFrame) -> list[ColumnInfo]:
    """Build rich column metadata for a dataframe."""

    columns: list[ColumnInfo] = []
    for column_name in frame.columns:
        series = frame[column_name]
        sample_values = [str(value) for value in series.dropna().astype(str).head(3).tolist()]
        columns.append(
            ColumnInfo(
                name=column_name,
                dtype=str(series.dtype),
                nullable=bool(series.isna().any()),
                null_count=int(series.isna().sum()),
                unique_count=int(series.nunique(dropna=True)),
                sample_values=sample_values,
            )
        )
    return columns


def _numeric_distribution(series: pd.Series) -> dict:
    """Return numeric distribution details for a series."""

    cleaned = pd.to_numeric(series, errors="coerce").dropna()
    if cleaned.empty:
        return {}
    quantiles = cleaned.quantile([0.25, 0.5, 0.75]).to_dict()
    return to_native(
        {
            "mean": cleaned.mean(),
            "std": cleaned.std(ddof=0),
            "min": cleaned.min(),
            "max": cleaned.max(),
            "quantiles": quantiles,
        }
    )


def _categorical_distribution(series: pd.Series) -> dict:
    """Return categorical distribution details for a series."""

    value_counts = series.astype(str).fillna("null").value_counts(dropna=False).head(10)
    return {"top_values": to_native(value_counts.to_dict())}


def profile_dataset(frame: pd.DataFrame) -> dict:
    """Generate a production-grade profile for the supplied dataframe."""

    logger.info("Profiling dataset: %d rows, %d columns", frame.shape[0], frame.shape[1])

    describe_frame = frame.describe(include="all", datetime_is_numeric=True).transpose()
    describe = to_native(
        describe_frame.replace([np.inf, -np.inf], np.nan).where(pd.notna(describe_frame), None).to_dict(orient="index")
    )

    columns: list[dict] = []
    for column_name in frame.columns:
        series = frame[column_name]
        is_numeric = pd.api.types.is_numeric_dtype(series)
        distribution = _numeric_distribution(series) if is_numeric else _categorical_distribution(series)
        columns.append(
            {
                "name": column_name,
                "dtype": str(series.dtype),
                "null_count": int(series.isna().sum()),
                "null_pct": round(float(series.isna().mean() * 100), 4),
                "unique_count": int(series.nunique(dropna=True)),
                "distribution": distribution,
            }
        )

    numeric_frame = frame.select_dtypes(include=[np.number])
    correlations: list[dict] = []
    if numeric_frame.shape[1] >= 2:
        corr = numeric_frame.corr(numeric_only=True).replace([np.inf, -np.inf], np.nan)
        visited: set[tuple[str, str]] = set()
        for left in corr.columns:
            for right in corr.columns:
                if left == right or (right, left) in visited:
                    continue
                coefficient = corr.loc[left, right]
                if pd.isna(coefficient):
                    continue
                visited.add((left, right))
                correlations.append(
                    {
                        "left": left,
                        "right": right,
                        "correlation": round(float(coefficient), 6),
                        "abs_correlation": round(abs(float(coefficient)), 6),
                    }
                )
        correlations.sort(key=lambda item: item["abs_correlation"], reverse=True)
        correlations = correlations[:10]

    return {
        "row_count": int(frame.shape[0]),
        "column_count": int(frame.shape[1]),
        "memory_usage_bytes": int(frame.memory_usage(deep=True).sum()),
        "columns": columns,
        "describe": describe,
        "correlations": correlations,
        "missing_values": {column: int(frame[column].isna().sum()) for column in frame.columns},
    }


def process_upload(payload: DatasetCreate) -> dict:
    """Decode, persist, and profile an uploaded dataset payload."""

    file_format = _infer_format(payload.filename, payload.format)
    logger.info("Processing upload: %s (%s format)", payload.filename, file_format)

    try:
        raw_bytes = base64.b64decode(payload.content_base64, validate=True)
    except ValueError as exc:
        raise ValueError("Dataset content_base64 is not valid base64.") from exc

    frame = _read_dataframe(raw_bytes, file_format)

    uploads_dir = Path(get_settings().UPLOADS_DIR)
    uploads_dir.mkdir(parents=True, exist_ok=True)

    safe_name = _sanitize_filename(payload.filename)
    destination = uploads_dir / f"{uuid4().hex}-{safe_name}"
    destination.write_bytes(raw_bytes)

    return {
        "file_path": str(destination.resolve()),
        "row_count": int(frame.shape[0]),
        "column_count": int(frame.shape[1]),
        "columns": build_column_info(frame),
        "profile": profile_dataset(frame),
        "dataframe": frame,
    }


def load_dataframe(file_path: str) -> pd.DataFrame:
    """Load a persisted dataset from disk."""

    path = Path(file_path)
    if not path.exists():
        raise FileNotFoundError(f"Dataset file '{file_path}' does not exist.")

    file_format = _infer_format(path.name, path.suffix.lstrip("."))
    return _read_dataframe(path.read_bytes(), file_format)


def ensure_columns_exist(frame: pd.DataFrame, columns: list[str]) -> None:
    """Ensure a set of columns exist in the dataframe."""

    missing = [column for column in columns if column not in frame.columns]
    if missing:
        raise ValueError(f"Columns not found in dataset: {', '.join(missing)}.")
