from datetime import UTC, datetime
from zoneinfo import ZoneInfo

import pytest

from src.modules.notifications.email_content import (
    compose_billing_lifecycle_email,
    compose_invite_email,
    compose_password_reset_email,
    compose_registration_confirm_email,
    compose_schedule_reminder_email,
)
from src.modules.notifications.email_templates import render_notification_email_html


@pytest.mark.parametrize(
    ("locale", "kind", "expected_label", "expected_cta"),
    [
        ("ru", "registration_confirm", "Регистрация", "Подтвердить регистрацию"),
        ("ru", "invite", "Приглашение", "Принять приглашение"),
        ("ru", "password_reset", "Безопасность", "Сбросить пароль"),
        ("ru", "schedule_reminder", "Напоминание", "Открыть CRM Platform"),
        ("ru", "billing", "Биллинг", "Открыть биллинг"),
        ("ru", "generic", "Уведомление", "Открыть CRM Platform"),
        ("en", "registration_confirm", "Registration", "Confirm registration"),
        ("en", "invite", "Invitation", "Accept invitation"),
        ("en", "password_reset", "Security", "Reset password"),
        ("en", "schedule_reminder", "Reminder", "Open CRM Platform"),
        ("en", "billing", "Billing", "Open billing"),
        ("en", "generic", "Notification", "Open CRM Platform"),
    ],
)
def test_render_notification_email_html_all_kinds_i18n(locale: str, kind: str, expected_label: str, expected_cta: str):
    url = "https://crm.example.test/path?x=1"

    if kind == "registration_confirm":
        subject, body = compose_registration_confirm_email(confirm_url=url, locale=locale)
    elif kind == "invite":
        subject, body = compose_invite_email(org_name="Test Org", invite_url=url, locale=locale)
    elif kind == "password_reset":
        subject, body = compose_password_reset_email(reset_url=url, locale=locale)
    elif kind == "schedule_reminder":
        subject, body = compose_schedule_reminder_email(
            event_title="Weekly Sync",
            event_description="Discuss roadmap",
            occurrence_start=datetime(2026, 4, 20, 9, 0, tzinfo=UTC),
            occurrence_end=datetime(2026, 4, 20, 10, 0, tzinfo=UTC),
            offset_minutes=60,
            display_tz=ZoneInfo("Europe/Moscow"),
            locale=locale,
        )
    elif kind == "billing":
        subject, body = compose_billing_lifecycle_email(
            notice_kind="subscription_post_expiry",
            grace_days=30,
            days_left=7,
            locale=locale,
            fallback_title="Fallback",
            fallback_body=f"Fallback body {url}",
        )
    else:
        subject = "Generic notification" if locale == "en" else "Общее уведомление"
        body = f"Body line\n{url}"

    html = render_notification_email_html(subject=subject, body_text=body, kind=kind, locale=locale)

    assert "<html" in html.lower()
    assert expected_label in html
    assert expected_cta in html
    if kind in {"registration_confirm", "invite", "password_reset", "generic"}:
        assert f'href="{url}"' in html
    else:
        assert 'href="https://crm.example.com"' in html


def test_schedule_reminder_date_time_format_depends_on_locale():
    subject_ru, body_ru = compose_schedule_reminder_email(
        event_title="Sync",
        event_description="desc",
        occurrence_start=datetime(2026, 4, 20, 9, 0, tzinfo=UTC),
        occurrence_end=datetime(2026, 4, 20, 10, 0, tzinfo=UTC),
        offset_minutes=120,
        display_tz=ZoneInfo("Europe/Moscow"),
        locale="ru",
    )
    subject_en, body_en = compose_schedule_reminder_email(
        event_title="Sync",
        event_description="desc",
        occurrence_start=datetime(2026, 4, 20, 9, 0, tzinfo=UTC),
        occurrence_end=datetime(2026, 4, 20, 10, 0, tzinfo=UTC),
        offset_minutes=120,
        display_tz=ZoneInfo("Europe/Moscow"),
        locale="en",
    )

    assert "Напоминание о событии" in subject_ru
    assert "Event reminder" in subject_en
    assert "20.04.2026 12:00 MSK" in body_ru
    assert "2026-04-20 12:00 MSK" in body_en
