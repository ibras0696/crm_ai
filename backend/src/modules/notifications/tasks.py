"""Celery tasks for notifications (email sending, invites, etc.)."""

import logging

from src.config import settings
from src.infrastructure.celery_app import celery
from src.infrastructure.email import EmailSendError, send_smtp_email


@celery.task(name="send_email_notification")
def send_email_notification(to_email: str, subject: str, body: str) -> dict:
    """Send email notification via SMTP."""
    logger = logging.getLogger("notifications")
    if not settings.ENABLE_EMAIL:
        return {"status": "disabled", "to": to_email}

    try:
        send_smtp_email(
            host=settings.SMTP_HOST,
            port=int(settings.SMTP_PORT),
            username=settings.SMTP_USER,
            password=settings.SMTP_PASSWORD,
            from_email=settings.SMTP_FROM,
            from_name=settings.SMTP_FROM_NAME,
            to_email=to_email,
            subject=subject,
            body_text=body,
            use_tls=bool(settings.SMTP_TLS),
            timeout_s=float(settings.SMTP_TIMEOUT_S),
        )
        return {"status": "sent", "to": to_email}
    except EmailSendError as exc:
        logger.exception("Email send failed: %s", exc)
        return {"status": "failed", "to": to_email, "error": str(exc)}


@celery.task(name="send_invite_email")
def send_invite_email(to_email: str, org_name: str, invite_token: str, invite_url: str | None = None) -> dict:
    """Send invite email via SMTP."""
    url = invite_url or f"{settings.FRONTEND_URL.rstrip('/')}/invite/accept?token={invite_token}"
    subject = f"Приглашение в организацию: {org_name}"
    body = (
        f"Вас пригласили в организацию \"{org_name}\".\n\n"
        f"Ссылка для принятия приглашения:\n{url}\n\n"
        "Если вы не ожидали это письмо, просто проигнорируйте его.\n"
    )
    return send_email_notification(to_email=to_email, subject=subject, body=body)
