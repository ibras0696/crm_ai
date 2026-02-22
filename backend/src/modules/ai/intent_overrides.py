from __future__ import annotations

from typing import Any


def apply_ui_intent_overrides(action_payload: dict[str, Any] | None, ui_intent: str | None, ui_params: dict | None) -> dict[str, Any] | None:
    """
    UI intent is a hint, but for some actions we can safely enforce it to avoid
    confusing results (e.g. user explicitly picked a widget type in UI).
    """
    if not action_payload or not isinstance(action_payload, dict):
        return action_payload

    intent = (ui_intent or "").strip()
    if not intent:
        return action_payload

    action_name = str(action_payload.get("action") or "").strip()
    params = ui_params if isinstance(ui_params, dict) else {}

    # If user selected a dashboard widget type in UI, ensure dashboard payload matches.
    if intent == "create_dashboard" and action_name == "create_dashboard":
        forced = str(params.get("widget_type") or "").strip().lower()
        if forced in {"metric", "bar", "line", "pie", "table"}:
            widgets = action_payload.get("widgets")
            if isinstance(widgets, list) and widgets:
                # Normalize missing/metric widgets to the forced type.
                if forced != "metric":
                    for w in widgets:
                        if not isinstance(w, dict):
                            continue
                        wtype = str(w.get("widget_type") or "").strip().lower()
                        if not wtype or wtype == "metric":
                            w["widget_type"] = forced

                # Guarantee at least one widget has the forced type.
                has_forced = any(
                    isinstance(w, dict) and str(w.get("widget_type") or "").strip().lower() == forced for w in widgets
                )
                if not has_forced:
                    first = next((w for w in widgets if isinstance(w, dict)), None)
                    if first is not None:
                        first["widget_type"] = forced

    return action_payload

