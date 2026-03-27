import uuid

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.chat.repository import ChatRepository
from src.modules.chat.schemas import (
    AddChatMemberRequest,
    ChatMemberOut,
    ChatMessageOut,
    ChatOut,
    CreateChatRequest,
    ReadCursorOut,
    SendChatMessageRequest,
    UpdateChatRequest,
    UpdateReadCursorRequest,
)
from src.modules.chat.service import ChatService, ChatServiceError
from src.modules.notifications.ws import manager as ws_manager

router = APIRouter(prefix="/chat", tags=["chat"])

CHAT_NOT_FOUND_MESSAGE = "Чат не найден"
MESSAGE_NOT_FOUND_MESSAGE = "Сообщение не найдено"


class TypingEventRequest(BaseModel):
    is_typing: bool = True


def _service_error(error: ChatServiceError) -> ApiResponse[None]:
    return ApiResponse(ok=False, data=None, error={"code": error.code, "message": error.message})


async def _chat_out(service: ChatService, chat) -> ChatOut:
    return ChatOut(
        id=chat.id,
        org_id=chat.org_id,
        created_by=chat.created_by,
        chat_type=chat.chat_type,
        title=chat.title,
        member_ids=await service.get_member_ids(chat_id=chat.id),
        created_at=chat.created_at,
        updated_at=chat.updated_at,
    )


@router.post("/chats", response_model=ApiResponse[ChatOut])
async def create_chat(
    body: CreateChatRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_write")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        try:
            chat = await service.create_chat(org_id=current_user.org_id, actor_id=current_user.user_id, body=body)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()
        item = await _chat_out(service, chat)
    return ApiResponse(data=item)


@router.get("/chats", response_model=ApiResponse[list[ChatOut]])
async def list_chats(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chats = await service.list_user_chats(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            limit=limit,
            offset=offset,
        )
        items = [await _chat_out(service, chat) for chat in chats]
    return ApiResponse(data=items)


@router.get("/chats/{chat_id}", response_model=ApiResponse[ChatOut])
async def get_chat(
    chat_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_read", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        item = await _chat_out(service, chat)
    return ApiResponse(data=item)


@router.patch("/chats/{chat_id}", response_model=ApiResponse[ChatOut])
async def update_chat(
    chat_id: uuid.UUID,
    body: UpdateChatRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_write", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        try:
            updated = await service.update_chat(chat=chat, actor_id=current_user.user_id, body=body)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()
        item = await _chat_out(service, updated)
    return ApiResponse(data=item)


@router.delete("/chats/{chat_id}", response_model=ApiResponse[None])
async def delete_chat(
    chat_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="chat", permission="can_delete", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        try:
            await service.delete_chat(chat=chat, actor_id=current_user.user_id)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/chats/{chat_id}/members", response_model=ApiResponse[ChatMemberOut])
async def add_member(
    chat_id: uuid.UUID,
    body: AddChatMemberRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="chat", permission="can_write", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        try:
            member = await service.add_member(chat=chat, actor_id=current_user.user_id, body=body)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()
        item = ChatMemberOut(
            id=member.id,
            chat_id=member.chat_id,
            user_id=member.user_id,
            role=member.role,
            last_read_seq_no=member.last_read_seq_no,
            created_at=member.created_at,
        )
    return ApiResponse(data=item)


@router.get("/chats/{chat_id}/members", response_model=ApiResponse[list[ChatMemberOut]])
async def list_members(
    chat_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_read", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        try:
            members = await service.list_members_for_user(chat=chat, user_id=current_user.user_id)
        except ChatServiceError as error:
            return _service_error(error)
        items = [
            ChatMemberOut(
                id=member.id,
                chat_id=member.chat_id,
                user_id=member.user_id,
                role=member.role,
                last_read_seq_no=member.last_read_seq_no,
                created_at=member.created_at,
            )
            for member in members
        ]
    return ApiResponse(data=items)


@router.get("/chats/{chat_id}/messages", response_model=ApiResponse[list[ChatMessageOut]])
async def list_messages(
    chat_id: uuid.UUID,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    before_seq_no: int | None = Query(default=None, ge=1),
    latest: bool = Query(default=False),
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_read", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        try:
            messages = await service.list_messages_for_user(
                chat=chat,
                user_id=current_user.user_id,
                limit=limit,
                offset=offset,
                before_seq_no=before_seq_no,
                latest=latest,
            )
        except ChatServiceError as error:
            return _service_error(error)
        items = [
            ChatMessageOut(
                id=message.id,
                chat_id=message.chat_id,
                sender_id=message.sender_id,
                seq_no=message.seq_no,
                body=message.body,
                body_type=message.body_type,
                meta=message.meta,
                created_at=message.created_at,
            )
            for message in messages
        ]
    return ApiResponse(data=items)


@router.get("/chats/{chat_id}/presence", response_model=ApiResponse[dict[str, bool]])
async def get_presence(
    chat_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_read", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        member_ids = await service.get_member_ids(chat_id=chat.id)
    payload = {str(user_id): ws_manager.is_online(user_id) for user_id in member_ids}
    return ApiResponse(data=payload)


@router.post("/chats/{chat_id}/typing", response_model=ApiResponse[None])
async def send_typing_event(
    chat_id: uuid.UUID,
    body: TypingEventRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_read", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        member_ids = await service.get_member_ids(chat_id=chat.id)

    event_payload = {
        "type": "chat.typing.updated",
        "schema_version": 1,
        "chat_id": str(chat_id),
        "user_id": str(current_user.user_id),
        "is_typing": body.is_typing,
    }
    for member_id in member_ids:
        if member_id == current_user.user_id:
            continue
        await ws_manager.send_personal_message(event_payload, member_id)

    return ApiResponse(data=None)


@router.post("/chats/{chat_id}/messages", response_model=ApiResponse[ChatMessageOut])
async def send_message(
    chat_id: uuid.UUID,
    body: SendChatMessageRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_write", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        try:
            message = await service.create_message(chat=chat, actor_id=current_user.user_id, body=body)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()
        item = ChatMessageOut(
            id=message.id,
            chat_id=message.chat_id,
            sender_id=message.sender_id,
            seq_no=message.seq_no,
            body=message.body,
            body_type=message.body_type,
            meta=message.meta,
            created_at=message.created_at,
        )
        member_ids = await service.get_member_ids(chat_id=chat.id)

    event_payload = {
        "type": "chat.message.created",
        "schema_version": 1,
        "chat_id": str(chat.id),
        "message": item.model_dump(mode="json"),
    }
    for member_id in member_ids:
        await ws_manager.send_personal_message(event_payload, member_id)

    return ApiResponse(data=item)


@router.delete("/messages/{message_id}", response_model=ApiResponse[None])
async def delete_message(
    message_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_delete", resource_id_param="message_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        repo = ChatRepository(uow.session)
        message = await repo.get_message_for_org(message_id=message_id, org_id=current_user.org_id)
        if message is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": MESSAGE_NOT_FOUND_MESSAGE})
        try:
            await service.delete_message(message=message, actor_id=current_user.user_id)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/chats/{chat_id}/read-cursor", response_model=ApiResponse[ReadCursorOut])
async def update_read_cursor(
    chat_id: uuid.UUID,
    body: UpdateReadCursorRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_read", resource_id_param="chat_id")),
):
    async with UnitOfWork() as uow:
        service = ChatService(uow.session)
        chat = await service.get_chat_for_user(
            chat_id=chat_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
        )
        if chat is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE})
        try:
            member = await service.update_read_cursor(
                chat=chat,
                user_id=current_user.user_id,
                last_read_seq_no=body.last_read_seq_no,
            )
        except ChatServiceError as error:
            return _service_error(error)
        member_ids = await service.get_member_ids(chat_id=chat.id)
        await uow.commit()
        item = ReadCursorOut(
            chat_id=member.chat_id,
            user_id=member.user_id,
            last_read_seq_no=member.last_read_seq_no,
        )

    event_payload = {
        "type": "chat.read.cursor.updated",
        "schema_version": 1,
        "chat_id": str(chat_id),
        "user_id": str(current_user.user_id),
        "last_read_seq_no": item.last_read_seq_no,
    }
    for member_id in member_ids:
        await ws_manager.send_personal_message(event_payload, member_id)

    return ApiResponse(data=item)
