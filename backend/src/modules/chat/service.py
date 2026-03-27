import uuid
from typing import ClassVar

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.chat.errors import ChatModuleError
from src.modules.chat.models import Chat, ChatMember, ChatMessage
from src.modules.chat.repository import ChatRepository
from src.modules.chat.schemas import (
    CHAT_MESSAGE_MAX_CHARS,
    AddChatMemberRequest,
    CreateChatRequest,
    SendChatMessageRequest,
    UpdateChatRequest,
)


class ChatServiceError(ChatModuleError):
    def __init__(self, *, code: str, message: str, status_code: int = 422):
        super().__init__(code=code, message=message, status_code=status_code)


class ChatService:
    CHAT_WRITE_ROLES: ClassVar[set[str]] = {"owner", "admin", "member"}
    CHAT_ADMIN_ROLES: ClassVar[set[str]] = {"owner", "admin"}

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = ChatRepository(session)

    async def create_chat(self, *, org_id: uuid.UUID, actor_id: uuid.UUID, body: CreateChatRequest) -> Chat:
        chat_type = body.chat_type
        title = (body.title or "").strip() or None
        member_ids = self._dedup_ids([actor_id, *(body.member_ids or [])])

        if chat_type in {"group", "channel"} and not title:
            raise ChatServiceError(code="VALIDATION_ERROR", message="title обязателен для group/channel")
        if chat_type == "direct" and len(member_ids) != 2:
            raise ChatServiceError(code="VALIDATION_ERROR", message="direct чат должен содержать ровно 2 участников")

        for member_id in member_ids:
            if not await self.repo.is_org_member(org_id=org_id, user_id=member_id):
                raise ChatServiceError(code="INVALID_MEMBER", message="Пользователь не состоит в организации")

        chat = Chat(org_id=org_id, created_by=actor_id, chat_type=chat_type, title=title)
        await self.repo.create_chat(chat)
        members = [
            ChatMember(
                org_id=org_id,
                chat_id=chat.id,
                user_id=user_id,
                role="owner" if user_id == actor_id else "member",
            )
            for user_id in member_ids
        ]
        await self.repo.add_members(members)
        return chat

    async def list_user_chats(self, *, org_id: uuid.UUID, user_id: uuid.UUID, limit: int, offset: int) -> list[Chat]:
        return await self.repo.list_user_chats(org_id=org_id, user_id=user_id, limit=limit, offset=offset)

    async def get_chat_for_user(self, *, chat_id: uuid.UUID, org_id: uuid.UUID, user_id: uuid.UUID) -> Chat | None:
        return await self.repo.get_chat_for_user(chat_id=chat_id, org_id=org_id, user_id=user_id)

    async def get_member_ids(self, *, chat_id: uuid.UUID) -> list[uuid.UUID]:
        return await self.repo.list_member_ids(chat_id=chat_id)

    async def list_members_for_user(self, *, chat: Chat, user_id: uuid.UUID) -> list[ChatMember]:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=user_id)
        if member is None:
            raise ChatServiceError(code="FORBIDDEN", message="Нет доступа к чату", status_code=403)
        return await self.repo.list_members(chat_id=chat.id)

    async def update_chat(
        self, *, chat: Chat, actor_id: uuid.UUID, body: UpdateChatRequest
    ) -> Chat:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if member is None or member.role not in self.CHAT_ADMIN_ROLES:
            raise ChatServiceError(code="FORBIDDEN", message="Недостаточно прав для обновления чата", status_code=403)
        chat.title = body.title.strip()
        await self.session.flush()
        return chat

    async def add_member(
        self,
        *,
        chat: Chat,
        actor_id: uuid.UUID,
        body: AddChatMemberRequest,
    ) -> ChatMember:
        if chat.chat_type == "direct":
            raise ChatServiceError(code="VALIDATION_ERROR", message="В direct чат нельзя добавлять участников")

        actor_member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if actor_member is None or actor_member.role not in self.CHAT_ADMIN_ROLES:
            raise ChatServiceError(
                code="FORBIDDEN",
                message="Недостаточно прав для добавления участника",
                status_code=403,
            )

        if not await self.repo.is_org_member(org_id=chat.org_id, user_id=body.user_id):
            raise ChatServiceError(code="INVALID_MEMBER", message="Пользователь не состоит в организации")

        existing = await self.repo.get_chat_member(chat_id=chat.id, user_id=body.user_id)
        if existing is not None:
            return existing

        member = ChatMember(
            org_id=chat.org_id,
            chat_id=chat.id,
            user_id=body.user_id,
            role=body.role,
        )
        await self.repo.add_members([member])
        return member

    async def create_message(
        self,
        *,
        chat: Chat,
        actor_id: uuid.UUID,
        body: SendChatMessageRequest,
    ) -> ChatMessage:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if member is None or member.role not in self.CHAT_WRITE_ROLES:
            raise ChatServiceError(
                code="FORBIDDEN",
                message="Недостаточно прав для отправки сообщения",
                status_code=403,
            )

        trimmed_body = body.body.strip()
        if not trimmed_body:
            raise ChatServiceError(code="VALIDATION_ERROR", message="Сообщение не может быть пустым")
        if len(trimmed_body) > CHAT_MESSAGE_MAX_CHARS:
            raise ChatServiceError(
                code="VALIDATION_ERROR",
                message=f"Сообщение не должно превышать {CHAT_MESSAGE_MAX_CHARS} символов",
            )

        seq_no = await self.repo.next_seq_no(chat_id=chat.id)
        message = ChatMessage(
            org_id=chat.org_id,
            chat_id=chat.id,
            sender_id=actor_id,
            seq_no=seq_no,
            body=trimmed_body,
            body_type=(body.body_type or "text_markdown").strip(),
            meta=body.meta,
        )
        return await self.repo.create_message(message)

    async def list_messages_for_user(
        self,
        *,
        chat: Chat,
        user_id: uuid.UUID,
        limit: int,
        offset: int,
        before_seq_no: int | None = None,
        latest: bool = False,
    ) -> list[ChatMessage]:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=user_id)
        if member is None:
            raise ChatServiceError(code="FORBIDDEN", message="Нет доступа к сообщениям этого чата", status_code=403)
        return await self.repo.list_messages(
            chat_id=chat.id,
            limit=limit,
            offset=offset,
            before_seq_no=before_seq_no,
            latest=latest,
        )

    async def update_read_cursor(
        self, *, chat: Chat, user_id: uuid.UUID, last_read_seq_no: int
    ) -> ChatMember:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=user_id)
        if member is None:
            raise ChatServiceError(code="FORBIDDEN", message="Нет доступа к чату", status_code=403)
        member.last_read_seq_no = max(member.last_read_seq_no, int(last_read_seq_no))
        await self.session.flush()
        return member

    async def delete_message(self, *, message: ChatMessage, actor_id: uuid.UUID) -> None:
        member = await self.repo.get_chat_member(chat_id=message.chat_id, user_id=actor_id)
        if member is None:
            raise ChatServiceError(code="FORBIDDEN", message="Нет доступа к сообщению", status_code=403)
        if member.role not in self.CHAT_ADMIN_ROLES and message.sender_id != actor_id:
            raise ChatServiceError(code="FORBIDDEN", message="Можно удалять только свои сообщения", status_code=403)
        await self.repo.delete_message(message)

    async def delete_chat(self, *, chat: Chat, actor_id: uuid.UUID) -> None:
        member = await self.repo.get_chat_member(chat_id=chat.id, user_id=actor_id)
        if member is None or member.role not in self.CHAT_ADMIN_ROLES:
            raise ChatServiceError(code="FORBIDDEN", message="Недостаточно прав для удаления чата", status_code=403)
        await self.repo.delete_chat(chat)

    @staticmethod
    def _dedup_ids(items: list[uuid.UUID]) -> list[uuid.UUID]:
        result: list[uuid.UUID] = []
        seen: set[uuid.UUID] = set()
        for item in items:
            if item in seen:
                continue
            seen.add(item)
            result.append(item)
        return result
