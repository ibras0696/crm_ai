import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select


def _headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


async def _register_owner(client: AsyncClient, *, org_name: str | None = None) -> tuple[str, str]:
    email = f"ai-svc-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Owner",
            "last_name": "User",
            "org_name": org_name or f"Org-{uuid.uuid4().hex[:6]}",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    return reg.json()["data"]["access_token"], email


@pytest.mark.asyncio
async def test_extract_action_payload_from_codeblock_and_plain_json():
    from src.modules.ai.service import extract_action_payload

    reply = "Hello\n```crm_action\n{\"action\":\"create_table\",\"name\":\"T\",\"columns\":[]}\n```"
    payload, cleaned = extract_action_payload(reply)
    assert isinstance(payload, dict)
    assert payload["action"] == "create_table"
    assert "crm_action" not in cleaned

    reply2 = "Some text {\"action\":\"create_dashboard\",\"name\":\"D\",\"widgets\":[]} end"
    payload2, cleaned2 = extract_action_payload(reply2)
    assert isinstance(payload2, dict)
    assert payload2["action"] == "create_dashboard"
    assert "create_dashboard" not in cleaned2 or cleaned2 != reply2


def test_ui_intent_overrides_force_widget_type_and_table_hint():
    from src.modules.ai.intent_overrides import apply_ui_intent_overrides

    payload = {
        "action": "create_dashboard",
        "name": "Аналитика",
        "widgets": [
            {"title": "W1", "widget_type": "line"},
            {"title": "W2", "widget_type": "bar"},
        ],
    }
    updated = apply_ui_intent_overrides(
        payload,
        "create_dashboard",
        {"widget_type": "pie", "table_name": "Продажи курсов"},
    )
    assert isinstance(updated, dict)
    assert updated["preferred_widget_type"] == "pie"
    assert updated["table_name"] == "Продажи курсов"
    assert all(str(w.get("widget_type")) == "pie" for w in updated["widgets"])


@pytest.mark.asyncio
async def test_ai_service_can_create_table_columns_records_and_event(client: AsyncClient):
    token, email = await _register_owner(client)

    from src.infrastructure.uow import UnitOfWork
    from src.modules.ai.service import (
        handle_create_columns_action,
        handle_create_records_action,
        handle_create_schedule_event_action,
        handle_create_table_action,
    )
    from src.modules.auth.models import User
    from src.modules.org.models import Membership
    from src.modules.tables.models import Table
    from src.modules.schedule.models import Event

    async with UnitOfWork() as uow:
        user = (await uow.session.execute(select(User).where(User.email == email))).scalars().first()
        assert user is not None
        membership = (await uow.session.execute(select(Membership).where(Membership.user_id == user.id))).scalars().first()
        assert membership is not None
        org_id = membership.org_id
        user_id = user.id

        # Create table with initial columns and a few records.
        res = await handle_create_table_action(
            uow,
            org_id,
            user_id,
            {
                "action": "create_table",
                "name": "Products",
                "columns": [
                    {"name": "Name", "field_type": "text", "is_primary": True},
                    {"name": "Price", "field_type": "number"},
                ],
                "records": [
                    {"Name": "Apple", "Price": 10},
                    {"Name": "Orange", "Price": 12},
                ],
            },
            user_message="create products table with demo data",
        )
        assert res["ok"] is True
        table_id = uuid.UUID(res["table"]["id"])

        # Add a column by table_name reference.
        res_cols = await handle_create_columns_action(
            uow,
            org_id,
            user_id,
            {"action": "create_columns", "table_name": "Products", "columns": [{"name": "SKU", "field_type": "text"}]},
            user_message="add sku column",
        )
        assert res_cols["ok"] is True

        # Add records by table_id reference.
        res_rec = await handle_create_records_action(
            uow,
            org_id,
            user_id,
            {"action": "create_records", "table_id": str(table_id), "records": [{"Name": "Pear", "Price": 7, "SKU": "P-1"}]},
            user_message="add one more product",
        )
        assert res_rec["ok"] is True

        # Create schedule event with long recurrence string (should not blow up on short varchar fields like color).
        ev = await handle_create_schedule_event_action(
            uow,
            org_id,
            user_id,
            {
                "action": "create_schedule_event",
                "title": "Lesson",
                "start_at": "2026-02-24T10:00:00Z",
                "end_at": "2026-02-24T11:00:00Z",
                "recurrence": "RRULE:FREQ=WEEKLY;BYDAY=TU",
                "color": "#1234567890THIS_IS_LONG",
            },
        )
        assert ev["ok"] is True
        human_ev = await handle_create_schedule_event_action(
            uow,
            org_id,
            user_id,
            {
                "action": "create_schedule_event",
                "title": "Созвон по проекту",
                "дата": "24.02.2026",
                "время": "09:00",
                "дата_конца": "24.02.2026",
                "время_конца": "10:15",
                "повтор": "еженедельно",
                "цвет": "зеленый",
                "напомнить_за": ["1 час", "1 день"],
            },
        )
        assert human_ev["ok"] is True

        await uow.commit()

    # Quick sanity: table exists
    async with UnitOfWork() as uow2:
        t = await uow2.session.get(Table, table_id)
        assert t is not None
        e = await uow2.session.get(Event, uuid.UUID(str(human_ev["event"]["id"])))
        assert e is not None
        assert e.color == "#10b981"
        assert e.recurrence == "weekly"
        assert e.reminder_offsets_minutes == [60, 1440]
        assert e.start_at.hour == 9
        assert e.end_at is not None
        assert e.end_at.hour == 10


@pytest.mark.asyncio
async def test_ai_dashboard_builder_normalizes_sales_widgets(client: AsyncClient):
    token, email = await _register_owner(client)
    assert token

    from src.infrastructure.uow import UnitOfWork
    from src.modules.ai.service import handle_create_dashboard_action, handle_create_table_action
    from src.modules.auth.models import User
    from src.modules.org.models import Membership

    async with UnitOfWork() as uow:
        user = (await uow.session.execute(select(User).where(User.email == email))).scalars().first()
        assert user is not None
        membership = (await uow.session.execute(select(Membership).where(Membership.user_id == user.id))).scalars().first()
        assert membership is not None

        org_id = membership.org_id
        user_id = user.id

        table_result = await handle_create_table_action(
            uow,
            org_id,
            user_id,
            {
                "action": "create_table",
                "name": "Продажи курсов",
                "columns": [
                    {"name": "Название курса", "field_type": "text", "is_primary": True},
                    {"name": "Выручка", "field_type": "number"},
                    {"name": "Статус", "field_type": "select", "config": {"options": ["Оплачено", "Ожидание"]}},
                    {"name": "Дата оплаты", "field_type": "date"},
                ],
                "records": [
                    {"Название курса": "Веб-дизайн", "Выручка": 45000, "Статус": "Оплачено", "Дата оплаты": "2026-02-20"},
                    {"Название курса": "Data Science PRO", "Выручка": 62000, "Статус": "Оплачено", "Дата оплаты": "2026-02-21"},
                    {"Название курса": "AI Basics", "Выручка": 15000, "Статус": "Ожидание", "Дата оплаты": "2026-02-22"},
                ],
            },
            user_message="создай таблицу продаж",
        )
        assert table_result["ok"] is True

        dashboard_result = await handle_create_dashboard_action(
            uow,
            org_id,
            user_id,
            {
                "action": "create_dashboard",
                "name": "Аналитика продаж курсов",
                "table_name": "Продажи курсов",
                "widgets": [
                    {"title": "Общая выручка", "widget_type": "line", "aggregation": "count"},
                    {"title": "Статусы оплат", "widget_type": "line", "aggregation": "count"},
                    {"title": "Динамика продаж", "widget_type": "line", "aggregation": "count"},
                ],
            },
            user_message="собери дашборд по продажам курсов: общая выручка, статусы оплат и динамика по датам",
        )
        await uow.commit()

    items_by_title = {str(item["title"]): item for item in dashboard_result["items"]}

    total = items_by_title.get("Общая выручка")
    assert total is not None
    assert total["widget_type"] == "metric"
    assert total["config"]["aggregation"] == "sum"
    assert total["config"]["value_column_id"]

    status = items_by_title.get("Статусы оплат")
    assert status is not None
    assert status["widget_type"] == "pie"
    assert status["config"]["aggregation"] == "count"
    assert status["config"]["group_by_column_id"]

    trend = items_by_title.get("Динамика продаж")
    assert trend is not None
    assert trend["widget_type"] == "line"
    assert trend["config"]["aggregation"] == "sum"
    assert trend["config"]["time_column_id"]


@pytest.mark.asyncio
async def test_ai_dashboard_builder_respects_preferred_widget_type(client: AsyncClient):
    token, email = await _register_owner(client)
    assert token

    from src.infrastructure.uow import UnitOfWork
    from src.modules.ai.service import handle_create_dashboard_action, handle_create_table_action
    from src.modules.auth.models import User
    from src.modules.org.models import Membership

    async with UnitOfWork() as uow:
        user = (await uow.session.execute(select(User).where(User.email == email))).scalars().first()
        assert user is not None
        membership = (await uow.session.execute(select(Membership).where(Membership.user_id == user.id))).scalars().first()
        assert membership is not None

        org_id = membership.org_id
        user_id = user.id

        table_result = await handle_create_table_action(
            uow,
            org_id,
            user_id,
            {
                "action": "create_table",
                "name": "Sales Table",
                "columns": [
                    {"name": "Client", "field_type": "text", "is_primary": True},
                    {"name": "Revenue", "field_type": "number"},
                    {"name": "Status", "field_type": "text"},
                ],
                "records": [
                    {"Client": "A", "Revenue": 100, "Status": "Paid"},
                    {"Client": "B", "Revenue": 200, "Status": "Pending"},
                ],
            },
            user_message="create sales table",
        )
        assert table_result["ok"] is True

        dashboard_result = await handle_create_dashboard_action(
            uow,
            org_id,
            user_id,
            {
                "action": "create_dashboard",
                "name": "Sales Pie Dashboard",
                "table_name": "Sales Table",
                "preferred_widget_type": "pie",
                "widgets": [
                    {"title": "Total revenue", "widget_type": "metric", "aggregation": "sum"},
                    {"title": "Statuses", "widget_type": "line", "aggregation": "count"},
                    {"title": "Top clients", "widget_type": "bar", "aggregation": "sum"},
                ],
            },
            user_message="build dashboard",
        )
        await uow.commit()

    assert dashboard_result["items"]
    assert all(item["widget_type"] == "pie" for item in dashboard_result["items"])
