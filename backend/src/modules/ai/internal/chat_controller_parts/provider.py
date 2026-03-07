from __future__ import annotations

"""Утилиты вызова/разбора ответов AI-провайдера для chat_controller."""

import asyncio


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
