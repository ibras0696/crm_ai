import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import NotificationStatus, NotificationType
from src.modules.notifications.models import Notification
from src.modules.org.models import Membership


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.asyncio
async def test_notifications_read_flow(client: AsyncClient, db_session: AsyncSession):
    email = f"notif-owner-{uuid.uuid4().hex[:8]}@example.com"
    reg = await client.post(
        "/api/v1/auth/register",
        json={
            "email": email,
            "password": "StrongPass123!",
            "first_name": "Notif",
            "last_name": "Owner",
            "org_name": "Notifications Org",
            "accepted_privacy_policy": True,
        },
    )
    assert reg.status_code == 201
    token = reg.json()["data"]["access_token"]

    me_resp = await client.get("/api/v1/auth/me", headers=_headers(token))
    assert me_resp.status_code == 200
    user_id = uuid.UUID(me_resp.json()["data"]["id"])

    membership = (
        await db_session.execute(select(Membership).where(Membership.user_id == user_id).limit(1))
    ).scalar_one()
    org_id = membership.org_id

    unread = Notification(
        org_id=org_id,
        user_id=user_id,
        type=NotificationType.IN_APP,
        status=NotificationStatus.PENDING,
        title="Новая задача",
        body="Проверьте уведомления",
        is_read=False,
    )
    already_read = Notification(
        org_id=org_id,
        user_id=user_id,
        type=NotificationType.IN_APP,
        status=NotificationStatus.SENT,
        title="Старое уведомление",
        body=None,
        is_read=True,
    )
    db_session.add_all([unread, already_read])
    await db_session.commit()

    listed = await client.get("/api/v1/notifications/?limit=20&offset=0", headers=_headers(token))
    assert listed.status_code == 200
    assert listed.json()["ok"] is True
    assert len(listed.json()["data"]) >= 2

    unread_count = await client.get("/api/v1/notifications/unread-count", headers=_headers(token))
    assert unread_count.status_code == 200
    assert unread_count.json()["ok"] is True
    assert unread_count.json()["data"]["count"] == 1

    mark_one = await client.post(f"/api/v1/notifications/{unread.id}/read", headers=_headers(token))
    assert mark_one.status_code == 200
    assert mark_one.json()["ok"] is True

    unread_after = await client.get("/api/v1/notifications/unread-count", headers=_headers(token))
    assert unread_after.status_code == 200
    assert unread_after.json()["data"]["count"] == 0

    mark_missing = await client.post(f"/api/v1/notifications/{uuid.uuid4()}/read", headers=_headers(token))
    assert mark_missing.status_code == 200
    assert mark_missing.json()["ok"] is False
    assert mark_missing.json()["error"]["code"] == "NOT_FOUND"

    mark_all = await client.post("/api/v1/notifications/read-all", headers=_headers(token))
    assert mark_all.status_code == 200
    assert mark_all.json()["ok"] is True
