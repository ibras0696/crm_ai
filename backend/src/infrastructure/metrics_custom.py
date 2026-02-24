from __future__ import annotations

from prometheus_client import Counter


AI_REQUESTS_TOTAL = Counter(
    "crm_ai_requests_total",
    "AI chat requests",
    ["model", "status"],
)

AI_TOKENS_TOTAL = Counter(
    "crm_ai_tokens_total",
    "AI tokens total (prompt+completion)",
    ["model"],
)

AI_LIMIT_REJECTIONS_TOTAL = Counter(
    "crm_ai_limit_rejections_total",
    "AI requests rejected by limits",
    ["code"],
)

EXPORTS_TOTAL = Counter(
    "crm_table_exports_total",
    "Table export operations",
    ["format"],
)

IMPORTS_TOTAL = Counter(
    "crm_table_imports_total",
    "Table import operations",
    ["format"],
)

NOTIFICATION_EMAIL_SEND_TOTAL = Counter(
    "crm_notification_email_send_total",
    "Email notification send attempts by kind and status",
    ["kind", "status"],
)

INVITE_EMAIL_VALIDATION_TOTAL = Counter(
    "crm_invite_email_validation_total",
    "Invite email pre-send validation result",
    ["result"],
)
