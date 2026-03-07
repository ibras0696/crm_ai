"""AI API routes.

Роутер должен оставаться тонким: без SQL и без бизнес-логики.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Query

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.modules.ai.api_service import (
    build_ai_status,
    build_ai_usage_by_user,
    build_chat_messages,
    build_chat_sessions,
    build_context_estimate,
    build_context_sources,
    create_chat_session,
    delete_chat_session,
)
from src.modules.ai.chat_controller import run_ai_chat
from src.modules.ai.schemas import (
    ChatMessageOut,
    ChatRequest,
    ChatResponse,
    ChatSessionOut,
    ContextEstimateRequest,
    CreateChatRequest,
)
from src.modules.auth.dependencies import CurrentUser, require_roles

router = APIRouter(prefix="/ai", tags=["ai"])


def _parse_chat_uuid(chat_id: str) -> uuid.UUID | None:
    """Преобразовать chat_id в UUID.

    Args:
        chat_id: ID чата в строковом формате.

    Returns:
        UUID или None, если формат невалиден.
    """
    try:
        return uuid.UUID(chat_id)
    except ValueError:
        return None


@router.post("/chat", response_model=ApiResponse[ChatResponse])
async def ai_chat(
    body: ChatRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Отправить сообщение в AI чат.

    Args:
        body: Запрос чата.
        current_user: Текущий пользователь.

    Returns:
        ApiResponse[ChatResponse] с ответом модели и (опционально) результатом действия.
    """
    return await run_ai_chat(body, current_user)


@router.get("/status", response_model=ApiResponse[dict])
async def ai_status(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Статус AI (включен ли, настроен ли, статистика и лимиты).

    Args:
        current_user: Текущий пользователь.

    Returns:
        ApiResponse с данными для экрана "Статистика".
    """
    return ApiResponse(data=await build_ai_status(org_id=current_user.org_id))


@router.get("/usage", response_model=ApiResponse[list[dict]])
async def ai_usage_detail(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    """Детализация использования AI по пользователям организации.

    Args:
        current_user: Текущий пользователь (owner/admin).

    Returns:
        ApiResponse со списком агрегаций по user_id.
    """
    return ApiResponse(data=await build_ai_usage_by_user(org_id=current_user.org_id))


@router.get("/chats", response_model=ApiResponse[list[ChatSessionOut]])
async def ai_chats(
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Список чат-сессий текущего пользователя.

    Args:
        limit: Лимит количества сессий.
        offset: Смещение.
        current_user: Текущий пользователь.

    Returns:
        ApiResponse со списком ChatSessionOut.
    """
    rows = await build_chat_sessions(
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        limit=limit,
        offset=offset,
    )
    return ApiResponse(data=[ChatSessionOut(**r) for r in rows])


@router.post("/chats", response_model=ApiResponse[ChatSessionOut])
async def ai_create_chat(
    body: CreateChatRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Создать новую чат-сессию.

    Args:
        body: Данные создания (title опционально).
        current_user: Текущий пользователь.

    Returns:
        ApiResponse с созданной сессией.
    """
    title = (body.title or "Новый чат").strip()[:255] or "Новый чат"
    row = await create_chat_session(org_id=current_user.org_id, user_id=current_user.user_id, title=title)
    return ApiResponse(data=ChatSessionOut(**row))


@router.delete("/chats/{chat_id}", response_model=ApiResponse[None])
async def ai_delete_chat(
    chat_id: str,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Удалить чат-сессию пользователя.

    Args:
        chat_id: ID сессии.
        current_user: Текущий пользователь.

    Returns:
        ApiResponse[None].
    """
    chat_uuid = _parse_chat_uuid(chat_id)
    if chat_uuid is None:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": "Invalid chat id"})

    ok = await delete_chat_session(org_id=current_user.org_id, user_id=current_user.user_id, chat_id=chat_uuid)
    if not ok:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Chat not found"})
    return ApiResponse(data=None)


@router.get("/chats/{chat_id}/messages", response_model=ApiResponse[list[ChatMessageOut]])
async def ai_chat_messages(
    chat_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Получить сообщения чат-сессии.

    Args:
        chat_id: ID сессии.
        limit: Лимит количества сообщений.
        offset: Смещение.
        current_user: Текущий пользователь.

    Returns:
        ApiResponse со списком сообщений.
    """
    chat_uuid = _parse_chat_uuid(chat_id)
    if chat_uuid is None:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": "Invalid chat id"})

    rows = await build_chat_messages(
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        chat_id=chat_uuid,
        limit=limit,
        offset=offset,
    )
    if rows is None:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Chat not found"})
    return ApiResponse(
        data=[
            ChatMessageOut(
                id=str(m.id),
                role=m.role,
                content=m.content,
                token_count=m.token_count,
                created_at=m.created_at,
                meta=m.meta,
            )
            for m in rows
        ]
    )


@router.post("/context-estimate", response_model=ApiResponse[dict])
async def ai_context_estimate(
    body: ContextEstimateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Оценить контекст и стоимость следующего запроса (эвристика).

    Args:
        body: Параметры оценки контекста.
        current_user: Текущий пользователь.

    Returns:
        ApiResponse с оценкой: used/estimated tokens и разбиением по источникам.
    """
    history = [{"role": h.role, "content": h.content} for h in (body.history or [])]
    data = await build_context_estimate(
        org_id=current_user.org_id,
        user_id=current_user.user_id,
        include_context=bool(body.include_context),
        context_options=body.context_options,
        system_prompt=body.system_prompt,
        history=history,
        user_message=body.user_message,
    )
    return ApiResponse(data=data)


@router.get("/context-sources", response_model=ApiResponse[dict])
async def ai_context_sources(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Получить доступные источники контекста для выбора в UI.

    Args:
        current_user: Текущий пользователь.

    Returns:
        ApiResponse со списками kb_pages/tables/schedule_events.
    """
    return ApiResponse(data=await build_context_sources(org_id=current_user.org_id))
