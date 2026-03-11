"""Публичный фасад сервисной логики AI.

Основная реализация вынесена в `src.modules.ai.internal.service`, чтобы корень
модуля `ai` оставался компактным и поддерживаемым.

Важно: этот файл существует, чтобы не ломать импорты `src.modules.ai.service`
в других частях проекта и тестах.
"""

from src.modules.ai.internal.service import (  # noqa: F401
    build_messages,
    build_org_context,
    build_org_context_for_user,
    call_openai_compatible_api,
    call_timeweb_native_api,
    context_flags,
    estimate_tokens,
    extract_action_payload,
    get_or_create_session,
    handle_create_columns_action,
    handle_create_dashboard_action,
    handle_create_document_action,
    handle_create_kb_page_action,
    handle_create_records_action,
    handle_create_schedule_event_action,
    handle_create_table_action,
    handle_edit_kb_page_action,
    resolve_timeweb_agent_id,
)

__all__ = [
    "build_messages",
    "build_org_context",
    "build_org_context_for_user",
    "call_openai_compatible_api",
    "call_timeweb_native_api",
    "context_flags",
    "estimate_tokens",
    "extract_action_payload",
    "get_or_create_session",
    "handle_create_columns_action",
    "handle_create_dashboard_action",
    "handle_create_document_action",
    "handle_create_kb_page_action",
    "handle_create_records_action",
    "handle_create_schedule_event_action",
    "handle_create_table_action",
    "resolve_timeweb_agent_id",
]
