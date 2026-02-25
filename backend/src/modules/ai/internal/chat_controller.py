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
import uuid
import json
import re

import httpx
from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.metrics_custom import AI_LIMIT_REJECTIONS_TOTAL, AI_REQUESTS_TOTAL, AI_TOKENS_TOTAL
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.errors import AIModuleError
from src.modules.ai.internal.repository import AIRepository
from src.modules.ai.intent_overrides import apply_ui_intent_overrides
from src.modules.ai.limits import check_ai_limits, is_org_ai_enabled
from src.modules.ai.models import AIChatMessage, AIUsageLog
from src.modules.ai.schemas import ChatRequest, ChatResponse
from src.modules.billing.token_wallet import spend_tokens
from src.modules.ai.service import (
    build_messages,
    build_org_context_for_user,
    call_openai_compatible_api,
    call_timeweb_native_api,
    estimate_tokens,
    extract_action_payload,
    get_or_create_session,
    handle_create_columns_action,
    handle_create_dashboard_action,
    handle_create_kb_page_action,
    handle_create_records_action,
    handle_create_schedule_event_action,
    handle_create_table_action,
    resolve_timeweb_agent_id,
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
    if isinstance(data.get("message"), str) and data.get("message"):
        return str(data.get("message"))
    nested = data.get("data")
    if isinstance(nested, dict):
        if isinstance(nested.get("message"), str) and nested.get("message"):
            return str(nested.get("message"))
        response = nested.get("response")
        if isinstance(response, dict) and isinstance(response.get("message"), str) and response.get("message"):
            return str(response.get("message"))

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


def _extract_provider_message_id(data: dict) -> str | None:
    """Извлечь идентификатор сообщения провайдера (для parent_message_id)."""
    for key in ("id", "message_id", "response_id"):
        value = data.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    nested = data.get("data")
    if isinstance(nested, dict):
        for key in ("id", "message_id", "response_id"):
            value = nested.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        response = nested.get("response")
        if isinstance(response, dict):
            for key in ("id", "message_id", "response_id"):
                value = response.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()
    return None


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


def _build_native_provider_message(
    *,
    messages: list[dict[str, str]],
    user_message: str,
    has_parent: bool,
) -> str:
    """Собрать текст для нативного Timeweb /call.

    Для первого сообщения отправляем полный инструктивный контекст.
    Для продолжения цепочки отправляем только user message.
    """
    if has_parent:
        return user_message
    chunks: list[str] = []
    for msg in messages:
        role = str(msg.get("role") or "").strip().upper() or "MSG"
        content = str(msg.get("content") or "").strip()
        if not content:
            continue
        chunks.append(f"{role}:\n{content}")
    return "\n\n".join(chunks) if chunks else user_message


def _looks_like_table_create_request(text: str) -> bool:
    t = (text or "").lower()
    return ("созд" in t and "таблиц" in t) or ("create" in t and "table" in t)


def _extract_requested_record_count(text: str) -> int | None:
    t = (text or "").lower()
    patterns = [
        r"(\d{1,5})\s*(?:запис(?:ей|и|ь)|строк(?:и)?|слов(?:а)?)",
        r"(?:на|с)\s*(\d{1,5})\s*(?:запис(?:ей|и|ь)|строк(?:и)?|слов(?:а)?)",
    ]
    for p in patterns:
        m = re.search(p, t)
        if m:
            try:
                n = int(m.group(1))
                if 1 <= n <= 5000:
                    return n
            except Exception:
                return None
    return None


def _looks_like_broken_action(reply_raw: str) -> bool:
    text = (reply_raw or "").lower()
    return ("action" in text and "{" in text) or "crm_action" in text


def _claims_action_completed(reply_text: str) -> bool:
    text = (reply_text or "").lower()
    markers = [
        "создал",
        "создала",
        "создана таблица",
        "добавил",
        "добавила",
        "заполнил",
        "заполнила",
        "выполнил",
        "готово, создано",
    ]
    return any(m in text for m in markers)


async def _repair_action_payload_with_model(
    *,
    base_url: str,
    bearer_token: str,
    model: str,
    broken_reply: str,
) -> dict | None:
    """Попробовать восстановить валидный action JSON из битого ответа модели."""
    repair_messages = [
        {
            "role": "system",
            "content": (
                "Ты валидатор JSON-действий CRM. "
                "Верни только один валидный JSON-объект действия. "
                "Без комментариев, без markdown, без лишнего текста."
            ),
        },
        {
            "role": "user",
            "content": (
                "Преобразуй это в валидный JSON действия. "
                "Если действия нет или нельзя восстановить, верни {}.\n\n"
                f"{broken_reply}"
            ),
        },
    ]
    try:
        data = await call_openai_compatible_api(
            base_url,
            bearer_token,
            model,
            repair_messages,
            max_tokens=1200,
            temperature=0,
        )
        raw = _extract_provider_reply(data).strip()
        if not raw:
            return None
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and str(obj.get("action") or "").strip():
                return obj
            return None
        except Exception:
            payload, _ = extract_action_payload(raw)
            if isinstance(payload, dict) and str(payload.get("action") or "").strip():
                return payload
            return None
    except Exception:
        return None


async def _synthesize_missing_action_with_model(
    *,
    base_url: str,
    bearer_token: str,
    model: str,
    user_message: str,
    assistant_reply: str,
) -> dict | None:
    """Если модель не отдала crm_action, попросить ее вернуть только action-JSON или {}."""
    synth_messages = [
        {
            "role": "system",
            "content": (
                "Ты арбитр действий CRM. "
                "Проанализируй сообщение пользователя и ответ ассистента. "
                "Если действительно нужно выполнить действие CRM (создать/изменить сущность), "
                "верни ОДИН валидный JSON-объект действия с полем action. "
                "Если действия не требуется, верни пустой объект {}. "
                "Никакого markdown и пояснений."
            ),
        },
        {
            "role": "user",
            "content": (
                f"Сообщение пользователя:\n{user_message}\n\n"
                f"Ответ ассистента:\n{assistant_reply}\n\n"
                "Верни только JSON."
            ),
        },
    ]
    try:
        data = await call_openai_compatible_api(
            base_url,
            bearer_token,
            model,
            synth_messages,
            max_tokens=1400,
            temperature=0,
        )
        raw = _extract_provider_reply(data).strip()
        if not raw:
            return None
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and str(obj.get("action") or "").strip():
                return obj
            return None
        except Exception:
            payload, _ = extract_action_payload(raw)
            if isinstance(payload, dict) and str(payload.get("action") or "").strip():
                return payload
            return None
    except Exception:
        return None


async def _load_action_limits(uow: UnitOfWork, *, org_id: uuid.UUID) -> dict[str, int]:
    repo = AIRepository(uow.session)
    plan = await repo.resolve_effective_plan(org_id=org_id)
    max_tables = int(getattr(plan, "max_tables", 0) or 0)
    max_records = int(getattr(plan, "max_records", 0) or 0)
    current_tables = await repo.count_tables(org_id=org_id)
    current_records = await repo.count_records(org_id=org_id)
    current_kb_pages = await repo.count_kb_pages(org_id=org_id)
    return {
        "max_tables": max_tables,
        "max_records": max_records,
        "current_tables": current_tables,
        "current_records": current_records,
        "current_kb_pages": current_kb_pages,
    }


def _build_limits_hint(intent: str, limits: dict[str, int]) -> str:
    max_tables = int(limits.get("max_tables", 0))
    max_records = int(limits.get("max_records", 0))
    cur_tables = int(limits.get("current_tables", 0))
    cur_records = int(limits.get("current_records", 0))
    cur_kb = int(limits.get("current_kb_pages", 0))
    remain_tables = max(0, max_tables - cur_tables) if max_tables > 0 else -1
    remain_records = max(0, max_records - cur_records) if max_records > 0 else -1
    remain_kb = max(0, max_records - cur_kb) if max_records > 0 else -1
    if intent == "create_table":
        return (
            "\n\nОграничения тарифа (актуальные):\n"
            + f"- Таблицы: {cur_tables}/{max_tables if max_tables > 0 else 'без лимита'}"
            + (f" (осталось {remain_tables})\n" if max_tables > 0 else "\n")
            + f"- Записи в организации: {cur_records}/{max_records if max_records > 0 else 'без лимита'}"
            + (f" (осталось {remain_records})\n" if max_records > 0 else "\n")
            + "Если лимит = 0, не предлагай создание. Сразу объясни, что достигнут лимит."
        )
    if intent == "create_kb_page":
        return (
            "\n\nОграничения тарифа (актуальные):\n"
            + f"- Страницы базы знаний: {cur_kb}/{max_records if max_records > 0 else 'без лимита'}"
            + (f" (осталось {remain_kb})\n" if max_records > 0 else "\n")
            + "Если лимит = 0, не предлагай создание. Сразу объясни, что достигнут лимит."
        )
    return ""


def _intent_limit_error(intent: str, limits: dict[str, int]) -> dict | None:
    max_tables = int(limits.get("max_tables", 0))
    max_records = int(limits.get("max_records", 0))
    cur_tables = int(limits.get("current_tables", 0))
    cur_records = int(limits.get("current_records", 0))
    cur_kb = int(limits.get("current_kb_pages", 0))
    if intent == "create_table" and max_tables > 0 and cur_tables >= max_tables:
        return {"code": "TABLE_LIMIT_REACHED", "message": "Достигнут лимит тарифа по таблицам."}
    if intent == "create_table" and max_records > 0 and cur_records >= max_records:
        return {"code": "RECORD_LIMIT_REACHED", "message": "Достигнут лимит тарифа по записям."}
    if intent == "create_kb_page" and max_records > 0 and cur_kb >= max_records:
        return {"code": "KNOWLEDGE_LIMIT_REACHED", "message": "Достигнут лимит тарифа по записям базы знаний."}
    return None


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

    # Runtime-параметры модели (из superadmin AI config).
    async with UnitOfWork() as uow:
        runtime = await AIRepository(uow.session).get_runtime_settings()
    effective_model = (runtime.model.strip() if runtime and runtime.model else settings.OPENAI_MODEL)
    effective_system_prompt = (runtime.system_prompt if runtime and runtime.system_prompt else settings.AI_SYSTEM_PROMPT)
    effective_max_tokens_per_request = int(
        (runtime.max_tokens_per_request if runtime and runtime.max_tokens_per_request else settings.AI_MAX_TOKENS_PER_REQUEST) or 2000
    )
    effective_temperature = float(runtime.temperature if runtime else 0.3)

    # Этап 2: подготовка system_prompt (UI intent = подсказка, не приказ).
    system_prompt = body.system_prompt or effective_system_prompt
    requested_records_target = _extract_requested_record_count(body.message)
    is_table_create_request = _looks_like_table_create_request(body.message)
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
        if intent in {"create_table", "create_kb_page"}:
            async with UnitOfWork() as uow:
                action_limits = await _load_action_limits(uow, org_id=current_user.org_id)
            limit_error = _intent_limit_error(intent, action_limits)
            if limit_error is not None:
                return ApiResponse(ok=False, data=None, error=limit_error)
            system_prompt += _build_limits_hint(intent, action_limits)
    if requested_records_target and is_table_create_request:
        system_prompt += (
            "\n\nСтрогое правило для текущего запроса:\n"
            + f"- Пользователь запросил {requested_records_target} записей.\n"
            + "- Нужно сформировать action create_table/create_records с этим количеством записей (если лимиты тарифа позволяют).\n"
            + "- Не дели на порции и не предлагай 'продолжай'.\n"
        )
    context_options = body.context_options or {}
    request_id = (body.request_id or "").strip() or None

    # Этап 3: загрузка/создание сессии + последние сообщения из БД.
    # Важно: фиксируем session_id один раз на весь запрос, чтобы избежать гонок и
    # случайного создания разных сессий на разных этапах.
    async with UnitOfWork() as uow:
        session = await get_or_create_session(uow, current_user.org_id, current_user.user_id, body.chat_id, body.message)
        session_id = session.id
        # Сохраняем новую сессию сразу, чтобы следующий UoW гарантированно её видел.
        await uow.commit()
        db_messages = await AIRepository(uow.session).list_session_messages_for_user(
            session_id=session_id,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            limit=60,
        )

    # Этап 4: сбор контекста организации (опционально).
    org_context = ""
    context_meta: dict | None = None
    if body.include_context:
        org_context, context_meta = await build_org_context_for_user(current_user.org_id, current_user.user_id, context_options)

    # Этап 5: предварительная оценка токенов и проверка лимитов.
    max_tokens_per_request = int(effective_max_tokens_per_request)
    provider_max_tokens = max_tokens_per_request
    if requested_records_target and is_table_create_request:
        desired = 1200 + int(requested_records_target * 35)
        provider_max_tokens = max(max_tokens_per_request, min(12000, desired))
    estimated_prompt_tokens = estimate_tokens(body.message) + estimate_tokens(org_context) + 280
    estimated_request_tokens = int(estimated_prompt_tokens + provider_max_tokens)
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
    use_timeweb_native = (
        str(getattr(settings, "AI_PROVIDER_MODE", "openai_compatible")).strip().lower() == "timeweb_native"
        and resolve_timeweb_agent_id(settings.AI_BASE_URL) is not None
    )
    provider_parent_message_id: str | None = None
    if use_timeweb_native:
        for msg in reversed(db_messages):
            if msg.role != "assistant":
                continue
            meta = msg.meta or {}
            provider_id = meta.get("provider_message_id") if isinstance(meta, dict) else None
            if isinstance(provider_id, str) and provider_id.strip():
                provider_parent_message_id = provider_id.strip()
                break

    # Этап 7: поддержка "прямых команд" (когда пользователь сам прислал crm_action).
    direct_action_payload, cleaned_direct_reply = extract_action_payload(body.message)
    if direct_action_payload:
        async with UnitOfWork() as uow:
            action_result = await _execute_action(
                uow,
                current_user,
                direct_action_payload,
                body.message,
            )

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
                model=effective_model,
                usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                chat_id=str(session_id),
                context_estimate=context_meta,
                action_result=action_result,
            )
        )

    # Этап 8: вызов провайдера, парсинг ответа и запись в БД.
    try:
        if use_timeweb_native:
            provider_message = _build_native_provider_message(
                messages=messages,
                user_message=body.message,
                has_parent=provider_parent_message_id is not None,
            )
            data = await call_timeweb_native_api(
                base_url=settings.AI_BASE_URL,
                bearer_token=bearer_token,
                message=provider_message,
                parent_message_id=provider_parent_message_id,
            )
        else:
            data = await call_openai_compatible_api(
                settings.AI_BASE_URL,
                bearer_token,
                effective_model,
                messages,
                max_tokens=provider_max_tokens,
                temperature=effective_temperature,
            )
        reply_raw = _extract_provider_reply(data)
        provider_message_id = _extract_provider_message_id(data)
        action_payload, reply = extract_action_payload(reply_raw)
        if action_payload is None and _looks_like_broken_action(reply_raw):
            repaired_payload = await _repair_action_payload_with_model(
                base_url=settings.AI_BASE_URL,
                bearer_token=bearer_token,
                model=effective_model,
                broken_reply=reply_raw,
            )
            if repaired_payload is not None:
                action_payload = repaired_payload
                if not reply.strip():
                    reply = "Готово, выполняю."
        if action_payload is None:
            synthesized_payload = await _synthesize_missing_action_with_model(
                base_url=settings.AI_BASE_URL,
                bearer_token=bearer_token,
                model=effective_model,
                user_message=body.message,
                assistant_reply=reply,
            )
            if synthesized_payload is not None:
                action_payload = synthesized_payload
                if not reply.strip():
                    reply = "Готово, выполняю."
        if action_payload is None and _claims_action_completed(reply):
            reply = (
                "Действие не выполнено: модель не сформировала структурированную команду для системы. "
                "Повторите запрос в формате: «создай таблицу ... и добавь N записей»."
            )
        action_payload = apply_ui_intent_overrides(action_payload, body.ui_intent, body.ui_intent_params)
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        if use_timeweb_native and provider_parent_message_id is not None:
            prompt_tokens_est = int(estimate_tokens(body.message) + 20)
            completion_tokens_est = int(estimate_tokens(reply_raw))
            usage = {
                "prompt_tokens": prompt_tokens_est,
                "completion_tokens": completion_tokens_est,
                "total_tokens": prompt_tokens_est + completion_tokens_est,
                "estimated": True,
                "estimation_mode": "native_followup_message_only",
            }
        if not usage or not int(usage.get("total_tokens", 0) or 0):
            if use_timeweb_native and provider_parent_message_id is not None:
                prompt_tokens_est = int(estimate_tokens(body.message) + 20)
            else:
                prompt_tokens_est = _estimate_prompt_tokens(messages)
            completion_tokens_est = int(estimate_tokens(reply_raw))
            usage = {
                "prompt_tokens": prompt_tokens_est,
                "completion_tokens": completion_tokens_est,
                "total_tokens": prompt_tokens_est + completion_tokens_est,
                "estimated": True,
            }

        async with UnitOfWork() as uow:
            usage_total = int(usage.get("total_tokens", 0) or 0)
            try:
                token_spend = await spend_tokens(
                    uow.session,
                    org_id=current_user.org_id,
                    user_id=current_user.user_id,
                    tokens=usage_total,
                    request_id=request_id,
                    meta={"source": "ai_chat", "model": effective_model},
                )
            except ValueError:
                _record_metric("limit_exceeded")
                _record_limit_rejection("AI_TOKEN_LIMIT_EXCEEDED")
                return ApiResponse(
                    ok=False,
                    data=None,
                    error={
                        "code": "AI_TOKEN_LIMIT_EXCEEDED",
                        "message": "Лимит токенов исчерпан.",
                    },
                )

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
                token_count=usage_total,
                meta={
                    "action_requested": bool(action_payload),
                    "provider_message_id": provider_message_id,
                    "provider_parent_message_id": provider_parent_message_id,
                    "provider_mode": "timeweb_native_call" if use_timeweb_native else "openai_compatible",
                },
            )
            uow.session.add(user_msg)
            uow.session.add(assistant_msg)
            uow.session.add(
                AIUsageLog(
                    org_id=current_user.org_id,
                    user_id=current_user.user_id,
                    model=effective_model,
                    prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
                    completion_tokens=int(usage.get("completion_tokens", 0) or 0),
                    total_tokens=usage_total,
                    message_preview=body.message[:200],
                )
            )

            action_result = None
            if action_payload:
                action_result = await _execute_action(
                    uow,
                    current_user,
                    action_payload,
                    body.message,
                )
                if action_result is not None:
                    assistant_msg.meta = {"action_requested": True, "action_result": action_result}

            usage = {
                **usage,
                "wallet_spent_addon": token_spend.spent_addon,
                "wallet_spent_plan": token_spend.spent_plan,
                "wallet_remaining_addon": token_spend.addon_remaining,
                "wallet_remaining_plan": token_spend.plan_remaining,
                "wallet_idempotent_replay": token_spend.idempotent_replay,
            }
            await uow.commit()

        _record_metric("ok", int(usage.get("total_tokens", 0) or 0))

        return ApiResponse(
            data=ChatResponse(
                reply=reply,
                model=effective_model,
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
    except httpx.TimeoutException:
        _record_metric("error")
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_PROVIDER_TIMEOUT", "message": "AI provider timeout. Please try again later."},
        )
    except httpx.RequestError:
        _record_metric("error")
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_PROVIDER_UNAVAILABLE", "message": "AI provider unavailable. Please try again later."},
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
    except Exception as exc:
        _record_metric("error")
        logger.exception("ai_chat_unexpected_error", exc_info=exc)
        raise AIModuleError.internal() from exc
