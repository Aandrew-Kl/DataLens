"""Structured logging configuration for the DataLens backend."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any

try:
    from pythonjsonlogger import jsonlogger
except ImportError:  # pragma: no cover - fallback path for environments without the optional dependency
    jsonlogger = None


_BASE_JSON_FORMATTER = jsonlogger.JsonFormatter if jsonlogger is not None else logging.Formatter
_STANDARD_LOG_RECORD_FIELDS = frozenset(logging.makeLogRecord({}).__dict__) | {"message", "asctime"}


class JSONFormatter(_BASE_JSON_FORMATTER):
    """Format log records as structured JSON for production observability."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        payload.update(self._get_extra_fields(record))

        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        if record.stack_info:
            payload["stack"] = self.formatStack(record.stack_info)

        return json.dumps(payload, default=self._json_default, ensure_ascii=False)

    def _get_extra_fields(self, record: logging.LogRecord) -> dict[str, Any]:
        return {
            key: value
            for key, value in record.__dict__.items()
            if key not in _STANDARD_LOG_RECORD_FIELDS and key not in {"timestamp", "level", "logger", "message"}
        }

    @staticmethod
    def _json_default(value: Any) -> Any:
        return str(value)


def _resolve_log_format(format: str | None, environment: str | None) -> str:
    if format:
        normalized = format.strip().lower()
        if normalized in {"json", "structured"}:
            return "json"
        return "text"

    if environment and environment.strip().lower() == "production":
        return "json"
    return "text"


def setup_logging(level: str = "INFO", format: str | None = None, environment: str | None = None) -> None:
    """Configure application logging with environment-aware formatting."""

    root = logging.getLogger()
    root.setLevel(getattr(logging, level.upper(), logging.INFO))

    resolved_format = _resolve_log_format(format, environment)
    if resolved_format == "json":
        formatter: logging.Formatter = JSONFormatter()
    else:
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    if root.handlers:
        for existing_handler in root.handlers:
            existing_handler.setFormatter(formatter)
    else:
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(logging.DEBUG)
        handler.setFormatter(formatter)
        root.addHandler(handler)

    # Quiet down noisy libraries
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
