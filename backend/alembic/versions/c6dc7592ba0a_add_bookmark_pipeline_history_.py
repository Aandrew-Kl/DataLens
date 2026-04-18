"""add bookmark pipeline history persistence

Revision ID: c6dc7592ba0a
Revises: 001
Create Date: 2026-04-18 12:58:07.221332
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = "c6dc7592ba0a"
down_revision: Union[str, None] = '001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "pipelines",
        sa.Column("id", sa.String(length=255), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("steps", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_pipelines_user_id", "pipelines", ["user_id"], unique=False)

    op.create_table(
        "bookmarks",
        sa.Column("id", sa.String(length=255), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column(
            "dataset_id",
            UUID(as_uuid=True),
            sa.ForeignKey("datasets.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("table_name", sa.String(length=255), nullable=True),
        sa.Column("label", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("column_name", sa.String(length=255), nullable=True),
        sa.Column("sql_text", sa.Text(), nullable=True),
        sa.Column("view_state", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_bookmarks_dataset_id", "bookmarks", ["dataset_id"], unique=False)
    op.create_index("ix_bookmarks_user_id", "bookmarks", ["user_id"], unique=False)

    op.add_column("query_history", sa.Column("question", sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("query_history", "question")

    op.drop_index("ix_bookmarks_user_id", table_name="bookmarks")
    op.drop_index("ix_bookmarks_dataset_id", table_name="bookmarks")
    op.drop_table("bookmarks")

    op.drop_index("ix_pipelines_user_id", table_name="pipelines")
    op.drop_table("pipelines")
