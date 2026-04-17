from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

pytest.importorskip("aiosqlite")
pytest.importorskip("alembic.command")

from alembic import command
from alembic.config import Config


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_DIR = BACKEND_ROOT / "alembic"
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
EXPECTED_TABLES = {"users", "datasets", "saved_analyses", "query_history"}


def _sqlite_table_names(database_path: Path) -> set[str]:
    with sqlite3.connect(database_path) as connection:
        rows = connection.execute(
            """
            SELECT name
            FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
            """
        ).fetchall()

    return {name for (name,) in rows}


def _alembic_config(database_url: str) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def test_alembic_round_trip_on_sqlite(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    if not ALEMBIC_DIR.is_dir() or not ALEMBIC_INI.is_file():
        pytest.skip("Alembic directory is not present in backend/")

    database_path = tmp_path / "migrations-roundtrip.db"
    database_url = f"sqlite+aiosqlite:///{database_path}"
    config = _alembic_config(database_url)

    monkeypatch.setenv("DATABASE_URL", database_url)

    command.upgrade(config, "head")
    assert EXPECTED_TABLES <= _sqlite_table_names(database_path)

    command.downgrade(config, "base")
    assert EXPECTED_TABLES.isdisjoint(_sqlite_table_names(database_path))

    command.upgrade(config, "head")
    assert EXPECTED_TABLES <= _sqlite_table_names(database_path)
