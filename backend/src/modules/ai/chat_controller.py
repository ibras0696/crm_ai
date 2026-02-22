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

import httpx
from sqlalchemy import select

from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.metrics_custom import AI_REQUESTS_TOTAL, AI_TOKENS_TOTAL
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.intent_overrides import apply_ui_intent_overrides
from src.modules.ai.limits import check_ai_limits
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
    if action_name == "create_dashboard":
        return await handle_create_dashboard_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_table":
        return await handle_create_table_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_columns":
        return await handle_create_columns_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_records":
        return await handle_create_records_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_schedule_event":
        return await handle_create_schedule_event_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_kb_page":
        return await handle_create_kb_page_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    return None


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
    async with UnitOfWork() as uow:
        session = await get_or_create_session(uow, current_user.org_id, current_user.user_id, body.chat_id, body.message)
        db_messages = (
            await uow.session.execute(
                select(AIChatMessage)
                .where(
                    AIChatMessage.session_id == session.id,
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
            return ApiResponse(ok=False, data=None, error=err)

    # Этап 6: сбор сообщений для провайдера.
    history_rows = [{"role": m.role, "content": m.content} for m in body.history]
    messages = build_messages(system_prompt, org_context, db_messages, history_rows, body.message)

    # Этап 7: поддержка "прямых команд" (когда пользователь сам прислал crm_action).
    direct_action_payload, cleaned_direct_reply = extract_action_payload(body.message)
    if direct_action_payload:
        async with UnitOfWork() as uow:
            session = await get_or_create_session(uow, current_user.org_id, current_user.user_id, body.chat_id, body.message)
            action_result = await _execute_action(uow, current_user, direct_action_payload, body.message)

            user_msg = AIChatMessage(
                session_id=session.id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={"include_context": body.include_context, "context_options": context_options, "direct_action": True},
            )
            assistant_reply = cleaned_direct_reply or "Команда выполнена."
            assistant_msg = AIChatMessage(
                session_id=session.id,
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
                chat_id=str(session.id),
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
        reply_raw = data["choices"][0]["message"]["content"]
        action_payload, reply = extract_action_payload(reply_raw)
        action_payload = apply_ui_intent_overrides(action_payload, body.ui_intent, body.ui_intent_params)
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        if not usage or not int(usage.get("total_tokens", 0) or 0):
            prompt_text = "\n".join([str(m.get("content") or "") for m in messages])
            prompt_tokens_est = int(estimate_tokens(prompt_text))
            completion_tokens_est = int(estimate_tokens(reply_raw))
            usage = {
                "prompt_tokens": prompt_tokens_est,
                "completion_tokens": completion_tokens_est,
                "total_tokens": prompt_tokens_est + completion_tokens_est,
                "estimated": True,
            }

        async with UnitOfWork() as uow:
            session = await get_or_create_session(uow, current_user.org_id, current_user.user_id, body.chat_id, body.message)
            user_msg = AIChatMessage(
                session_id=session.id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={"include_context": body.include_context, "context_options": context_options},
            )
            assistant_msg = AIChatMessage(
                session_id=session.id,
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

        try:
            AI_REQUESTS_TOTAL.labels(model=settings.OPENAI_MODEL, status="ok").inc()
            AI_TOKENS_TOTAL.labels(model=settings.OPENAI_MODEL).inc(float(int(usage.get("total_tokens", 0) or 0)))
        except Exception:
            pass

        return ApiResponse(
            data=ChatResponse(
                reply=reply,
                model=settings.OPENAI_MODEL,
                usage=usage,
                chat_id=str(session.id),
                context_estimate=context_meta,
                action_result=action_result,
            )
        )
    except httpx.HTTPStatusError as e:
        body_text = ""
        try:
            body_text = e.response.text[:300]
        except Exception:
            pass
        if e.response.status_code in (401, 403):
            try:
                AI_REQUESTS_TOTAL.labels(model=settings.OPENAI_MODEL, status="unauthorized").inc()
            except Exception:
                pass
            return ApiResponse(
                ok=False,
                data=None,
                error={
                    "code": "AI_PROVIDER_UNAUTHORIZED",
                    "message": (
                        f"AI провайдер вернул {e.response.status_code} (Unauthorized). "
                        "Проверьте OPENAI_BEARER_TOKEN/OPENAI_API_KEY и AI_BASE_URL (secrets.yml), затем перезапустите backend. "
                        f"Ответ провайдера: {body_text}"
                    ),
                },
            )
        try:
            AI_REQUESTS_TOTAL.labels(model=settings.OPENAI_MODEL, status="error").inc()
        except Exception:
            pass
        return ApiResponse(ok=False, data=None, error={"code": "AI_ERROR", "message": f"AI API error {e.response.status_code}: {body_text}"})
    except Exception as e:
        return ApiResponse(ok=False, data=None, error={"code": "AI_ERROR", "message": f"AI error: {str(e)}"})
