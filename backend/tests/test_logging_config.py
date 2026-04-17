from __future__ import annotations

import json
import logging
import logging.config
import os
from datetime import datetime, timezone

import pytest

from app.logging_config import JSONFormatter, setup_logging


@pytest.fixture
def logging_state(caplog: pytest.LogCaptureFixture):
    root = logging.getLogger()
    root_level = root.level
    root_handlers = list(root.handlers)
    root_handler_state = [(handler, handler.level, handler.formatter) for handler in root.handlers]

    logger_names = ("uvicorn.access", "sqlalchemy.engine")
    logger_state = {}
    for name in logger_names:
        logger = logging.getLogger(name)
        logger_state[name] = {
            "level": logger.level,
            "handlers": list(logger.handlers),
            "propagate": logger.propagate,
            "disabled": logger.disabled,
        }

    yield

    root.setLevel(root_level)
    root.handlers[:] = root_handlers
    for handler, level, formatter in root_handler_state:
        handler.setLevel(level)
        handler.setFormatter(formatter)

    for name, state in logger_state.items():
        logger = logging.getLogger(name)
        logger.setLevel(state["level"])
        logger.handlers[:] = state["handlers"]
        logger.propagate = state["propagate"]
        logger.disabled = state["disabled"]


def _payload_for_record(record: logging.LogRecord) -> dict[str, object]:
    return json.loads(JSONFormatter().format(record))


def test_json_formatter_emits_expected_keys(
    caplog: pytest.LogCaptureFixture,
    logging_state,
) -> None:
    logger = logging.getLogger("tests.logging.json")

    with caplog.at_level(logging.INFO, logger=logger.name):
        logger.info("structured log", extra={"user_id": 42})

    record = next(record for record in caplog.records if record.name == logger.name)
    payload = _payload_for_record(record)

    assert set(payload) == {"timestamp", "level", "logger", "message", "user_id"}
    assert payload["level"] == "INFO"
    assert payload["logger"] == logger.name
    assert payload["message"] == "structured log"
    assert payload["user_id"] == 42
    assert "module" not in payload
    assert datetime.fromisoformat(str(payload["timestamp"])).tzinfo == timezone.utc


def test_json_formatter_propagates_correlation_id_when_present(
    caplog: pytest.LogCaptureFixture,
    logging_state,
) -> None:
    logger = logging.getLogger("tests.logging.correlation")

    with caplog.at_level(logging.INFO, logger=logger.name):
        logger.info("request log", extra={"correlation_id": "req-123"})

    record = next(record for record in caplog.records if record.name == logger.name)
    payload = _payload_for_record(record)

    assert payload["correlation_id"] == "req-123"
    assert payload["message"] == "request log"


def test_setup_logging_uses_log_level_from_env_and_updates_existing_handler(
    monkeypatch: pytest.MonkeyPatch,
    logging_state,
) -> None:
    logging.config.dictConfig(
        {
            "version": 1,
            "disable_existing_loggers": False,
            "formatters": {
                "plain": {
                    "format": "%(levelname)s:%(name)s:%(message)s",
                }
            },
            "handlers": {
                "existing": {
                    "class": "logging.StreamHandler",
                    "formatter": "plain",
                    "stream": "ext://sys.stdout",
                }
            },
            "root": {
                "level": "WARNING",
                "handlers": ["existing"],
            },
        }
    )
    existing_handler = logging.getLogger().handlers[0]

    monkeypatch.setenv("LOG_LEVEL", "DEBUG")
    setup_logging(level=os.environ["LOG_LEVEL"], environment="production")

    root = logging.getLogger()
    assert root.level == logging.DEBUG
    assert root.handlers == [existing_handler]
    assert isinstance(existing_handler.formatter, JSONFormatter)


def test_setup_logging_suppresses_third_party_noise(
    caplog: pytest.LogCaptureFixture,
    logging_state,
) -> None:
    setup_logging(level="INFO")

    noisy_access_logger = logging.getLogger("uvicorn.access")
    noisy_sql_logger = logging.getLogger("sqlalchemy.engine")
    app_logger = logging.getLogger("app.request")

    with caplog.at_level(logging.INFO):
        noisy_access_logger.info("suppressed access log")
        noisy_sql_logger.info("suppressed sql log")
        noisy_access_logger.warning("visible access warning")
        app_logger.info("visible application log")

    messages = [record.getMessage() for record in caplog.records]

    assert noisy_access_logger.level == logging.WARNING
    assert noisy_sql_logger.level == logging.WARNING
    assert "suppressed access log" not in messages
    assert "suppressed sql log" not in messages
    assert "visible access warning" in messages
    assert "visible application log" in messages
