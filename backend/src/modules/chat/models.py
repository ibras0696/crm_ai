import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class Chat(BaseDBModel):
    __tablename__ = "chats"
    __table_args__ = (
        CheckConstraint("chat_type IN ('direct', 'group', 'channel')", name="ck_chats_chat_type_valid"),
        UniqueConstraint("id", "org_id", name="uq_chats_id_org"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'group'"))
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)


class ChatMember(BaseDBModel):
    __tablename__ = "chat_members"
    __table_args__ = (
        UniqueConstraint("chat_id", "user_id", name="uq_chat_members_chat_user"),
        CheckConstraint("role IN ('owner', 'admin', 'member', 'readonly')", name="ck_chat_members_role_valid"),
        CheckConstraint("last_read_seq_no >= 0", name="ck_chat_members_last_read_seq_no_non_negative"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, server_default=text("'member'"))
    last_read_seq_no: Mapped[int] = mapped_column(Integer, nullable=False, server_default=text("0"), default=0)


class ChatMessage(BaseDBModel):
    __tablename__ = "chat_messages"
    __table_args__ = (
        UniqueConstraint("chat_id", "seq_no", name="uq_chat_messages_chat_seq"),
        CheckConstraint("seq_no > 0", name="ck_chat_messages_seq_no_positive"),
    )

    org_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    chat_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("chats.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sender_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    seq_no: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    body_type: Mapped[str] = mapped_column(String(40), nullable=False, server_default=text("'text_markdown'"))
    meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

