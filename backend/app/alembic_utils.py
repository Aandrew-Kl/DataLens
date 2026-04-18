from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.runtime.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy.engine import Connection


BACKEND_ROOT = Path(__file__).resolve().parents[1]
ALEMBIC_INI = BACKEND_ROOT / "alembic.ini"
ALEMBIC_DIR = BACKEND_ROOT / "alembic"


def make_alembic_config(database_url: str | None = None) -> Config:
    config = Config(str(ALEMBIC_INI))
    config.set_main_option("script_location", str(ALEMBIC_DIR))
    if database_url:
        config.set_main_option("sqlalchemy.url", database_url)
    return config


def get_head_revisions(database_url: str | None = None) -> tuple[str, ...]:
    config = make_alembic_config(database_url)
    script_directory = ScriptDirectory.from_config(config)
    return tuple(script_directory.get_heads())


def get_current_revisions(connection: Connection) -> tuple[str, ...]:
    migration_context = MigrationContext.configure(connection)
    return tuple(migration_context.get_current_heads())


def get_current_revision(connection: Connection) -> str | None:
    migration_context = MigrationContext.configure(connection)
    return migration_context.get_current_revision()


def _run_alembic_command(
    connection: Connection,
    *,
    revision: str,
    command_name: str,
    database_url: str | None = None,
) -> None:
    config = make_alembic_config(database_url)
    config.attributes["connection"] = connection

    if command_name == "upgrade":
        command.upgrade(config, revision)
        return

    if not get_current_revisions(connection):
        return

    if command_name == "downgrade":
        command.downgrade(config, revision)
        return

    raise ValueError(f"Unsupported Alembic command: {command_name}")


def upgrade_database(connection: Connection, revision: str = "head", database_url: str | None = None) -> None:
    _run_alembic_command(
        connection,
        revision=revision,
        command_name="upgrade",
        database_url=database_url,
    )


def downgrade_database(
    connection: Connection,
    revision: str = "base",
    database_url: str | None = None,
) -> None:
    _run_alembic_command(
        connection,
        revision=revision,
        command_name="downgrade",
        database_url=database_url,
    )
