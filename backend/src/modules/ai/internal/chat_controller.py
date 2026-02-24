from __future__ import annotations

"""Оркестрация чата AI.

Файл содержит поэтапную логику обработки запросов `/ai/chat`:
1) проверка фичи/конфигурации
2) загрузка истории из БД
3) сбор контекста (опционально)
4) проверка лимитов
5) вызов провайдера (OpenAI-compatible)
6) парсинг action и выполнение (если есть)
7) запись результатов в БД и обновление метрик
"""

import logging

import httpx
from sqlalchemy import select

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.metrics_custom import AI_LIMIT_REJECTIONS_TOTAL, AI_REQUESTS_TOTAL, AI_TOKENS_TOTAL
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.intent_overrides import apply_ui_intent_overrides
from src.modules.ai.limits import check_ai_limits, is_org_ai_enabled
from src.modules.ai.models import AIChatMessage, AIUsageLog
from src.modules.ai.schemas import ChatRequest, ChatResponse
from src.modules.ai.service import (
    build_messages,
    build_org_context_for_user,
    call_openai_compatible_api,
    estimate_tokens,
    extract_action_payload,
    get_or_create_session,
    handle_create_columns_action,
    handle_create_dashboard_action,
    handle_create_kb_page_action,
    handle_create_records_action,
    handle_create_schedule_event_action,
    handle_create_table_action,
)
from src.modules.auth.dependencies import CurrentUser

logger = logging.getLogger(__name__)

MAX_CLIENT_HISTORY_MESSAGES = 20
MAX_CLIENT_HISTORY_CONTENT_CHARS = 4000

ACTION_HANDLERS = {
    "create_dashboard": handle_create_dashboard_action,
    "create_table": handle_create_table_action,
    "create_columns": handle_create_columns_action,
    "create_records": handle_create_records_action,
    "create_schedule_event": handle_create_schedule_event_action,
    "create_kb_page": handle_create_kb_page_action,
}

ACTION_ALLOWED_ROLES = {
    "create_dashboard": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
    "create_table": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
    "create_columns": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
    "create_records": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
    "create_schedule_event": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value, UserRole.EMPLOYEE.value},
    "create_kb_page": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
}


def _record_metric(status: str, tokens: int | None = None) -> None:
    """Безопасно записать метрики AI-запроса.

    Args:
        status: Статус запроса для метрики `crm_ai_requests_total`.
        tokens: Количество токенов для `crm_ai_tokens_total` (опционально).

    Returns:
        None.
    """
    try:
        AI_REQUESTS_TOTAL.labels(model=settings.OPENAI_MODEL, status=status).inc()
        if tokens is not None and tokens > 0:
            AI_TOKENS_TOTAL.labels(model=settings.OPENAI_MODEL).inc(float(tokens))
    except Exception as exc:
        logger.warning("ai_metrics_record_failed", exc_info=exc)


def _record_limit_rejection(code: str) -> None:
    """Зафиксировать отклонение запроса лимитером.

    Args:
        code: Код ошибки лимита (например, `AI_RATE_LIMIT`).

    Returns:
        None.
    """
    try:
        AI_LIMIT_REJECTIONS_TOTAL.labels(code=code).inc()
    except Exception as exc:
        logger.warning("ai_limit_rejection_metric_failed", exc_info=exc)


def _sanitize_client_history(history_rows: list) -> list[dict[str, str]]:
    """Нормализовать историю из запроса и ограничить размер.

    Args:
        history_rows: Список сообщений `body.history`.

    Returns:
        Безопасный список словарей `{role, content}` с ограниченным размером.
    """
    normalized: list[dict[str, str]] = []
    for item in history_rows[:MAX_CLIENT_HISTORY_MESSAGES]:
        role = str(getattr(item, "role", "user") or "user").strip().lower()
        content = str(getattr(item, "content", "") or "").strip()
        if not content:
            continue
        normalized.append(
            {
                "role": role,
                "content": content[:MAX_CLIENT_HISTORY_CONTENT_CHARS],
            }
        )
    return normalized


def _extract_provider_reply(data: dict) -> str:
    """Извлечь текст ответа из OpenAI-compatible payload.

    Args:
        data: JSON-ответ провайдера.

    Returns:
        Текст ответа ассистента.

    Raises:
        ValueError: Если структура ответа некорректная или пустая.
    """
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("AI_EMPTY_CHOICES")
    first_choice = choices[0]
    if not isinstance(first_choice, dict):
        raise ValueError("AI_INVALID_CHOICE")
    message = first_choice.get("message")
    if not isinstance(message, dict):
        raise ValueError("AI_INVALID_MESSAGE")
    content = message.get("content")
    if content is None:
        raise ValueError("AI_EMPTY_REPLY")
    return str(content)


def _estimate_prompt_tokens(messages: list[dict]) -> int:
    """Оценить токены prompt без склейки в одну большую строку.

    Args:
        messages: Список сообщений для провайдера.

    Returns:
        Приблизительное число токенов prompt.
    """
    tokens = 0
    for msg in messages:
        tokens += estimate_tokens(str(msg.get("content") or ""))
    # Небольшой оверхед на структуру chat-messages.
    return int(tokens + max(0, len(messages) * 4))


async def _execute_action(
    uow: UnitOfWork,
    current_user: CurrentUser,
    action_payload: dict,
    user_message: str,
) -> dict | None:
    """Выполнить распознанное действие (crm_action) в рамках UnitOfWork.

    Args:
        uow: UnitOfWork с открытой транзакцией.
        current_user: Текущий пользователь (org_id/user_id/role).
        action_payload: Payload действия (dict) распознанный из ответа модели.
        user_message: Исходное сообщение пользователя (для эвристик/подсказок).

    Returns:
        dict с результатом действия или None, если action неизвестен/не поддержан.
    """
    action_name = str(action_payload.get("action") or "").strip()
    handler = ACTION_HANDLERS.get(action_name)
    if handler is None:
        return None
    allowed_roles = ACTION_ALLOWED_ROLES.get(action_name, set())
    if current_user.role not in allowed_roles:
        return {
            "action": action_name,
            "ok": False,
            "error": "forbidden",
            "message": f"Роль '{current_user.role}' не может выполнять действие '{action_name}'.",
        }
    return await handler(
        uow,
        current_user.org_id,
        current_user.user_id,
        action_payload,
        user_message=user_message,
    )


async def run_ai_chat(body: ChatRequest, current_user: CurrentUser) -> ApiResponse[ChatResponse]:
    """Обработать запрос `/ai/chat`.

    Args:
        body: Тело запроса (сообщение, история, настройки контекста и т.п.).
        current_user: Текущий пользователь.

    Returns:
        ApiResponse[ChatResponse] с ответом ассистента и (опционально) результатом действия.
    """
    # Этап 1: проверка фичи/конфигурации.
    if not settings.ENABLE_AI:
        return ApiResponse(ok=False, data=None, error={"code": "AI_DISABLED", "message": "AI отключен администратором."})

    async with UnitOfWork() as uow:
        org_ai_enabled = await is_org_ai_enabled(uow.session, org_id=current_user.org_id)
    if not org_ai_enabled:
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_DISABLED", "message": "AI отключен для вашей организации администратором."},
        )

    bearer_token = settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY
    if not bearer_token:
        return ApiResponse(
            ok=False,
            data=None,
            error={
                "code": "AI_NOT_CONFIGURED",
                "message": "AI API token is not configured. Set OPENAI_BEARER_TOKEN in .env",
            },
        )

    # Этап 2: подготовка system_prompt (UI intent = подсказка, не приказ).
    system_prompt = body.system_prompt or settings.AI_SYSTEM_PROMPT
    if body.ui_intent:
        intent = str(body.ui_intent).strip()
        params = body.ui_intent_params if isinstance(body.ui_intent_params, dict) else {}
        widget_type = str(params.get("widget_type") or "").strip()
        system_prompt = (
            system_prompt
            + "\n\n"
            + "UI_INTENT (подсказка от интерфейса):\n"
            + f"- intent: {intent}\n"
            + (f"- widget_type: {widget_type}\n" if widget_type else "")
            + "\nПравила:\n"
            + "- Это только подсказка. Выполняй действие ТОЛЬКО если текст пользователя реально просит это сделать.\n"
            + "- Если пользователь пишет привет/спасибо/вопрос не по теме выбранного действия, просто ответь и НЕ добавляй ```crm_action```.\n"
            + "- Если действие требует уточнений, задай 1-2 вопроса вместо выполнения.\n"
        )
    context_options = body.context_options or {}

    # Этап 3: загрузка/создание сессии + последние сообщения из БД.
    # Важно: фиксируем session_id один раз на весь запрос, чтобы избежать гонок и
    # случайного создания разных сессий на разных этапах.
    async with UnitOfWork() as uow:
        session = await get_or_create_session(uow, current_user.org_id, current_user.user_id, body.chat_id, body.message)
        session_id = session.id
        # Сохраняем новую сессию сразу, чтобы следующий UoW гарантированно её видел.
        await uow.commit()
        db_messages = (
            await uow.session.execute(
                select(AIChatMessage)
                .where(
                    AIChatMessage.session_id == session_id,
                    AIChatMessage.org_id == current_user.org_id,
                    AIChatMessage.user_id == current_user.user_id,
                )
                .order_by(AIChatMessage.created_at.asc())
                .limit(60)
            )
        ).scalars().all()

    # Этап 4: сбор контекста организации (опционально).
    org_context = ""
    context_meta: dict | None = None
    if body.include_context:
        org_context, context_meta = await build_org_context_for_user(current_user.org_id, current_user.user_id, context_options)

    # Этап 5: предварительная оценка токенов и проверка лимитов.
    max_tokens_per_request = int(settings.AI_MAX_TOKENS_PER_REQUEST)
    estimated_prompt_tokens = estimate_tokens(body.message) + estimate_tokens(org_context) + 280
    estimated_request_tokens = int(estimated_prompt_tokens + max_tokens_per_request)
    async with UnitOfWork() as uow:
        ok, err = await check_ai_limits(
            uow.session,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            estimated_request_tokens=estimated_request_tokens,
        )
        if not ok:
            _record_metric("limit_exceeded")
            _record_limit_rejection(str((err or {}).get("code") or "UNKNOWN"))
            return ApiResponse(ok=False, data=None, error=err)

    # Этап 6: сбор сообщений для провайдера.
    history_rows = _sanitize_client_history(body.history)
    messages = build_messages(system_prompt, org_context, db_messages, history_rows, body.message)

    # Этап 7: поддержка "прямых команд" (когда пользователь сам прислал crm_action).
    direct_action_payload, cleaned_direct_reply = extract_action_payload(body.message)
    if direct_action_payload:
        async with UnitOfWork() as uow:
            action_result = await _execute_action(uow, current_user, direct_action_payload, body.message)

            user_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={"include_context": body.include_context, "context_options": context_options, "direct_action": True},
            )
            assistant_reply = cleaned_direct_reply or "Команда выполнена."
            assistant_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="assistant",
                content=assistant_reply,
                token_count=0,
                meta={"action_requested": True, "action_result": action_result, "direct_action": True},
            )
            uow.session.add(user_msg)
            uow.session.add(assistant_msg)
            await uow.commit()

        return ApiResponse(
            data=ChatResponse(
                reply=assistant_reply,
                model=settings.OPENAI_MODEL,
                usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                chat_id=str(session_id),
                context_estimate=context_meta,
                action_result=action_result,
            )
        )

    # Этап 8: вызов провайдера, парсинг ответа и запись в БД.
    try:
        data = await call_openai_compatible_api(
            settings.AI_BASE_URL,
            bearer_token,
            settings.OPENAI_MODEL,
            messages,
            max_tokens=max_tokens_per_request,
        )
        reply_raw = _extract_provider_reply(data)
        action_payload, reply = extract_action_payload(reply_raw)
        action_payload = apply_ui_intent_overrides(action_payload, body.ui_intent, body.ui_intent_params)
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        if not usage or not int(usage.get("total_tokens", 0) or 0):
            prompt_tokens_est = _estimate_prompt_tokens(messages)
            completion_tokens_est = int(estimate_tokens(reply_raw))
            usage = {
                "prompt_tokens": prompt_tokens_est,
                "completion_tokens": completion_tokens_est,
                "total_tokens": prompt_tokens_est + completion_tokens_est,
                "estimated": True,
            }

        async with UnitOfWork() as uow:
            user_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={"include_context": body.include_context, "context_options": context_options},
            )
            assistant_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="assistant",
                content=reply,
                token_count=int(usage.get("total_tokens", 0) or 0),
                meta={"action_requested": bool(action_payload)},
            )
            uow.session.add(user_msg)
            uow.session.add(assistant_msg)
            uow.session.add(
                AIUsageLog(
                    org_id=current_user.org_id,
                    user_id=current_user.user_id,
                    model=settings.OPENAI_MODEL,
                    prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
                    completion_tokens=int(usage.get("completion_tokens", 0) or 0),
                    total_tokens=int(usage.get("total_tokens", 0) or 0),
                    message_preview=body.message[:200],
                )
            )

            action_result = None
            if action_payload:
                action_result = await _execute_action(uow, current_user, action_payload, body.message)
                if action_result is not None:
                    assistant_msg.meta = {"action_requested": True, "action_result": action_result}

            await uow.commit()

        _record_metric("ok", int(usage.get("total_tokens", 0) or 0))

        return ApiResponse(
            data=ChatResponse(
                reply=reply,
                model=settings.OPENAI_MODEL,
                usage=usage,
                chat_id=str(session_id),
                context_estimate=context_meta,
                action_result=action_result,
            )
        )
    except ValueError as exc:
        _record_metric("bad_provider_response")
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_BAD_PROVIDER_RESPONSE", "message": "AI provider returned an invalid response format."},
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            _record_metric("unauthorized")
            return ApiResponse(
                ok=False,
                data=None,
                error={
                    "code": "AI_PROVIDER_UNAUTHORIZED",
                    "message": "AI provider authentication failed. Check provider credentials in server configuration.",
                },
            )
        _record_metric("error")
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_ERROR", "message": "AI provider error. Please try again later."},
        )
    except Exception:
        _record_metric("error")
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_ERROR", "message": "AI service internal error. Please try again later."},
        )
