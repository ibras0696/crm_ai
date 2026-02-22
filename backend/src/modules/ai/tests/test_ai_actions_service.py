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

        await uow.commit()

    # Quick sanity: table exists
    async with UnitOfWork() as uow2:
        t = await uow2.session.get(Table, table_id)
        assert t is not None
        e = (await uow2.session.execute(select(Event).where(Event.org_id == t.org_id))).scalars().first()
        assert e is not None

