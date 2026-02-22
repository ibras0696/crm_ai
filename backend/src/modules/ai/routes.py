"""AI API routes.

Роутер должен оставаться тонким: без SQL и без бизнес-логики.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.config import settings
from src.modules.ai.api_service import (
    build_ai_status,
    build_ai_usage_by_user,
    build_chat_messages,
    build_chat_sessions,
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
from src.modules.ai.service import build_messages, build_org_context_for_user, estimate_tokens
from src.modules.auth.dependencies import CurrentUser, require_roles

router = APIRouter(prefix="/ai", tags=["ai"])


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
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Список чат-сессий текущего пользователя.

    Args:
        current_user: Текущий пользователь.

    Returns:
        ApiResponse со списком ChatSessionOut.
    """
    rows = await build_chat_sessions(org_id=current_user.org_id, user_id=current_user.user_id)
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
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": "Invalid chat id"})

    ok = await delete_chat_session(org_id=current_user.org_id, user_id=current_user.user_id, chat_id=chat_uuid)
    if not ok:
        return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Chat not found"})
    return ApiResponse(data=None)


@router.get("/chats/{chat_id}/messages", response_model=ApiResponse[list[ChatMessageOut]])
async def ai_chat_messages(
    chat_id: str,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Получить сообщения чат-сессии.

    Args:
        chat_id: ID сессии.
        current_user: Текущий пользователь.

    Returns:
        ApiResponse со списком сообщений.
    """
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": "Invalid chat id"})

    rows = await build_chat_messages(org_id=current_user.org_id, user_id=current_user.user_id, chat_id=chat_uuid)
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
    if not body.include_context:
        return ApiResponse(
            data={
                "enabled": False,
                "sources": {
                    "kb": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                    "table_schema": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                    "table_records": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                    "schedule": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                },
                "selected": {"kb_pages": [], "tables": [], "schedule_events": []},
                "model_overhead_tokens": 0,
                "max_context_tokens": 0,
                "used_context_tokens": 0,
                "context_truncated": False,
                "estimated_prompt_tokens": 0,
                "prompt_message_overhead_tokens": 0,
                "estimated_total_tokens": 0,
            }
        )
    org_context, meta = await build_org_context_for_user(current_user.org_id, current_user.user_id, body.context_options)

    system_prompt = body.system_prompt or settings.AI_SYSTEM_PROMPT
    user_message = body.user_message or ""
    history = [{"role": h.role, "content": h.content} for h in (body.history or [])][-10:]

    prompt_messages = build_messages(system_prompt, org_context, db_messages=[], history=history, user_message=user_message)
    message_overhead = 4 * len(prompt_messages) + 2
    content_joined = "\n".join((m.get("content") or "") for m in prompt_messages)
    estimated_prompt_tokens = estimate_tokens(content_joined) + message_overhead

    meta["prompt_message_overhead_tokens"] = int(message_overhead)
    meta["estimated_prompt_tokens"] = int(estimated_prompt_tokens)
    meta["estimated_total_tokens"] = int(estimated_prompt_tokens)
    return ApiResponse(data=meta)


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
