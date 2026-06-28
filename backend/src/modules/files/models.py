import uuid

from sqlalchemy import BigInteger, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class File(BaseDBModel):
    """Файл организации.

    Исторически используется модулем `files`.
    Дополнительные поля (`folder_id`, `type`, `status`, `title`, `current_version_id`)
    применяются новым модулем `docs`.
    """

    __tablename__ = "files"

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    original_name: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, nullable=False)
    s3_key: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    s3_bucket: Mapped[str] = mapped_column(String(255), nullable=False)
    preview_s3_key: Mapped[str | None] = mapped_column(String(1000), nullable=True, unique=True)
    preview_s3_bucket: Mapped[str | None] = mapped_column(String(255), nullable=True)
    preview_content_type: Mapped[str | None] = mapped_column(String(255), nullable=True)
    preview_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    preview_status: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    preview_meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    folder_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("folders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    type: Mapped[str | None] = mapped_column(String(20), nullable=True, index=True)
    status: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String(500), nullable=True)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("file_versions.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
