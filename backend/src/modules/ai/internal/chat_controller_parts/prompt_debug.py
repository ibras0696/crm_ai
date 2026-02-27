from __future__ import annotations

"""Сбор и оценка prompt-состава для диагностики AI-чата."""

from src.modules.ai.internal.prompts import ACTION_INSTRUCTIONS_PROMPT
from src.modules.ai.models import AIChatMessage
from src.modules.ai.service import estimate_tokens


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


def _clip_prompt_part_for_debug(text: str, limit: int = 5000) -> str:
    """Обрезать часть prompt для хранения в meta/логах."""
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    return value[: max(0, limit - 96)].rstrip() + "\n\n[...обрезано для prompt_debug...]"


def _build_prompt_debug(
    *,
    mode: str,
    provider_mode: str,
    system_prompt: str,
    org_context: str,
    include_action_instructions: bool,
    user_message: str,
    messages: list[dict[str, str]],
) -> dict:
    """Собрать диагностику prompt-состава для meta и логов."""
    context_part = f"Organization context:\n\n{org_context}" if org_context else ""
    action_part = ACTION_INSTRUCTIONS_PROMPT if include_action_instructions else ""
    prompt_parts = {
        "system": _clip_prompt_part_for_debug(system_prompt),
        "context": _clip_prompt_part_for_debug(context_part),
        "action_instructions": _clip_prompt_part_for_debug(action_part),
        "user": _clip_prompt_part_for_debug(user_message, limit=2200),
    }
    tokens_by_part = {
        "system": int(estimate_tokens(system_prompt)) if system_prompt else 0,
        "context": int(estimate_tokens(context_part)) if context_part else 0,
        "action_instructions": int(estimate_tokens(action_part)) if action_part else 0,
        "user": int(estimate_tokens(user_message)) if user_message else 0,
    }
    return {
        "mode": mode,
        "provider_mode": provider_mode,
        "prompt_parts": prompt_parts,
        "tokens_by_part": tokens_by_part,
        "total_prompt_tokens_est": int(_estimate_prompt_tokens(messages)),
    }


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
