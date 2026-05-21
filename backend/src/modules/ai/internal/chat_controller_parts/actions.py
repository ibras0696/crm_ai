"""Action/pending-логика оркестратора AI-чата."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from src.common.enums import UserRole
from src.modules.ai.service import (
    handle_create_columns_action,
    handle_create_dashboard_action,
    handle_create_document_action,
    handle_create_kb_page_action,
    handle_create_records_action,
    handle_create_schedule_event_action,
    handle_create_table_action,
    handle_edit_kb_page_action,
)

if TYPE_CHECKING:
    from src.infrastructure.uow import UnitOfWork
    from src.modules.ai.models import AIChatMessage
    from src.modules.auth.dependencies import CurrentUser

ACTION_HANDLERS = {
    "create_dashboard": handle_create_dashboard_action,
    "create_document": handle_create_document_action,
    "create_table": handle_create_table_action,
    "create_columns": handle_create_columns_action,
    "create_records": handle_create_records_action,
    "create_schedule_event": handle_create_schedule_event_action,
    "create_kb_page": handle_create_kb_page_action,
    "edit_kb_page": handle_edit_kb_page_action,
}

ACTION_ALIASES = {
    "create_doc": "create_document",
    "create_file": "create_document",
    "create_docs_file": "create_document",
    "create_document_file": "create_document",
    "create_kb": "create_kb_page",
    "create_kb_pages": "create_kb_page",
    "create_knowledge_page": "create_kb_page",
    "create_knowledge_base_page": "create_kb_page",
    "create_knowledgebase_page": "create_kb_page",
    "create_wiki_page": "create_kb_page",
    "create_course": "create_kb_page",
    "create_kb_course": "create_kb_page",
    "create_knowledge_article": "create_kb_page",
    "update_kb": "edit_kb_page",
    "edit_knowledge_page": "edit_kb_page",
    "update_kb_page": "edit_kb_page",
}

ACTION_ALLOWED_ROLES = {
    "create_dashboard": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
    "create_document": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value, UserRole.EMPLOYEE.value},
    "create_table": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
    "create_columns": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
    "create_records": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
    "create_schedule_event": {
        UserRole.OWNER.value,
        UserRole.ADMIN.value,
        UserRole.MANAGER.value,
        UserRole.EMPLOYEE.value,
    },
    "create_kb_page": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
    "edit_kb_page": {UserRole.OWNER.value, UserRole.ADMIN.value, UserRole.MANAGER.value},
}

CONFIRMABLE_ACTIONS = {"create_columns", "create_records"}
CONFIRM_WORDS = {"подтверждаю", "подтвердить", "confirm", "ok", "ок", "да, применить", "применить"}
CANCEL_WORDS = {"отмена", "cancel", "не применять", "стоп", "отклонить"}


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
                user_meta.get("pending_action_confirmed") is True or user_meta.get("pending_action_cancelled") is True
            ):
                return None
            continue
        meta = msg.meta or {}
        if not isinstance(meta, dict):
            continue
        # Если после pending уже был финальный assistant-ответ по нему,
        # не позволяем повторно подтверждать/отменять старую операцию.
        action_result = meta.get("action_result")
        if isinstance(action_result, dict) and (
            action_result.get("cancelled") is True or action_result.get("ok") is True
        ):
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
        "добавил",
        "добавила",
        "добавлен",
        "добавлена",
        "успешно добавлен",
        "успешно добавлена",
        "создана таблица",
        "заполнил",
        "заполнила",
        "выполнил",
        "готово, создано",
    ]
    return any(m in text for m in markers)


def _normalize_action_payload_for_execution(
    action_payload: dict | None,
    *,
    ui_intent: str | None,
    user_message: str,
) -> dict | None:
    """Привести action payload к поддерживаемому формату перед выполнением.

    Фолбэк нужен для случаев, когда модель вернула близкий по смыслу action
    (например, `create_course`), который не совпадает с именами наших хендлеров.
    """
    if not isinstance(action_payload, dict):
        return action_payload

    action_name = str(action_payload.get("action") or "").strip()
    if action_name in ACTION_HANDLERS:
        return action_payload
    if action_name in ACTION_ALIASES:
        action_payload["action"] = ACTION_ALIASES[action_name]
        return action_payload

    text = (user_message or "").lower()
    ui = (ui_intent or "").strip().lower()
    # Если модель прислала слишком общий action ("create"), пробуем определить
    # домен по payload + тексту пользователя.
    if action_name in {"create", "create_entity"}:
        if action_payload.get("entity_type") in {"course", "kb_page", "knowledge_page", "wiki_page", "article"}:
            action_payload["action"] = "create_kb_page"
            return action_payload
        if action_payload.get("entity_type") in {"table", "data_table"}:
            action_payload["action"] = "create_table"
            return action_payload
        if action_payload.get("entity_type") in {"event", "schedule_event", "calendar_event"}:
            action_payload["action"] = "create_schedule_event"
            return action_payload
        if action_payload.get("entity_type") in {"dashboard", "report"}:
            action_payload["action"] = "create_dashboard"
            return action_payload
        if action_payload.get("entity_type") in {"document", "doc", "file", "docx_file", "pdf_file"}:
            action_payload["action"] = "create_document"
            return action_payload

    has_kb_shape = bool(
        action_payload.get("title")
        or action_payload.get("content")
        or action_payload.get("pages")
        or (
            isinstance(action_payload.get("properties"), dict)
            and (
                action_payload["properties"].get("title")
                or action_payload["properties"].get("content")
                or action_payload["properties"].get("pages")
            )
        )
    )
    kb_hint = ("база знан" in text) or ("knowledge" in text) or ("wiki" in text) or ("kb" in text)
    if has_kb_shape and (ui == "create_kb_page" or kb_hint):
        if isinstance(action_payload.get("properties"), dict):
            props = action_payload["properties"]
            if not action_payload.get("title") and props.get("title"):
                action_payload["title"] = props.get("title")
            if not action_payload.get("content") and props.get("content"):
                action_payload["content"] = props.get("content")
            if not action_payload.get("pages") and isinstance(props.get("pages"), list):
                action_payload["pages"] = props.get("pages")
        action_payload["action"] = "create_kb_page"
        return action_payload

    return action_payload


def _looks_like_kb_create_request(text: str, ui_intent: str | None) -> bool:
    """Проверить, похож ли запрос на создание страницы/курса в базе знаний."""
    t = (text or "").lower()
    if ui_intent == "create_kb_page":
        return True
    create_like = any(x in t for x in ("создай", "создать", "добавь", "добавить", "create", "add"))
    kb_like = any(x in t for x in ("база знан", "базе знан", "kb", "wiki", "knowledge", "курс", "урок", "стать"))
    return create_like and kb_like


def _build_kb_fallback_action(
    *,
    user_message: str,
    assistant_reply: str,
) -> dict | None:
    """Собрать fallback-action для KB, если модель не прислала валидный payload."""
    if not _looks_like_kb_create_request(user_message, None):
        return None
    title = "Новая страница"
    user_text = (user_message or "").strip()
    lowered = user_text.lower()
    for marker in (
        "создай курс",
        "создать курс",
        "добавь курс",
        "create course",
        "создай страницу",
        "создать страницу",
    ):
        idx = lowered.find(marker)
        if idx >= 0:
            rest = user_text[idx + len(marker) :].strip(" :,-")
            if rest:
                title = rest[:500]
                break
    if title == "Новая страница":
        title = user_text[:500] if user_text else title

    content = (assistant_reply or "").strip()
    if not content:
        content = "Материал добавлен автоматически из запроса пользователя."
    return {
        "action": "create_kb_page",
        "title": title,
        "content": content,
    }


def _build_dashboard_fallback_action(
    *,
    user_message: str,
    ui_intent: str | None,
    ui_params: dict | None,
    assistant_reply: str,
) -> dict | None:
    """Собрать fallback-action для дашборда, если модель не прислала crm_action."""
    _ = user_message
    if (ui_intent or "").strip().lower() != "create_dashboard":
        return None

    params = ui_params if isinstance(ui_params, dict) else {}
    table_names = params.get("table_names")
    primary_table_name = ""
    if isinstance(table_names, list):
        for item in table_names:
            candidate = str(item or "").strip()
            if candidate:
                primary_table_name = candidate
                break
    if not primary_table_name:
        primary_table_name = str(params.get("table_name") or "").strip()

    preferred_widget_type = str(params.get("widget_type") or "").strip().lower() or None
    title = f"Аналитика: {primary_table_name}" if primary_table_name else "AI дашборд"
    description = (assistant_reply or "").strip()[:1000] or None

    payload: dict[str, Any] = {
        "action": "create_dashboard",
        "name": title,
        "description": description,
        "widgets": [],
    }
    if primary_table_name:
        payload["table_name"] = primary_table_name
    if preferred_widget_type in {"metric", "bar", "line", "area", "pie", "donut", "table"}:
        payload["preferred_widget_type"] = preferred_widget_type
    return payload


def _build_document_fallback_action(
    *,
    user_message: str,
    ui_intent: str | None,
    ui_params: dict | None,
    force_from_intent: bool = False,
) -> dict | None:
    """Build a minimal create_document action from UI intent when the model skipped crm_action."""
    if not force_from_intent and (ui_intent or "").strip().lower() != "create_document":
        return None

    params = ui_params if isinstance(ui_params, dict) else {}
    file_type = str(params.get("file_type") or params.get("type") or "docx").strip().lower() or "docx"
    title = str(params.get("title") or "").strip() or None
    template = str(params.get("template") or params.get("style") or "").strip() or None

    return {
        "action": "create_document",
        "type": file_type,
        "prompt": str(user_message or "").strip(),
        "title": title,
        "template": template,
    }


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
    if not action_name:
        return None
    canonical_action = ACTION_ALIASES.get(action_name, action_name)
    if canonical_action != action_name:
        action_payload["action"] = canonical_action
        action_name = canonical_action
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
