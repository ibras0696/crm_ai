import hashlib
import uuid

from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.chat.models import Chat, ChatMember, ChatMessage, ChatUploadSession
from src.modules.files.models import File
from src.modules.org.models import Membership


class ChatRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_chat(self, chat: Chat) -> Chat:
        self.session.add(chat)
        await self.session.flush()
        return chat

    async def add_members(self, members: list[ChatMember]) -> None:
        self.session.add_all(members)
        await self.session.flush()

    async def get_chat_for_user(self, *, chat_id: uuid.UUID, org_id: uuid.UUID, user_id: uuid.UUID) -> Chat | None:
        stmt = (
            select(Chat)
            .join(ChatMember, ChatMember.chat_id == Chat.id)
            .where(
                Chat.id == chat_id,
                Chat.org_id == org_id,
                ChatMember.user_id == user_id,
            )
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_user_chats(
        self, *, org_id: uuid.UUID, user_id: uuid.UUID, limit: int, offset: int
    ) -> list[Chat]:
        stmt = (
            select(Chat)
            .join(ChatMember, ChatMember.chat_id == Chat.id)
            .where(Chat.org_id == org_id, ChatMember.user_id == user_id)
            .order_by(Chat.updated_at.desc(), Chat.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_member_ids(self, *, chat_id: uuid.UUID) -> list[uuid.UUID]:
        stmt = select(ChatMember.user_id).where(ChatMember.chat_id == chat_id).order_by(ChatMember.created_at.asc())
        return [row[0] for row in (await self.session.execute(stmt)).all()]

    async def list_members(self, *, chat_id: uuid.UUID) -> list[ChatMember]:
        stmt = select(ChatMember).where(ChatMember.chat_id == chat_id).order_by(ChatMember.created_at.asc())
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_chat_member(self, *, chat_id: uuid.UUID, user_id: uuid.UUID) -> ChatMember | None:
        stmt = select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def is_org_member(self, *, org_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        stmt = select(Membership.id).where(Membership.org_id == org_id, Membership.user_id == user_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none() is not None

    async def allocate_next_seq_no(self, *, chat_id: uuid.UUID) -> int:
        stmt = (
            update(Chat)
            .where(Chat.id == chat_id)
            .values(last_seq_no=Chat.last_seq_no + 1)
            .returning(Chat.last_seq_no)
        )
        allocated = (await self.session.execute(stmt)).scalar_one_or_none()
        if allocated is None:
            raise RuntimeError("chat_not_found_for_seq_allocation")
        return int(allocated)

    async def get_message_by_client_message_id(
        self, *, chat_id: uuid.UUID, client_message_id: str
    ) -> ChatMessage | None:
        stmt = (
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat_id, ChatMessage.client_message_id == client_message_id)
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def acquire_message_idempotency_lock(self, *, chat_id: uuid.UUID, client_message_id: str) -> None:
        lock_key_raw = f"{chat_id}:{client_message_id}".encode()
        lock_key = int.from_bytes(hashlib.sha1(lock_key_raw).digest()[:8], byteorder="big", signed=False)
        if lock_key > 0x7FFF_FFFF_FFFF_FFFF:
            lock_key -= 0x1_0000_0000_0000_0000
        await self.session.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": lock_key})

    async def list_messages(
        self,
        *,
        chat_id: uuid.UUID,
        limit: int,
        offset: int,
        after_seq_no: int | None = None,
        before_seq_no: int | None = None,
        latest: bool = False,
    ) -> list[ChatMessage]:
        if after_seq_no is not None:
            stmt = (
                select(ChatMessage)
                .where(ChatMessage.chat_id == chat_id, ChatMessage.seq_no > after_seq_no)
                .order_by(ChatMessage.seq_no.asc())
                .limit(limit)
            )
            return list((await self.session.execute(stmt)).scalars().all())

        if before_seq_no is not None:
            stmt = (
                select(ChatMessage)
                .where(ChatMessage.chat_id == chat_id, ChatMessage.seq_no < before_seq_no)
                .order_by(ChatMessage.seq_no.desc())
                .limit(limit)
            )
            items = list((await self.session.execute(stmt)).scalars().all())
            items.reverse()
            return items

        if latest:
            stmt = (
                select(ChatMessage)
                .where(ChatMessage.chat_id == chat_id)
                .order_by(ChatMessage.seq_no.desc())
                .limit(limit)
            )
            items = list((await self.session.execute(stmt)).scalars().all())
            items.reverse()
            return items

        stmt = (
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat_id)
            .order_by(ChatMessage.seq_no.asc())
            .offset(offset)
            .limit(limit)
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def create_message(self, message: ChatMessage) -> ChatMessage:
        self.session.add(message)
        await self.session.flush()
        await self.session.execute(update(Chat).where(Chat.id == message.chat_id).values(updated_at=func.now()))
        return message

    async def create_upload_session(self, upload: ChatUploadSession) -> ChatUploadSession:
        self.session.add(upload)
        await self.session.flush()
        return upload

    async def get_upload_session_for_user(
        self,
        *,
        org_id: uuid.UUID,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
        file_id: uuid.UUID,
    ) -> ChatUploadSession | None:
        stmt = (
            select(ChatUploadSession)
            .where(
                ChatUploadSession.org_id == org_id,
                ChatUploadSession.chat_id == chat_id,
                ChatUploadSession.user_id == user_id,
                ChatUploadSession.file_id == file_id,
            )
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_upload_session_for_chat_file(
        self,
        *,
        org_id: uuid.UUID,
        chat_id: uuid.UUID,
        file_id: uuid.UUID,
    ) -> ChatUploadSession | None:
        stmt = (
            select(ChatUploadSession)
            .where(
                ChatUploadSession.org_id == org_id,
                ChatUploadSession.chat_id == chat_id,
                ChatUploadSession.file_id == file_id,
            )
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_upload_sessions_for_user_files(
        self,
        *,
        org_id: uuid.UUID,
        chat_id: uuid.UUID,
        user_id: uuid.UUID,
        file_ids: list[uuid.UUID],
    ) -> list[ChatUploadSession]:
        if not file_ids:
            return []
        stmt = select(ChatUploadSession).where(
            ChatUploadSession.org_id == org_id,
            ChatUploadSession.chat_id == chat_id,
            ChatUploadSession.user_id == user_id,
            ChatUploadSession.file_id.in_(file_ids),
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_chat_upload_file_ids(self, *, org_id: uuid.UUID, chat_id: uuid.UUID) -> list[uuid.UUID]:
        stmt = (
            select(ChatUploadSession.file_id)
            .where(ChatUploadSession.org_id == org_id, ChatUploadSession.chat_id == chat_id)
            .distinct()
        )
        return [row[0] for row in (await self.session.execute(stmt)).all()]

    async def list_files_for_org_ids(self, *, org_id: uuid.UUID, file_ids: list[uuid.UUID]) -> list[File]:
        if not file_ids:
            return []
        stmt = select(File).where(File.org_id == org_id, File.id.in_(file_ids))
        return list((await self.session.execute(stmt)).scalars().all())

    async def count_attachment_references(
        self,
        *,
        org_id: uuid.UUID,
        file_id: uuid.UUID,
        exclude_message_id: uuid.UUID | None = None,
    ) -> int:
        sql = """
            SELECT COUNT(*)
            FROM chat_messages
            WHERE org_id = :org_id
              AND (
                COALESCE(meta->'attachment_ids', '[]'::jsonb) ? :file_id_text
                OR EXISTS (
                    SELECT 1
                    FROM jsonb_array_elements(COALESCE(meta->'attachments', '[]'::jsonb)) AS elem
                    WHERE elem->>'file_id' = :file_id_text
                )
              )
        """
        params: dict[str, object] = {"org_id": org_id, "file_id_text": str(file_id)}
        if exclude_message_id is not None:
            sql += " AND id <> :exclude_message_id"
            params["exclude_message_id"] = exclude_message_id
        result = await self.session.execute(text(sql), params)
        return int(result.scalar_one() or 0)

    async def get_message_for_org(self, *, message_id: uuid.UUID, org_id: uuid.UUID) -> ChatMessage | None:
        stmt = select(ChatMessage).where(ChatMessage.id == message_id, ChatMessage.org_id == org_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def delete_message(self, message: ChatMessage) -> None:
        await self.session.delete(message)
        await self.session.flush()

    async def delete_chat(self, chat: Chat) -> None:
        await self.session.delete(chat)
        await self.session.flush()
