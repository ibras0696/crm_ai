import asyncio
import hashlib
import logging
import uuid

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from kombu.exceptions import KombuError
from pydantic import BaseModel

from src.common.enums import UserRole
from src.common.http_headers import content_disposition_inline
from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.metrics_custom import (
    CHAT_ATTACHMENT_DOWNLOAD_URL_REQUESTS_TOTAL,
    CHAT_ERRORS_TOTAL,
    CHAT_MESSAGE_LAG_SECONDS,
    CHAT_TELEMETRY_EVENTS_TOTAL,
)
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.chat.repository import ChatRepository
from src.modules.chat.schemas import (
    AddChatMemberRequest,
    ChatAttachmentDownloadOut,
    ChatAttachmentFinishRequest,
    ChatAttachmentInitOut,
    ChatAttachmentInitRequest,
    ChatAttachmentOut,
    ChatClientConfigOut,
    ChatMemberOut,
    ChatMessageOut,
    ChatOut,
    ChatTelemetryRequest,
    CreateChatRequest,
    ReadCursorOut,
    SendChatMessageRequest,
    UpdateChatRequest,
    UpdateReadCursorRequest,
)
from src.modules.chat.service import ChatService, ChatServiceError
from src.modules.chat.tasks import chat_cleanup_attachments
from src.modules.files import storage as files_storage
from src.modules.notifications.ws import manager as ws_manager

router = APIRouter(prefix="/chat", tags=["chat"])
logger = logging.getLogger(__name__)

CHAT_NOT_FOUND_MESSAGE = "Чат не найден"
MESSAGE_NOT_FOUND_MESSAGE = "Сообщение не найдено"
CHAT_ATTACHMENT_PREVIEW_CACHE_CONTROL = "private, max-age=86400, stale-while-revalidate=604800"


class TypingEventRequest(BaseModel):
    is_typing: bool = True


def _service_error(error: ChatServiceError) -> ApiResponse[None]:
    CHAT_ERRORS_TOTAL.labels(operation="chat_api", code=error.code).inc()
    logger.warning(
        "chat_service_error",
        extra={"code": error.code, "message": error.message, "status_code": error.status_code},
    )
    return ApiResponse(ok=False, data=None, error={"code": error.code, "message": error.message})


def _error_response(error: ChatServiceError) -> JSONResponse:
    payload = _service_error(error)
    return JSONResponse(status_code=error.status_code, content=payload.model_dump(mode="json"))


def _etag_matches(if_none_match: str | None, etag: str) -> bool:
    if not if_none_match or not etag:
        return False
    return any(token.strip() == etag for token in if_none_match.split(","))


def _is_user_in_rollout(*, user_id: uuid.UUID, percent: int) -> bool:
    rollout_percent = max(0, min(100, int(percent)))
    if rollout_percent >= 100:
        return True
    if rollout_percent <= 0:
        return False
    digest = hashlib.sha256(str(user_id).encode("utf-8")).hexdigest()
    bucket = int(digest[:8], 16) % 100
    return bucket < rollout_percent


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
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_delete", resource_id_param="chat_id")),
):
    cleanup_file_ids: list[uuid.UUID] = []
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
            cleanup_file_ids = await service.delete_chat(chat=chat, actor_id=current_user.user_id)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()

    if cleanup_file_ids:
        cleanup_payload = [str(file_id) for file_id in cleanup_file_ids]
        try:
            chat_cleanup_attachments.delay(org_id=str(current_user.org_id), file_ids=cleanup_payload)
        except (KombuError, ConnectionError, OSError, RuntimeError):
            logger.exception(
                "chat_cleanup_task_enqueue_failed_fallback_inline",
                extra={
                    "chat_id": str(chat_id),
                    "org_id": str(current_user.org_id),
                    "file_ids_count": len(cleanup_payload),
                },
            )
            # Fallback to inline execution when broker is unavailable.
            await asyncio.to_thread(
                chat_cleanup_attachments.run,
                org_id=str(current_user.org_id),
                file_ids=cleanup_payload,
            )
    return ApiResponse(data=None)


@router.post("/chats/{chat_id}/members", response_model=ApiResponse[ChatMemberOut])
async def add_member(
    chat_id: uuid.UUID,
    body: AddChatMemberRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_write", resource_id_param="chat_id")),
):
    member_ids: list[uuid.UUID] = []
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
        member_ids = await service.get_member_ids(chat_id=chat.id)
        item = ChatMemberOut(
            id=member.id,
            chat_id=member.chat_id,
            user_id=member.user_id,
            role=member.role,
            last_read_seq_no=member.last_read_seq_no,
            created_at=member.created_at,
        )

    event_payload = {
        "type": "chat.member.joined",
        "schema_version": 1,
        "chat_id": str(chat_id),
        "member": item.model_dump(mode="json"),
    }
    for member_id in member_ids:
        await ws_manager.send_personal_message(event_payload, member_id)
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
    after_seq_no: int | None = Query(default=None, ge=0),
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
            if after_seq_no is not None and (before_seq_no is not None or latest or offset > 0):
                return ApiResponse(
                    ok=False,
                    data=None,
                    error={
                        "code": "VALIDATION_ERROR",
                        "message": "after_seq_no нельзя комбинировать с before_seq_no/latest/offset",
                    },
                )
            messages = await service.list_messages_for_user(
                chat=chat,
                user_id=current_user.user_id,
                limit=limit,
                offset=offset,
                after_seq_no=after_seq_no,
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
                client_message_id=message.client_message_id,
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
            client_message_id=message.client_message_id,
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


@router.post("/chats/{chat_id}/attachments/init-upload", response_model=ApiResponse[ChatAttachmentInitOut])
async def init_attachment_upload(
    chat_id: uuid.UUID,
    body: ChatAttachmentInitRequest,
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
            payload = await service.init_attachment_upload(chat=chat, actor_id=current_user.user_id, body=body)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()
        item = ChatAttachmentInitOut.model_validate(payload)
    return ApiResponse(data=item)


@router.post("/chats/{chat_id}/attachments/finish-upload", response_model=ApiResponse[ChatAttachmentOut])
async def finish_attachment_upload(
    chat_id: uuid.UUID,
    body: ChatAttachmentFinishRequest,
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
            uploaded = await service.finish_attachment_upload(chat=chat, actor_id=current_user.user_id, body=body)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()
        item = ChatAttachmentOut(
            file_id=uploaded.id,
            filename=uploaded.filename,
            original_name=uploaded.original_name,
            content_type=uploaded.content_type,
            size=int(uploaded.size),
            status=str(uploaded.status or "ready"),
        )
    return ApiResponse(data=item)


@router.post("/chats/{chat_id}/attachments/{file_id}/abort-upload", response_model=ApiResponse[None])
async def abort_attachment_upload(
    chat_id: uuid.UUID,
    file_id: uuid.UUID,
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
            await service.abort_attachment_upload(chat=chat, actor_id=current_user.user_id, file_id=file_id)
        except ChatServiceError as error:
            return _service_error(error)
        await uow.commit()
    return ApiResponse(data=None)


@router.get(
    "/chats/{chat_id}/attachments/{file_id}/download-url",
    response_model=ApiResponse[ChatAttachmentDownloadOut],
)
async def get_attachment_download_url(
    chat_id: uuid.UUID,
    file_id: uuid.UUID,
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
            url = await service.get_attachment_download_url(
                chat=chat,
                user_id=current_user.user_id,
                file_id=file_id,
                expires_in=600,
            )
        except ChatServiceError as error:
            CHAT_ATTACHMENT_DOWNLOAD_URL_REQUESTS_TOTAL.labels(status="error").inc()
            return _service_error(error)
        CHAT_ATTACHMENT_DOWNLOAD_URL_REQUESTS_TOTAL.labels(status="ok").inc()
        item = ChatAttachmentDownloadOut(url=url, expires_in=600)
    return ApiResponse(data=item)


@router.get("/chats/{chat_id}/attachments/{file_id}/preview")
async def get_attachment_preview(
    chat_id: uuid.UUID,
    file_id: uuid.UUID,
    request: Request,
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
            return JSONResponse(
                status_code=404,
                content=ApiResponse(
                    ok=False,
                    data=None,
                    error={"code": "NOT_FOUND", "message": CHAT_NOT_FOUND_MESSAGE},
                ).model_dump(mode="json"),
            )
        try:
            db_file = await service.get_attachment_file_for_user(
                chat=chat,
                user_id=current_user.user_id,
                file_id=file_id,
            )
        except ChatServiceError as error:
            return _error_response(error)

    content_type = str(db_file.content_type or "").lower()
    if not content_type.startswith("image/"):
        return JSONResponse(
            status_code=415,
            content=ApiResponse(
                ok=False,
                data=None,
                error={"code": "UNSUPPORTED_MEDIA_TYPE", "message": "Preview доступен только для изображений"},
            ).model_dump(mode="json"),
        )

    try:
        meta = files_storage.head_object(db_file.s3_key, db_file.s3_bucket)
    except (BotoCoreError, ClientError, KeyError, OSError, ValueError):
        logger.exception(
            "chat_attachment_preview_head_failed",
            extra={"file_id": str(file_id), "chat_id": str(chat_id)},
        )
        return JSONResponse(
            status_code=502,
            content=ApiResponse(
                ok=False,
                data=None,
                error={"code": "STORAGE_HEAD_ERROR", "message": "Не удалось проверить preview"},
            ).model_dump(mode="json"),
        )

    etag = str(meta.get("ETag") or "").strip()
    headers = {
        "Cache-Control": CHAT_ATTACHMENT_PREVIEW_CACHE_CONTROL,
        "Content-Disposition": content_disposition_inline(db_file.original_name),
        "Vary": "Cookie, Authorization",
    }
    if etag:
        headers["ETag"] = etag
    if meta.get("LastModified"):
        headers["Last-Modified"] = meta["LastModified"].strftime("%a, %d %b %Y %H:%M:%S GMT")

    if etag and _etag_matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)

    try:
        stream, object_meta = files_storage.stream_file(db_file.s3_key, db_file.s3_bucket)
    except (BotoCoreError, ClientError, KeyError, OSError, ValueError):
        logger.exception(
            "chat_attachment_preview_stream_failed",
            extra={"file_id": str(file_id), "chat_id": str(chat_id)},
        )
        return JSONResponse(
            status_code=502,
            content=ApiResponse(
                ok=False,
                data=None,
                error={"code": "STORAGE_STREAM_ERROR", "message": "Не удалось загрузить preview"},
            ).model_dump(mode="json"),
        )

    if object_meta.get("ContentLength"):
        headers["Content-Length"] = str(int(object_meta["ContentLength"]))
    return StreamingResponse(stream, media_type=db_file.content_type, headers=headers)


@router.get("/client-config", response_model=ApiResponse[ChatClientConfigOut])
async def get_chat_client_config(
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_read")),
):
    rollout_percent = int(settings.CHAT_REALTIME_ROLLOUT_PERCENT or 0)
    realtime_enabled = bool(settings.CHAT_REALTIME_ROLLOUT_ENABLED) and _is_user_in_rollout(
        user_id=current_user.user_id,
        percent=rollout_percent,
    )
    return ApiResponse(
        data=ChatClientConfigOut(
            realtime_enabled=realtime_enabled,
            realtime_rollout_percent=rollout_percent,
            telemetry_enabled=bool(settings.CHAT_TELEMETRY_ENABLED),
        )
    )


@router.post("/telemetry", response_model=ApiResponse[None])
async def post_chat_telemetry(
    body: ChatTelemetryRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="chat", permission="can_read")),
):
    if not settings.CHAT_TELEMETRY_ENABLED:
        CHAT_TELEMETRY_EVENTS_TOTAL.labels(event=body.event, status="disabled").inc()
        return ApiResponse(data=None)

    CHAT_TELEMETRY_EVENTS_TOTAL.labels(event=body.event, status="accepted").inc()
    if body.event == "message_lag" and body.value is not None:
        CHAT_MESSAGE_LAG_SECONDS.observe(float(body.value))
    logger.info(
        "chat_telemetry_event",
        extra={
            "event": body.event,
            "value": body.value,
            "meta": body.meta or {},
            "user_id": str(current_user.user_id),
            "org_id": str(current_user.org_id),
        },
    )
    return ApiResponse(data=None)


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
