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
