from prometheus_client import Counter, Histogram

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

FILE_SCAN_TOTAL = Counter(
    "file_scan_total",
    "Docs file scan results",
    ["result"],
)

UPLOADS_TOTAL = Counter(
    "uploads_total",
    "Docs upload pipeline transitions",
    ["status"],
)

DOCS_TEXT_SAVES_TOTAL = Counter(
    "docs_text_saves_total",
    "Docs TXT save attempts by status",
    ["status"],
)

DOCS_VERSIONS_CREATED_TOTAL = Counter(
    "docs_versions_created_total",
    "Docs file versions created by source",
    ["source"],
)

DOCS_AI_GENERATE_TOTAL = Counter(
    "docs_ai_generate_total",
    "Docs AI generation jobs by status and file type",
    ["status", "file_type"],
)

DOCS_AI_GENERATE_ERRORS_TOTAL = Counter(
    "docs_ai_generate_errors_total",
    "Docs AI generation errors by reason",
    ["reason"],
)

DOCS_RETENTION_CLEANUP_TOTAL = Counter(
    "docs_retention_cleanup_total",
    "Docs retention cleanup task runs by status",
    ["status"],
)

CHAT_WS_CONNECTIONS_TOTAL = Counter(
    "chat_ws_connections_total",
    "Chat websocket connection lifecycle events",
    ["event"],
)

CHAT_WS_RECONNECTS_TOTAL = Counter(
    "chat_ws_reconnects_total",
    "Chat websocket quick reconnects by detected window",
    ["window"],
)

CHAT_MESSAGE_LAG_SECONDS = Histogram(
    "chat_message_lag_seconds",
    "Observed lag between message creation and client receipt",
    buckets=(0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60),
)

CHAT_ATTACHMENT_DOWNLOAD_URL_REQUESTS_TOTAL = Counter(
    "chat_attachment_download_url_requests_total",
    "Requests for chat attachment download URLs",
    ["status"],
)

CHAT_ERRORS_TOTAL = Counter(
    "chat_errors_total",
    "Chat module business errors by operation and error code",
    ["operation", "code"],
)

CHAT_TELEMETRY_EVENTS_TOTAL = Counter(
    "chat_telemetry_events_total",
    "Frontend telemetry events accepted by chat backend",
    ["event", "status"],
)
