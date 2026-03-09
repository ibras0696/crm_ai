from __future__ import annotations

from typing import Any


def apply_ui_intent_overrides(
    action_payload: dict[str, Any] | None, ui_intent: str | None, ui_params: dict | None
) -> dict[str, Any] | None:
    """Применить подсказки интерфейса (UI intent) к payload действия.

    UI intent не является приказом модели, это подсказка от интерфейса. Но для некоторых
    действий мы можем безопасно "подправить" payload, чтобы результат не выглядел
    противоречиво. Пример: пользователь выбрал в UI тип виджета для дашборда.

    Args:
        action_payload: Распознанный payload действия (или None).
        ui_intent: Техническая подсказка интерфейса (например, "create_dashboard").
        ui_params: Дополнительные параметры intent (например, widget_type).

    Returns:
        Обновленный payload действия или исходный payload, если правки не применимы.
    """
    if not action_payload or not isinstance(action_payload, dict):
        return action_payload

    intent = (ui_intent or "").strip()
    if not intent:
        return action_payload

    action_name = str(action_payload.get("action") or "").strip()
    params = ui_params if isinstance(ui_params, dict) else {}

    # If user selected a dashboard widget type/table in UI, ensure dashboard payload matches.
    if intent == "create_dashboard" and action_name == "create_dashboard":
        forced = str(params.get("widget_type") or "").strip().lower()
        table_name = str(params.get("table_name") or "").strip()

        # Keep table hint from UI when provider omitted it.
        if table_name and not action_payload.get("table_name") and not action_payload.get("table_id"):
            action_payload["table_name"] = table_name

        if forced in {"metric", "bar", "line", "pie", "table"}:
            action_payload["preferred_widget_type"] = forced

    if intent == "create_document" and action_name == "create_document":
        file_type = str(params.get("file_type") or params.get("type") or "").strip().lower()
        template = str(params.get("template") or params.get("style") or "").strip()
        title = str(params.get("title") or "").strip()

        if file_type and not action_payload.get("type") and not action_payload.get("file_type"):
            action_payload["type"] = file_type
        if template and not action_payload.get("template"):
            action_payload["template"] = template
        if title and not action_payload.get("title") and not action_payload.get("name"):
            action_payload["title"] = title

    return action_payload
