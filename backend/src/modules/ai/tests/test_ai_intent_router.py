from src.modules.ai.internal.intent_router import build_routing_system_hint, interpret_user_intent


def test_intent_router_detects_table_read():
    decision = interpret_user_intent("покажи таблицу продаж за неделю")
    assert decision.domain == "table"
    assert decision.mode == "read"
    assert decision.is_context_query is True
    assert decision.is_action is False


def test_intent_router_detects_table_create():
    decision = interpret_user_intent("создай таблицу инвентаризации оборудования")
    assert decision.domain == "table"
    assert decision.mode == "create"
    assert decision.is_action is True


def test_intent_router_uses_ui_intent_fallback():
    decision = interpret_user_intent("привет", ui_intent="create_dashboard")
    assert decision.domain == "dashboard"
    assert decision.mode == "create"
    assert decision.is_action is True


def test_routing_hint_for_read_mode():
    decision = interpret_user_intent("покажи расписание на завтра")
    hint = build_routing_system_hint(decision)
    assert "mode=read" in hint
    assert "не добавляй crm_action" in hint.lower()


def test_intent_router_prefers_document_when_table_is_negated():
    decision = interpret_user_intent("создай документ, не таблицу, в формате резюме")
    assert decision.domain == "document"
    assert decision.mode == "create"
    assert decision.is_action is True
