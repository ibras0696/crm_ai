from __future__ import annotations

SUPPORTED_LOCALES = ("ru", "en")
DEFAULT_LOCALE = "ru"


def _split_primary_tag(value: str) -> str:
    return value.strip().lower().replace("_", "-").split("-", 1)[0]


def normalize_locale(value: str | None) -> str:
    if not value:
        return DEFAULT_LOCALE
    primary = _split_primary_tag(value)
    return primary if primary in SUPPORTED_LOCALES else DEFAULT_LOCALE


def _parse_q_value(params: list[str]) -> float:
    for raw in params:
        candidate = raw.strip().lower()
        if not candidate.startswith("q="):
            continue
        try:
            parsed = float(candidate[2:])
        except ValueError:
            return 0.0
        if parsed < 0:
            return 0.0
        if parsed > 1:
            return 1.0
        return parsed
    return 1.0


def resolve_locale_from_accept_language(header_value: str | None) -> str:
    if not header_value:
        return DEFAULT_LOCALE

    best_locale = ""
    best_q = -1.0
    for item in header_value.split(","):
        token = item.strip()
        if not token:
            continue
        parts = token.split(";")
        locale = _split_primary_tag(parts[0])
        if locale not in SUPPORTED_LOCALES:
            continue
        quality = _parse_q_value(parts[1:])
        if quality > best_q:
            best_q = quality
            best_locale = locale

    return best_locale or DEFAULT_LOCALE
