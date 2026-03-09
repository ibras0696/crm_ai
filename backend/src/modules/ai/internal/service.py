"""Фасад AI-сервисов.

Файл держит обратную совместимость для импортов `src.modules.ai.internal.service`,
а фактическая логика разнесена по подмодулям:
- context_builder
- action_parser
- chat_io
- handlers/*
- widget_inference / resolution
"""

from __future__ import annotations

from src.modules.ai.internal.action_parser import extract_action_payload
from src.modules.ai.internal.chat_io import (
    build_messages,
    call_openai_compatible_api,
    call_timeweb_native_api,
    resolve_timeweb_agent_id,
)
from src.modules.ai.internal.chat_session_service import get_or_create_session
from src.modules.ai.internal.context_builder import (
    build_org_context,
    build_org_context_for_user,
    context_flags,
    estimate_tokens,
)
from src.modules.ai.internal.handlers.dashboard_actions import handle_create_dashboard_action
from src.modules.ai.internal.handlers.docs_actions import handle_create_document_action
from src.modules.ai.internal.handlers.misc_actions import (
    handle_create_kb_page_action,
    handle_create_schedule_event_action,
    handle_edit_kb_page_action,
)
from src.modules.ai.internal.handlers.table_actions import (
    handle_create_columns_action,
    handle_create_records_action,
    handle_create_table_action,
)

__all__ = [
    "estimate_tokens",
    "context_flags",
    "build_org_context",
    "build_org_context_for_user",
    "build_messages",
    "extract_action_payload",
    "get_or_create_session",
    "call_openai_compatible_api",
    "call_timeweb_native_api",
    "resolve_timeweb_agent_id",
    "handle_create_dashboard_action",
    "handle_create_document_action",
    "handle_create_table_action",
    "handle_create_columns_action",
    "handle_create_records_action",
    "handle_create_schedule_event_action",
    "handle_create_kb_page_action",
    "handle_edit_kb_page_action",
]
