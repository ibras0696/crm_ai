import uuid
from typing import ClassVar

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.common.base_model import BaseDBModel


class TableFolder(BaseDBModel):
    __tablename__ = "table_folders"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("table_folders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))

    tables: Mapped[list["Table"]] = relationship("Table", back_populates="folder", passive_deletes=True)


class FieldType:
    TEXT = "text"
    NUMBER = "number"
    DATE = "date"
    DATETIME = "datetime"
    BOOLEAN = "boolean"
    SELECT = "select"
    MULTI_SELECT = "multi_select"
    URL = "url"
    EMAIL = "email"
    PHONE = "phone"
    FILE = "file"
    RELATION = "relation"
    LOOKUP = "lookup"
    ROLLUP = "rollup"
    FORMULA = "formula"

    ALL: ClassVar[list[str]] = [
        TEXT,
        NUMBER,
        DATE,
        DATETIME,
        BOOLEAN,
        SELECT,
        MULTI_SELECT,
        URL,
        EMAIL,
        PHONE,
        FILE,
        RELATION,
        LOOKUP,
        ROLLUP,
        FORMULA,
    ]


class Table(BaseDBModel):
    __tablename__ = "tables"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("table_folders.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))

    columns: Mapped[list["Column"]] = relationship(
        "Column", back_populates="table", cascade="all, delete-orphan", order_by="Column.position"
    )
    folder: Mapped["TableFolder | None"] = relationship("TableFolder", back_populates="tables")


class Column(BaseDBModel):
    __tablename__ = "table_columns"

    table_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tables.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    field_type: Mapped[str] = mapped_column(String(50), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # options for select, formula, etc.
    default_value: Mapped[str | None] = mapped_column(Text, nullable=True)

    table: Mapped["Table"] = relationship("Table", back_populates="columns")


class TableView(BaseDBModel):
    """Saved table view: filters/sorts/config for a specific table."""

    __tablename__ = "table_views"

    table_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tables.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    view_type: Mapped[str] = mapped_column(String(50), nullable=False, default="grid")  # grid, kanban, calendar
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=text("false"))
    filters: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)
    sorts: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)
    config: Mapped[dict | list | None] = mapped_column(JSONB, nullable=True)
