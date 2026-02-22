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

