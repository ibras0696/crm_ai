from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from src.modules.notifications.email_content import (
    compose_billing_lifecycle_email,
    compose_invite_email,
    compose_password_reset_email,
    compose_registration_confirm_email,
    compose_schedule_reminder_email,
)


def test_compose_registration_confirm_email_in_english():
    subject, body = compose_registration_confirm_email(
        confirm_url="https://example.com/confirm?token=abc",
        locale="en",
    )
    assert "Confirm your CRM Platform registration" in subject
    assert "complete registration" in body


def test_compose_invite_email_in_russian():
    subject, body = compose_invite_email(
        org_name="ООО Тест",
        invite_url="https://example.com/invite",
        locale="ru",
    )
    assert "Приглашение в организацию" in subject
    assert "Ссылка для принятия приглашения" in body


def test_compose_password_reset_email_in_english():
    subject, body = compose_password_reset_email(
        reset_url="https://example.com/reset",
        locale="en",
    )
    assert "Reset your CRM Platform password" in subject
    assert "set a new password" in body


def test_compose_schedule_reminder_email_in_english():
    subject, body = compose_schedule_reminder_email(
        event_title="Weekly Sync",
        event_description="Discuss roadmap",
        occurrence_start=datetime(2026, 4, 20, 9, 0, tzinfo=UTC),
        occurrence_end=datetime(2026, 4, 20, 10, 0, tzinfo=UTC),
        offset_minutes=60,
        display_tz=ZoneInfo("Europe/Moscow"),
        locale="en",
    )
    assert "Event reminder: Weekly Sync" in subject
    assert "The event starts in 1 hour" in body
    assert "Start:" in body


def test_compose_billing_lifecycle_email_in_english():
    subject, body = compose_billing_lifecycle_email(
        notice_kind="subscription_post_expiry",
        grace_days=30,
        days_left=7,
        locale="en",
        fallback_title="Fallback",
        fallback_body="Fallback body",
    )
    assert "Subscription has ended" in subject
    assert "Grace period for payment: 30 days" in body
