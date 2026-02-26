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
import asyncio
from datetime import UTC, datetime

import httpx

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.metrics_custom import AI_LIMIT_REJECTIONS_TOTAL, AI_REQUESTS_TOTAL, AI_TOKENS_TOTAL
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.errors import AIModuleError
from src.modules.ai.internal.repository import AIRepository
from src.modules.ai.intent_overrides import apply_ui_intent_overrides
from src.modules.ai.internal.prompts import (
    ACTION_NOT_EXECUTED_MESSAGE,
    ACTION_SYNTH_SYSTEM_PROMPT,
    CONFIRM_TABLE_CHANGE_MESSAGE,
    JSON_REPAIR_SYSTEM_PROMPT,
    build_repair_user_prompt,
    build_synthesis_user_prompt,
)
from src.modules.ai.internal.chat_policy import (
    build_intent_decision,
    extract_requested_record_count,
    has_selected_context,
    looks_like_broken_action,
    looks_like_table_create_request,
    resolve_provider_max_tokens,
    should_attach_context,
    should_enable_action_mode,
)
from src.modules.ai.internal.intent_router import build_routing_system_hint
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

CONFIRMABLE_ACTIONS = {"create_columns", "create_records"}
CONFIRM_WORDS = {"подтверждаю", "подтвердить", "confirm", "ok", "ок", "да, применить", "применить"}
CANCEL_WORDS = {"отмена", "cancel", "не применять", "стоп", "отклонить"}


async def _await_with_deadline(coro, timeout_s: float):
    """Дождаться coroutine с ограничением времени.

    Args:
        coro: Ожидаемая coroutine.
        timeout_s: Таймаут в секундах.

    Returns:
        Результат выполнения coroutine.

    Raises:
        asyncio.TimeoutError: Если время ожидания истекло.
    """
    return await asyncio.wait_for(coro, timeout=max(1.0, float(timeout_s)))

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
    """Извлечь идентификатор сообщения провайдера для parent-цепочки.

    Args:
        data: Сырой JSON-ответ провайдера.

    Returns:
        `id/message_id/response_id` или None, если идентификатор не найден.
    """
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


def _extract_native_bootstrap_prompt_tokens(db_messages: list[AIChatMessage]) -> int:
    """Извлечь сохраненную оценку bootstrap prompt из истории сообщений.

    Args:
        db_messages: Сообщения текущей сессии из БД.

    Returns:
        Количество токенов bootstrap prompt или 0, если не найдено.
    """
    for msg in reversed(db_messages):
        if msg.role != "assistant":
            continue
        meta = msg.meta or {}
        if not isinstance(meta, dict):
            continue
        value = meta.get("native_bootstrap_prompt_tokens")
        if isinstance(value, int) and value > 0:
            return value
        if isinstance(value, str) and value.strip().isdigit():
            return int(value.strip())
    return 0


def _estimate_native_prompt_tokens(
    *,
    provider_message: str,
    db_messages: list[AIChatMessage],
    has_parent: bool,
) -> int:
    """Оценить prompt-токены для native-цепочки Timeweb.

    Args:
        provider_message: Фактически отправляемый текст в `/call`.
        db_messages: История сообщений сессии из БД.
        has_parent: Есть ли parent_message_id у запроса.

    Returns:
        Приблизительное число prompt-токенов.
    """
    direct_prompt = int(estimate_tokens(provider_message) + 12)
    if not has_parent:
        return direct_prompt
    history_tail = db_messages[-12:]
    history_tokens = sum(estimate_tokens(str(msg.content or "")) for msg in history_tail)
    history_overhead = max(0, len(history_tail) * 4)
    bootstrap_tokens = _extract_native_bootstrap_prompt_tokens(db_messages)
    return int(direct_prompt + history_tokens + history_overhead + bootstrap_tokens)


def _build_native_provider_message(
    *,
    messages: list[dict[str, str]],
    user_message: str,
    has_parent: bool,
) -> str:
    """Собрать текст для нативного Timeweb /call.

    Для первого сообщения отправляем полный инструктивный контекст.
    Для продолжения цепочки отправляем только user message.

    Args:
        messages: Собранные сообщения запроса.
        user_message: Текущее сообщение пользователя.
        has_parent: Есть ли parent_message_id.

    Returns:
        Строка сообщения для Timeweb `/call`.
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




def _extract_usage_dict(data: dict) -> dict[str, int]:
    """Нормализовать usage-токены из разных форматов ответа провайдера.

    Args:
        data: Сырой JSON-ответ провайдера.

    Returns:
        Словарь с ключами `prompt_tokens`, `completion_tokens`, `total_tokens`.
    """
    def _to_int(value: object) -> int:
        """Безопасно преобразовать значение токенов к int.

        Args:
            value: Исходное значение из ответа провайдера.

        Returns:
            Целое число токенов или 0.
        """
        if isinstance(value, bool):
            return 0
        if isinstance(value, int):
            return value
        if isinstance(value, float):
            return int(value)
        if isinstance(value, str):
            text = value.strip()
            if text.isdigit():
                return int(text)
        return 0

    def _as_usage(obj: dict | None) -> dict[str, int] | None:
        """Извлечь usage из словаря в унифицированный формат.

        Args:
            obj: Кандидат-словарь с полями usage.

        Returns:
            Словарь `prompt/completion/total` или None.
        """
        if not isinstance(obj, dict):
            return None
        prompt = _to_int(
            obj.get("prompt_tokens")
            or obj.get("promptTokens")
            or obj.get("input_tokens")
            or obj.get("inputTokens")
        )
        completion = _to_int(
            obj.get("completion_tokens")
            or obj.get("completionTokens")
            or obj.get("output_tokens")
            or obj.get("outputTokens")
        )
        provider_total = _to_int(obj.get("total_tokens") or obj.get("totalTokens"))
        if prompt > 0 or completion > 0:
            # Для биллинга используем сумму фактических in/out токенов.
            # Некоторые провайдеры могут возвращать total_tokens с иным смыслом
            # (например, с учетом max_tokens/request budget), что искажает списание.
            total = prompt + completion
        else:
            total = provider_total
        if prompt > 0 or completion > 0 or total > 0:
            return {
                "prompt_tokens": prompt,
                "completion_tokens": completion,
                "total_tokens": total,
            }
        return None

    usage_paths = [
        data.get("usage"),
        (data.get("data") or {}).get("usage") if isinstance(data.get("data"), dict) else None,
        (data.get("response") or {}).get("usage") if isinstance(data.get("response"), dict) else None,
        ((data.get("data") or {}).get("response") or {}).get("usage")
        if isinstance(data.get("data"), dict) and isinstance((data.get("data") or {}).get("response"), dict)
        else None,
    ]
    for item in usage_paths:
        usage = _as_usage(item if isinstance(item, dict) else None)
        if usage is not None:
            return usage

    token_sources = [
        data,
        data.get("data") if isinstance(data.get("data"), dict) else {},
        data.get("response") if isinstance(data.get("response"), dict) else {},
        (data.get("data") or {}).get("response")
        if isinstance(data.get("data"), dict) and isinstance((data.get("data") or {}).get("response"), dict)
        else {},
    ]
    for source in token_sources:
        if not isinstance(source, dict):
            continue
        in_tokens = _to_int(source.get("input_tokens") or source.get("inputTokens"))
        out_tokens = _to_int(source.get("output_tokens") or source.get("outputTokens"))
        if in_tokens > 0 or out_tokens > 0:
            prompt = in_tokens
            completion = out_tokens
            return {
                "prompt_tokens": prompt,
                "completion_tokens": completion,
                "total_tokens": prompt + completion,
            }
    return {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


def _normalize_user_command(text: str) -> str:
    """Нормализовать короткую команду пользователя.

    Args:
        text: Исходный текст.

    Returns:
        Текст в нижнем регистре без лишних пробелов.
    """
    return " ".join((text or "").strip().lower().split())


def _is_confirmation_message(text: str) -> bool:
    """Проверить, является ли сообщение подтверждением pending-действия.

    Args:
        text: Текст пользователя.

    Returns:
        True, если сообщение совпадает с подтверждающей фразой.
    """
    t = _normalize_user_command(text)
    return any(t == word or t.startswith(f"{word} ") for word in CONFIRM_WORDS)


def _is_cancel_message(text: str) -> bool:
    """Проверить, является ли сообщение отменой pending-действия.

    Args:
        text: Текст пользователя.

    Returns:
        True, если сообщение совпадает с фразой отмены.
    """
    t = _normalize_user_command(text)
    return any(t == word or t.startswith(f"{word} ") for word in CANCEL_WORDS)


def _get_last_pending_action(db_messages: list[AIChatMessage]) -> dict | None:
    """Получить последнее незавершенное ожидающее действие из истории.

    Args:
        db_messages: История сообщений сессии.

    Returns:
        Пейлоад pending action или None, если ожидающего действия нет.
    """
    for msg in reversed(db_messages):
        if msg.role != "assistant":
            user_meta = msg.meta or {}
            if isinstance(user_meta, dict) and (
                user_meta.get("pending_action_confirmed") is True
                or user_meta.get("pending_action_cancelled") is True
            ):
                return None
            continue
        meta = msg.meta or {}
        if not isinstance(meta, dict):
            continue
        # Если после pending уже был финальный assistant-ответ по нему,
        # не позволяем повторно подтверждать/отменять старую операцию.
        action_result = meta.get("action_result")
        if isinstance(action_result, dict):
            if action_result.get("cancelled") is True or action_result.get("ok") is True:
                return None
        pending = meta.get("pending_action")
        if isinstance(pending, dict) and str(pending.get("action") or "").strip():
            return pending
    return None


def _estimate_rows_count(action_payload: dict) -> int:
    """Оценить количество строк в action payload.

    Args:
        action_payload: Action-пейлоад.

    Returns:
        Число строк в `records`.
    """
    src = action_payload.get("records")
    if isinstance(src, list):
        return len(src)
    if isinstance(src, dict) and isinstance(src.get("rows"), list):
        return len(src.get("rows"))
    return 0


def _build_pending_action_result(action_payload: dict) -> dict:
    """Сформировать унифицированный результат для ожидающего подтверждения.

    Args:
        action_payload: Пейлоад действия, требующего подтверждения.

    Returns:
        Словарь результата для UI/логов.
    """
    action_name = str(action_payload.get("action") or "").strip()
    table_ref = str(action_payload.get("table_name") or action_payload.get("table_id") or "").strip()
    rows_count = _estimate_rows_count(action_payload)
    cols = action_payload.get("columns")
    cols_count = len(cols) if isinstance(cols, list) else 0
    return {
        "action": action_name,
        "ok": False,
        "needs_confirmation": True,
        "table_ref": table_ref or None,
        "rows_count": rows_count,
        "columns_count": cols_count,
        "message": "Нужно подтверждение пользователя перед изменением таблицы.",
        "confirm_hint": "Напишите «подтверждаю» для применения или «отмена» для отмены.",
    }


def _claims_action_completed(reply_text: str) -> bool:
    """Проверить, заявляет ли текст ассистента о выполненном действии.

    Args:
        reply_text: Ответ ассистента.

    Returns:
        True, если в тексте есть маркеры "действие уже выполнено".
    """
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
) -> tuple[dict | None, dict[str, int]]:
    """Попробовать восстановить валидный action JSON из битого ответа.

    Args:
        base_url: Базовый URL провайдера.
        bearer_token: Токен доступа.
        model: Имя модели.
        broken_reply: Сырой ответ с частично сломанным action.

    Returns:
        Кортеж `(action_payload, usage)`:
        `action_payload` — dict или None, `usage` — словарь токенов helper-вызова.
    """
    repair_messages = [
        {
            "role": "system",
            "content": JSON_REPAIR_SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": build_repair_user_prompt(broken_reply),
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
            return None, _extract_usage_dict(data)
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and str(obj.get("action") or "").strip():
                return obj, _extract_usage_dict(data)
            return None, _extract_usage_dict(data)
        except Exception:
            payload, _ = extract_action_payload(raw)
            if isinstance(payload, dict) and str(payload.get("action") or "").strip():
                return payload, _extract_usage_dict(data)
            return None, _extract_usage_dict(data)
    except Exception:
        return None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


async def _synthesize_missing_action_with_model(
    *,
    base_url: str,
    bearer_token: str,
    model: str,
    user_message: str,
    assistant_reply: str,
) -> tuple[dict | None, dict[str, int]]:
    """Синтезировать action JSON, если основной ответ не вернул `crm_action`.

    Args:
        base_url: Базовый URL провайдера.
        bearer_token: Токен доступа.
        model: Имя модели.
        user_message: Сообщение пользователя.
        assistant_reply: Ответ ассистента без action-блока.

    Returns:
        Кортеж `(action_payload, usage)`:
        `action_payload` — dict или None, `usage` — словарь токенов helper-вызова.
    """
    synth_messages = [
        {
            "role": "system",
            "content": ACTION_SYNTH_SYSTEM_PROMPT,
        },
        {
            "role": "user",
            "content": build_synthesis_user_prompt(user_message, assistant_reply),
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
            return None, _extract_usage_dict(data)
        try:
            obj = json.loads(raw)
            if isinstance(obj, dict) and str(obj.get("action") or "").strip():
                return obj, _extract_usage_dict(data)
            return None, _extract_usage_dict(data)
        except Exception:
            payload, _ = extract_action_payload(raw)
            if isinstance(payload, dict) and str(payload.get("action") or "").strip():
                return payload, _extract_usage_dict(data)
            return None, _extract_usage_dict(data)
    except Exception:
        return None, {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}


async def _load_action_limits(uow: UnitOfWork, *, org_id: uuid.UUID) -> dict[str, int]:
    """Загрузить текущие лимиты и фактическое потребление по сущностям.

    Args:
        uow: UnitOfWork с доступом к БД.
        org_id: ID организации.

    Returns:
        Словарь с лимитами и текущими счетчиками (tables/records/kb pages).
    """
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
    """Сформировать текстовую подсказку модели о тарифных ограничениях.

    Args:
        intent: UI intent (`create_table` или `create_kb_page`).
        limits: Словарь лимитов и текущего потребления.

    Returns:
        Текст подсказки для system prompt.
    """
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
    """Проверить, достигнут ли лимит для конкретного intent.

    Args:
        intent: Имя intent.
        limits: Лимиты и текущие счетчики.

    Returns:
        Словарь ошибки лимита или None, если лимит не достигнут.
    """
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
    intent_decision = build_intent_decision(body.message, body.ui_intent)
    requested_records_target = extract_requested_record_count(body.message)
    is_table_create_request = looks_like_table_create_request(body.message)
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
    if has_selected_context(context_options):
        system_prompt += (
            "\n\nКонтекст выбран пользователем в интерфейсе.\n"
            + "- Не отвечай, что ты не видишь выбранные таблицы/страницы.\n"
            + "- Используй переданный Organization context как источник истины.\n"
            + "- Если в запросе спрашивают про отмеченную таблицу, отвечай по выбранной таблице из контекста.\n"
        )
    system_prompt += build_routing_system_hint(intent_decision)
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

    pending_action = _get_last_pending_action(db_messages)
    if pending_action and _is_cancel_message(body.message):
        action_name = str(pending_action.get("action") or "")
        action_result = {
            "action": action_name,
            "ok": False,
            "cancelled": True,
            "message": "Операция отменена пользователем.",
        }
        assistant_reply = "Операция отменена. Изменения в таблицу не внесены."
        async with UnitOfWork() as uow:
            user_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={"pending_action_cancelled": True},
            )
            assistant_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="assistant",
                content=assistant_reply,
                token_count=0,
                meta={"action_requested": True, "action_result": action_result},
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
                context_estimate=None,
                action_result=action_result,
            )
        )

    if pending_action and _is_confirmation_message(body.message):
        async with UnitOfWork() as uow:
            action_result = await _execute_action(
                uow,
                current_user,
                pending_action,
                body.message,
            )
            assistant_reply = "Подтверждение получено. Изменения в таблице применены."
            user_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={"pending_action_confirmed": True},
            )
            assistant_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="assistant",
                content=assistant_reply,
                token_count=0,
                meta={"action_requested": True, "action_result": action_result},
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
                context_estimate=None,
                action_result=action_result,
            )
        )

    # Этап 4: сбор контекста организации (опционально).
    org_context = ""
    context_meta: dict | None = None
    attach_context = should_attach_context(
        include_context=bool(body.include_context),
        ui_intent=body.ui_intent,
        context_options=context_options,
        user_message=body.message,
    )
    if attach_context:
        org_context, context_meta = await build_org_context_for_user(current_user.org_id, current_user.user_id, context_options)

    # Этап 5: предварительная оценка токенов и проверка лимитов.
    max_tokens_per_request = int(effective_max_tokens_per_request)
    action_mode = should_enable_action_mode(user_message=body.message, ui_intent=body.ui_intent)
    provider_max_tokens = resolve_provider_max_tokens(
        max_tokens_per_request=max_tokens_per_request,
        action_mode=action_mode,
        requested_records_target=requested_records_target,
        is_table_create_request=is_table_create_request,
    )
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
    configured_timeweb_native = (
        str(getattr(settings, "AI_PROVIDER_MODE", "openai_compatible")).strip().lower() == "timeweb_native"
        and resolve_timeweb_agent_id(settings.AI_BASE_URL) is not None
    )
    enforce_exact_usage = bool(getattr(settings, "AI_ENFORCE_EXACT_USAGE", True))
    # Для режима Timeweb native используем нативный /call, чтобы сохранялась
    # цепочка provider-side диалога через parent_message_id.
    use_timeweb_native = bool(configured_timeweb_native)
    # Историю чата в payload не подмешиваем:
    # - в timeweb_native цепочка идет через parent_message_id на стороне провайдера;
    # - в openai-compatible работаем как stateless turn (без локального history-tail).
    history_rows: list[dict[str, str]] = []
    # Первоначальный prompt отправляем только один раз на чат-сессию.
    first_turn = len(db_messages) == 0
    include_system_prompt = bool(first_turn)
    # Action-инструкции считаем частью начального контракта чата:
    # отправляем только на первом сообщении сессии.
    action_mode = bool(first_turn)
    messages = build_messages(
        system_prompt,
        org_context,
        [],
        history_rows,
        body.message,
        include_system_prompt=include_system_prompt,
        include_action_instructions=action_mode,
        compact_history=True,
    )
    
    # Явно отключаем provider-side цепочку контекста:
    # в нативный Timeweb не передаем parent_message_id.
    provider_parent_message_id: str | None = None

    # Этап 7: поддержка "прямых команд" (когда пользователь сам прислал crm_action).
    direct_action_payload, cleaned_direct_reply = extract_action_payload(body.message)
    if direct_action_payload:
        async with UnitOfWork() as uow:
            action_name = str(direct_action_payload.get("action") or "").strip()
            if action_name in CONFIRMABLE_ACTIONS:
                action_result = _build_pending_action_result(direct_action_payload)
                assistant_reply = CONFIRM_TABLE_CHANGE_MESSAGE
            else:
                action_result = await _execute_action(
                    uow,
                    current_user,
                    direct_action_payload,
                    body.message,
                )
                assistant_reply = cleaned_direct_reply or "Команда выполнена."

            user_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={"include_context": body.include_context, "context_options": context_options, "direct_action": True},
            )
            assistant_meta = {"action_requested": True, "action_result": action_result, "direct_action": True}
            if action_name in CONFIRMABLE_ACTIONS:
                assistant_meta["pending_action"] = direct_action_payload
                assistant_meta["pending_action_created_at"] = datetime.now(UTC).isoformat()
            assistant_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="assistant",
                content=assistant_reply,
                token_count=0,
                meta=assistant_meta,
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
        provider_deadline_s = float(getattr(settings, "AI_PROVIDER_TIMEOUT_S", 35.0) or 35.0) + 3.0
        native_bootstrap_prompt_tokens = 0
        try:
            if use_timeweb_native:
                provider_message = _build_native_provider_message(
                    messages=messages,
                    user_message=body.message,
                    has_parent=provider_parent_message_id is not None,
                )
                if provider_parent_message_id is None:
                    native_bootstrap_prompt_tokens = int(estimate_tokens(provider_message) + 12)
                data = await _await_with_deadline(
                    call_timeweb_native_api(
                        base_url=settings.AI_BASE_URL,
                        bearer_token=bearer_token,
                        message=provider_message,
                        parent_message_id=provider_parent_message_id,
                    ),
                    provider_deadline_s,
                )
            else:
                data = await _await_with_deadline(
                    call_openai_compatible_api(
                        settings.AI_BASE_URL,
                        bearer_token,
                        effective_model,
                        messages,
                        max_tokens=provider_max_tokens,
                        temperature=effective_temperature,
                    ),
                    provider_deadline_s,
                )
        except (asyncio.TimeoutError, httpx.TimeoutException, httpx.RequestError, httpx.HTTPStatusError):
            # В строгом режиме не делаем повторный запрос:
            # он удваивает latency и расход, а пользователь видит "зависание".
            if enforce_exact_usage:
                raise
            # Fallback-retry only for non-strict mode.
            retry_messages = build_messages(
                system_prompt=system_prompt,
                org_context="",
                db_messages=[],
                history=[],
                user_message=body.message,
                include_system_prompt=include_system_prompt,
                include_action_instructions=action_mode,
                compact_history=True,
            )
            if use_timeweb_native:
                provider_message = _build_native_provider_message(
                    messages=retry_messages,
                    user_message=body.message,
                    has_parent=False,
                )
                native_bootstrap_prompt_tokens = int(estimate_tokens(provider_message) + 12)
                data = await _await_with_deadline(
                    call_timeweb_native_api(
                        base_url=settings.AI_BASE_URL,
                        bearer_token=bearer_token,
                        message=provider_message,
                        parent_message_id=None,
                    ),
                    provider_deadline_s,
                )
            else:
                data = await _await_with_deadline(
                    call_openai_compatible_api(
                        settings.AI_BASE_URL,
                        bearer_token,
                        effective_model,
                        retry_messages,
                        max_tokens=max(1200, min(provider_max_tokens, 3200)),
                        temperature=effective_temperature,
                    ),
                    provider_deadline_s,
                )
        reply_raw = _extract_provider_reply(data)
        provider_message_id = _extract_provider_message_id(data)
        auxiliary_usage = {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        action_payload, reply = extract_action_payload(reply_raw)
        if action_mode and action_payload is None and looks_like_broken_action(reply_raw):
            repaired_payload, repaired_usage = await _await_with_deadline(
                _repair_action_payload_with_model(
                    base_url=settings.AI_BASE_URL,
                    bearer_token=bearer_token,
                    model=effective_model,
                    broken_reply=reply_raw,
                ),
                provider_deadline_s,
            )
            auxiliary_usage = {
                "prompt_tokens": auxiliary_usage["prompt_tokens"] + int(repaired_usage.get("prompt_tokens", 0) or 0),
                "completion_tokens": auxiliary_usage["completion_tokens"] + int(repaired_usage.get("completion_tokens", 0) or 0),
                "total_tokens": auxiliary_usage["total_tokens"] + int(repaired_usage.get("total_tokens", 0) or 0),
            }
            if repaired_payload is not None:
                action_payload = repaired_payload
                if not reply.strip():
                    reply = "Готово, выполняю."
        should_try_synthesis = (
            action_mode
            and
            action_payload is None
            and (
                _claims_action_completed(reply)
                or looks_like_broken_action(reply_raw)
            )
        )
        if should_try_synthesis:
            synthesized_payload, synth_usage = await _await_with_deadline(
                _synthesize_missing_action_with_model(
                    base_url=settings.AI_BASE_URL,
                    bearer_token=bearer_token,
                    model=effective_model,
                    user_message=body.message,
                    assistant_reply=reply,
                ),
                provider_deadline_s,
            )
            auxiliary_usage = {
                "prompt_tokens": auxiliary_usage["prompt_tokens"] + int(synth_usage.get("prompt_tokens", 0) or 0),
                "completion_tokens": auxiliary_usage["completion_tokens"] + int(synth_usage.get("completion_tokens", 0) or 0),
                "total_tokens": auxiliary_usage["total_tokens"] + int(synth_usage.get("total_tokens", 0) or 0),
            }
            if synthesized_payload is not None:
                action_payload = synthesized_payload
                if not reply.strip():
                    reply = "Готово, выполняю."
        if action_payload is None and _claims_action_completed(reply):
            reply = ACTION_NOT_EXECUTED_MESSAGE
        action_payload = apply_ui_intent_overrides(action_payload, body.ui_intent, body.ui_intent_params)
        usage = _extract_usage_dict(data)
        # Нормализация usage для провайдеров, которые кладут токены в root-поля.
        if not usage:
            in_tokens = data.get("input_tokens")
            out_tokens = data.get("output_tokens")
            if isinstance(in_tokens, int) or isinstance(out_tokens, int):
                prompt_tokens = int(in_tokens or 0)
                completion_tokens = int(out_tokens or 0)
                usage = {
                    "prompt_tokens": prompt_tokens,
                    "completion_tokens": completion_tokens,
                    "total_tokens": prompt_tokens + completion_tokens,
                }
        # Fallback-оценка только если разрешен нестрогий режим.
        if not usage or not int(usage.get("total_tokens", 0) or 0):
            if use_timeweb_native:
                provider_payload_text = body.message
                try:
                    provider_payload_text = str(provider_message)  # type: ignore[name-defined]
                except Exception:
                    provider_payload_text = body.message
                prompt_tokens_est = _estimate_native_prompt_tokens(
                    provider_message=provider_payload_text,
                    db_messages=db_messages,
                    has_parent=provider_parent_message_id is not None,
                )
                estimation_mode = "fallback_native_parent_history" if provider_parent_message_id else "fallback_native_bootstrap"
            else:
                prompt_tokens_est = _estimate_prompt_tokens(messages)
                estimation_mode = "fallback_full_context"
            completion_tokens_est = int(estimate_tokens(reply_raw))
            usage = {
                "prompt_tokens": prompt_tokens_est,
                "completion_tokens": completion_tokens_est,
                "total_tokens": prompt_tokens_est + completion_tokens_est,
                "estimated": True,
                "estimation_mode": estimation_mode,
            }
        # Учитываем токены скрытых helper-вызовов (repair/synthesis), чтобы UI и списание
        # совпадали с фактическим расходом у провайдера.
        usage = {
            **usage,
            "prompt_tokens": int(usage.get("prompt_tokens", 0) or 0) + auxiliary_usage["prompt_tokens"],
            "completion_tokens": int(usage.get("completion_tokens", 0) or 0) + auxiliary_usage["completion_tokens"],
            "total_tokens": int(usage.get("total_tokens", 0) or 0) + auxiliary_usage["total_tokens"],
            "auxiliary_prompt_tokens": auxiliary_usage["prompt_tokens"],
            "auxiliary_completion_tokens": auxiliary_usage["completion_tokens"],
            "auxiliary_total_tokens": auxiliary_usage["total_tokens"],
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

            if token_spend.idempotent_replay and request_id:
                repo = AIRepository(uow.session)
                replay_msg = await repo.get_last_assistant_message_by_request_id(
                    session_id=session_id,
                    org_id=current_user.org_id,
                    user_id=current_user.user_id,
                    request_id=request_id,
                )
                replay_action_result = None
                replay_usage = usage
                if replay_msg is not None and isinstance(replay_msg.meta, dict):
                    action_result_raw = replay_msg.meta.get("action_result")
                    if isinstance(action_result_raw, dict):
                        replay_action_result = action_result_raw
                    usage_raw = replay_msg.meta.get("usage")
                    if isinstance(usage_raw, dict):
                        replay_usage = usage_raw
                replay_usage = {
                    **replay_usage,
                    "wallet_spent_addon": token_spend.spent_addon,
                    "wallet_spent_plan": token_spend.spent_plan,
                    "wallet_remaining_addon": token_spend.addon_remaining,
                    "wallet_remaining_plan": token_spend.plan_remaining,
                    "wallet_idempotent_replay": token_spend.idempotent_replay,
                }
                _record_metric("ok")
                return ApiResponse(
                    data=ChatResponse(
                        reply=replay_msg.content if replay_msg is not None else reply,
                        model=effective_model,
                        usage=replay_usage,
                        chat_id=str(session_id),
                        context_estimate=context_meta,
                        action_result=replay_action_result,
                    )
                )

            user_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={
                    "include_context": body.include_context,
                    "context_options": context_options,
                    "request_id": request_id,
                },
            )
            assistant_msg = AIChatMessage(
                session_id=session_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="assistant",
                content=reply,
                token_count=usage_total,
                meta={
                    "usage_estimated": bool(usage.get("estimated")),
                    "usage_source": "estimated_native" if use_timeweb_native and bool(usage.get("estimated")) else "provider",
                    "usage": usage,
                    "request_id": request_id,
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
            assistant_meta = {
                **(assistant_msg.meta or {}),
                "action_requested": bool(action_payload),
                "provider_message_id": provider_message_id,
                "provider_parent_message_id": provider_parent_message_id,
                "provider_mode": "timeweb_native_call" if use_timeweb_native else "openai_compatible",
            }
            if use_timeweb_native and native_bootstrap_prompt_tokens > 0:
                assistant_meta["native_bootstrap_prompt_tokens"] = native_bootstrap_prompt_tokens
            if action_payload:
                action_name = str(action_payload.get("action") or "").strip()
                if action_name in CONFIRMABLE_ACTIONS:
                    action_result = _build_pending_action_result(action_payload)
                    assistant_meta["pending_action"] = action_payload
                    assistant_meta["pending_action_created_at"] = datetime.now(UTC).isoformat()
                    reply = (
                        f"{reply}\n\n{CONFIRM_TABLE_CHANGE_MESSAGE}"
                    ).strip()
                    assistant_msg.content = reply
                else:
                    action_result = await _execute_action(
                        uow,
                        current_user,
                        action_payload,
                        body.message,
                    )
                if action_result is not None:
                    assistant_meta["action_result"] = action_result
            assistant_msg.meta = assistant_meta

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
    except (asyncio.TimeoutError, httpx.TimeoutException):
        _record_metric("error")
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_PROVIDER_TIMEOUT", "message": "Провайдер AI не ответил вовремя. Повторите запрос."},
        )
    except httpx.RequestError:
        _record_metric("error")
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_PROVIDER_UNAVAILABLE", "message": "Провайдер AI сейчас недоступен. Повторите запрос позже."},
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code in (401, 403):
            _record_metric("unauthorized")
            return ApiResponse(
                ok=False,
                data=None,
                error={
                    "code": "AI_PROVIDER_UNAUTHORIZED",
                    "message": "Ошибка авторизации провайдера AI. Проверьте ключи доступа на сервере.",
                },
            )
        _record_metric("error")
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_ERROR", "message": "Ошибка провайдера AI. Повторите запрос позже."},
        )
    except Exception as exc:
        _record_metric("error")
        logger.exception("ai_chat_unexpected_error", exc_info=exc)
        raise AIModuleError.internal() from exc
