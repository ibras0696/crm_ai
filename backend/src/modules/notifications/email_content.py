from __future__ import annotations

from typing import TYPE_CHECKING

from src.modules.auth.services.locale import normalize_locale

if TYPE_CHECKING:
    from datetime import datetime
    from zoneinfo import ZoneInfo


def _is_en(locale: str | None) -> bool:
    return normalize_locale(locale) == "en"


def _format_datetime_for_locale(value: datetime, *, display_tz: ZoneInfo, locale: str | None) -> str:
    local_value = value.astimezone(display_tz)
    if _is_en(locale):
        return local_value.strftime("%Y-%m-%d %H:%M %Z")
    return local_value.strftime("%d.%m.%Y %H:%M %Z")


def compose_registration_confirm_email(*, confirm_url: str, locale: str | None) -> tuple[str, str]:
    if _is_en(locale):
        return (
            "Confirm your CRM Platform registration",
            (
                "You requested to create a CRM Platform account.\n\n"
                "Follow this link to complete registration:\n"
                f"{confirm_url}\n\n"
                "This one-time link is valid for 30 minutes.\n"
                "If this wasn't you, you can safely ignore this email.\n"
            ),
        )
    return (
        "Подтвердите регистрацию в CRM Platform",
        (
            "Вы запросили создание аккаунта в CRM Platform.\n\n"
            "Чтобы завершить регистрацию, перейдите по ссылке:\n"
            f"{confirm_url}\n\n"
            "Ссылка одноразовая и действует 30 минут.\n"
            "Если это были не вы, просто проигнорируйте это письмо.\n"
        ),
    )


def compose_invite_email(*, org_name: str, invite_url: str, locale: str | None) -> tuple[str, str]:
    if _is_en(locale):
        return (
            f"Invitation to organization: {org_name}",
            (
                f'You were invited to join organization "{org_name}".\n\n'
                "Use this link to accept the invitation:\n"
                f"{invite_url}\n\n"
                "If you did not expect this email, you can ignore it.\n"
            ),
        )
    return (
        f"Приглашение в организацию: {org_name}",
        (
            f'Вас пригласили в организацию "{org_name}".\n\n'
            "Ссылка для принятия приглашения:\n"
            f"{invite_url}\n\n"
            "Если вы не ожидали это письмо, просто проигнорируйте его.\n"
        ),
    )


def compose_password_reset_email(*, reset_url: str, locale: str | None) -> tuple[str, str]:
    if _is_en(locale):
        return (
            "Reset your CRM Platform password",
            (
                "You requested a password reset.\n\n"
                "Open this link to set a new password:\n"
                f"{reset_url}\n\n"
                "If you did not request this, you can ignore this email.\n"
            ),
        )
    return (
        "Сброс пароля в CRM Платформе",
        (
            "Вы запросили сброс пароля.\n\n"
            "Перейдите по ссылке для создания нового пароля:\n"
            f"{reset_url}\n\n"
            "Если вы этого не делали, просто проигнорируйте письмо.\n"
        ),
    )


def _schedule_offset_text(*, offset_minutes: int, locale: str | None) -> str:
    if _is_en(locale):
        if offset_minutes == 60:
            return "The event starts in 1 hour"
        if offset_minutes == 120:
            return "The event starts in 2 hours"
        return "The event starts in 1 day"
    if offset_minutes == 60:
        return "Событие начнется через 1 час"
    if offset_minutes == 120:
        return "Событие начнется через 2 часа"
    return "Событие начнется через 1 день"


def compose_schedule_reminder_email(
    *,
    event_title: str,
    event_description: str | None,
    occurrence_start: datetime,
    occurrence_end: datetime | None,
    offset_minutes: int,
    display_tz: ZoneInfo,
    locale: str | None,
) -> tuple[str, str]:
    start_text = _format_datetime_for_locale(occurrence_start, display_tz=display_tz, locale=locale)
    end_text = (
        _format_datetime_for_locale(occurrence_end, display_tz=display_tz, locale=locale)
        if occurrence_end
        else ("not specified" if _is_en(locale) else "не указано")
    )
    description = (event_description or "").strip() or ("not specified" if _is_en(locale) else "не указано")
    reminder_text = _schedule_offset_text(offset_minutes=offset_minutes, locale=locale)

    if _is_en(locale):
        return (
            f"Event reminder: {event_title}",
            (
                f"{reminder_text}\n\n"
                f"Event: {event_title}\n"
                f"Start: {start_text}\n"
                f"End: {end_text}\n"
                f"Description: {description}\n"
            ),
        )
    return (
        f"Напоминание о событии: {event_title}",
        (
            f"{reminder_text}\n\n"
            f"Событие: {event_title}\n"
            f"Начало: {start_text}\n"
            f"Окончание: {end_text}\n"
            f"Описание: {description}\n"
        ),
    )


def compose_billing_lifecycle_email(
    *,
    notice_kind: str | None,
    grace_days: int,
    days_left: int | None,
    locale: str | None,
    fallback_title: str,
    fallback_body: str,
) -> tuple[str, str]:
    kind = str(notice_kind or "").strip().lower()
    if _is_en(locale):
        if kind == "subscription_pre_expiry":
            return (
                "Subscription expires soon",
                (
                    "Your plan expires within 24 hours. "
                    "Renew your subscription to keep access to paid features."
                ),
            )
        if kind == "subscription_post_expiry":
            safe_days_left = max(0, int(days_left or 0))
            return (
                "Subscription has ended",
                (
                    "Your subscription has ended. "
                    f"Grace period for payment: {int(grace_days)} days. "
                    f"Approximate time before auto-downgrade and cleanup to free limits: {safe_days_left} day(s)."
                ),
            )
        return ("Billing update", fallback_body or fallback_title)

    if kind == "subscription_pre_expiry":
        return (
            "Подписка скоро закончится",
            (
                "Срок тарифа заканчивается в течение 24 часов. "
                "Продлите подписку, чтобы не потерять доступ к платным возможностям."
            ),
        )
    if kind == "subscription_post_expiry":
        safe_days_left = max(0, int(days_left or 0))
        return (
            "Подписка завершена",
            (
                "Подписка завершилась. "
                f"Льготный период для оплаты: {int(grace_days)} дней. "
                f"До автоснижения и очистки до лимитов free осталось примерно {safe_days_left} дн."
            ),
        )
    return (fallback_title, fallback_body or fallback_title)
