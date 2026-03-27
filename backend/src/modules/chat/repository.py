import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.chat.models import Chat, ChatMember, ChatMessage
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

    async def get_chat_member(self, *, chat_id: uuid.UUID, user_id: uuid.UUID) -> ChatMember | None:
        stmt = select(ChatMember).where(ChatMember.chat_id == chat_id, ChatMember.user_id == user_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def is_org_member(self, *, org_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        stmt = select(Membership.id).where(Membership.org_id == org_id, Membership.user_id == user_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none() is not None

    async def next_seq_no(self, *, chat_id: uuid.UUID) -> int:
        stmt = select(func.coalesce(func.max(ChatMessage.seq_no), 0)).where(ChatMessage.chat_id == chat_id)
        current = int((await self.session.execute(stmt)).scalar_one())
        return current + 1

    async def list_messages(self, *, chat_id: uuid.UUID, limit: int, offset: int) -> list[ChatMessage]:
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
        return message

    async def get_message_for_org(self, *, message_id: uuid.UUID, org_id: uuid.UUID) -> ChatMessage | None:
        stmt = select(ChatMessage).where(ChatMessage.id == message_id, ChatMessage.org_id == org_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def delete_message(self, message: ChatMessage) -> None:
        await self.session.delete(message)
        await self.session.flush()

    async def delete_chat(self, chat: Chat) -> None:
        await self.session.delete(chat)
        await self.session.flush()

