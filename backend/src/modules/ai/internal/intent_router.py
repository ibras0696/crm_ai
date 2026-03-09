"""Роутер намерений AI-чата.

Модуль отвечает за интерпретацию пользовательского сообщения:
- к какой предметной области относится запрос (таблицы / расписание / база знаний / дашборды);
- какой режим нужен (чтение / создание / изменение / удаление / неясно).

Логика вынесена отдельно от контроллера, чтобы:
1) проще поддерживать и дообучать эвристики;
2) не смешивать бизнес-оркестрацию с NLP-правилами;
3) использовать единые правила в разных местах пайплайна.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


IntentDomain = Literal["table", "schedule", "knowledge", "dashboard", "document", "general"]
IntentMode = Literal["read", "create", "update", "delete", "unknown"]


@dataclass(slots=True)
class IntentDecision:
    """Результат классификации пользовательского намерения."""

    domain: IntentDomain
    mode: IntentMode
    confidence: float
    reasons: list[str]

    @property
    def is_action(self) -> bool:
        """Требуется ли action-путь (`crm_action`) по эвристике."""
        return self.mode in {"create", "update", "delete"} and self.domain != "general"

    @property
    def is_context_query(self) -> bool:
        """Запрос на чтение/анализ данных из контекста."""
        return self.mode == "read" and self.domain != "general"


_CREATE_MARKERS = ("созд", "добав", "запол", "сформир", "make", "create", "add", "fill")
_UPDATE_MARKERS = ("измени", "обнов", "переимен", "настрой", "update", "edit", "rename", "configure")
_DELETE_MARKERS = ("удал", "очист", "сотри", "delete", "remove", "drop")
_READ_MARKERS = ("покажи", "посмотр", "найди", "проанализ", "сколько", "какие", "show", "find", "analy", "report")

_DOMAIN_MARKERS: dict[IntentDomain, tuple[str, ...]] = {
    "table": ("таблиц", "колон", "запис", "строк", "records", "table", "column"),
    "schedule": ("расписан", "событи", "календар", "встреч", "schedule", "event", "calendar"),
    # Добавляем основы слов, чтобы ловить формы вроде "в базе знаний".
    "knowledge": ("база знаний", "баз", "знан", "курс", "урок", "kb", "страниц", "knowledge", "wiki", "документац"),
    "dashboard": ("дашборд", "график", "виджет", "отчет", "отчёт", "dashboard", "chart", "widget", "report"),
    "document": ("документ", "docx", "pdf", "файл", "document", "file", "договор", "кп", "коммерческ"),
    "general": (),
}

_UI_INTENT_TO_DOMAIN: dict[str, IntentDomain] = {
    "create_table": "table",
    "create_columns": "table",
    "create_records": "table",
    "create_schedule_event": "schedule",
    "create_kb_page": "knowledge",
    "create_dashboard": "dashboard",
    "create_document": "document",
}


def _normalize(text: str) -> str:
    return " ".join((text or "").strip().lower().split())


def _detect_mode(text: str, *, ui_intent: str | None) -> tuple[IntentMode, list[str]]:
    reasons: list[str] = []
    if any(marker in text for marker in _DELETE_MARKERS):
        reasons.append("delete_markers")
        return "delete", reasons
    if any(marker in text for marker in _UPDATE_MARKERS):
        reasons.append("update_markers")
        return "update", reasons
    if any(marker in text for marker in _CREATE_MARKERS):
        reasons.append("create_markers")
        return "create", reasons
    if any(marker in text for marker in _READ_MARKERS):
        reasons.append("read_markers")
        return "read", reasons
    if ui_intent and ui_intent.startswith("create_"):
        reasons.append("ui_intent_create_fallback")
        return "create", reasons
    return "unknown", reasons


def _detect_domain(text: str, *, ui_intent: str | None) -> tuple[IntentDomain, list[str]]:
    reasons: list[str] = []
    scores: dict[IntentDomain, int] = {"table": 0, "schedule": 0, "knowledge": 0, "dashboard": 0, "document": 0, "general": 0}

    for domain, markers in _DOMAIN_MARKERS.items():
        if domain == "general":
            continue
        hit_count = sum(1 for marker in markers if marker in text)
        if hit_count > 0:
            scores[domain] += hit_count
            reasons.append(f"{domain}_markers:{hit_count}")

    if ui_intent:
        mapped = _UI_INTENT_TO_DOMAIN.get(ui_intent.strip())
        if mapped:
            scores[mapped] += 2
            reasons.append(f"ui_intent_domain:{mapped}")

    best_domain = "general"
    best_score = 0
    for domain in ("table", "schedule", "knowledge", "dashboard", "document"):
        score = scores[domain]
        if score > best_score:
            best_domain = domain
            best_score = score

    if best_score <= 0:
        return "general", reasons
    return best_domain, reasons


def interpret_user_intent(user_message: str, *, ui_intent: str | None = None) -> IntentDecision:
    """Интерпретировать запрос пользователя по домену и режиму."""
    text = _normalize(user_message)
    domain, domain_reasons = _detect_domain(text, ui_intent=ui_intent)
    mode, mode_reasons = _detect_mode(text, ui_intent=ui_intent)
    reasons = [*domain_reasons, *mode_reasons]

    confidence = 0.35
    if domain != "general":
        confidence += 0.25
    if mode != "unknown":
        confidence += 0.25
    if any(reason.startswith("ui_intent_domain:") for reason in reasons):
        confidence += 0.1
    confidence = min(0.95, confidence)

    # Если домен не распознан, но режим "создать/изменить/удалить" найден,
    # принудительно переводим в general-action unknown domain.
    if domain == "general" and mode in {"create", "update", "delete"}:
        return IntentDecision(domain="general", mode=mode, confidence=confidence, reasons=reasons)

    return IntentDecision(domain=domain, mode=mode, confidence=confidence, reasons=reasons)


def build_routing_system_hint(decision: IntentDecision) -> str:
    """Построить короткую системную подсказку по выбранному маршруту."""
    if decision.domain == "general":
        return ""
    if decision.is_context_query:
        return (
            "\n\nROUTING_HINT:\n"
            f"- domain={decision.domain}, mode=read.\n"
            "- Это запрос на чтение/анализ. Не выполняй изменения и не добавляй crm_action.\n"
        )
    if decision.is_action:
        return (
            "\n\nROUTING_HINT:\n"
            f"- domain={decision.domain}, mode={decision.mode}.\n"
            "- Это запрос на изменение данных. Если данных достаточно, добавь один crm_action по этому домену.\n"
        )
    return (
        "\n\nROUTING_HINT:\n"
        f"- domain={decision.domain}, mode=unknown.\n"
        "- Сначала уточни намерение коротким вопросом, без crm_action.\n"
    )
