"""Celery tasks for notifications (email sending, invites, etc.)."""

import logging
from datetime import UTC, datetime

from sqlalchemy import func, select

from src.common.enums import InviteStatus
from src.config import settings
from src.infrastructure.celery_app import celery
from src.infrastructure.database_sync import sync_session_factory
from src.infrastructure.email import EmailSendError, send_smtp_email
from src.infrastructure.metrics_custom import INVITE_EMAIL_VALIDATION_TOTAL, NOTIFICATION_EMAIL_SEND_TOTAL
from src.modules.auth.models import User
from src.modules.notifications.email_content import compose_invite_email, compose_password_reset_email
from src.modules.notifications.email_templates import render_notification_email_html
from src.modules.org.models import Invite, Membership


def _inc_email_send_metric(*, kind: str, status: str) -> None:
    try:
        NOTIFICATION_EMAIL_SEND_TOTAL.labels(kind=kind, status=status).inc()
    except Exception:
        logging.getLogger("notifications").debug("Failed to increment email send metric", exc_info=True)


def _inc_invite_validation_metric(*, result: str) -> None:
    try:
        INVITE_EMAIL_VALIDATION_TOTAL.labels(result=result).inc()
    except Exception:
        logging.getLogger("notifications").debug("Failed to increment invite validation metric", exc_info=True)


def _can_send_invite_email(*, to_email: str, invite_token: str) -> tuple[bool, str]:
    """Validate invite state right before sending email to avoid stale/duplicate sends."""
    try:
        with sync_session_factory() as session:
            invite = session.execute(select(Invite).where(Invite.token == invite_token).limit(1)).scalar_one_or_none()
            if not invite:
                return False, "invite_not_found"
            if invite.status != InviteStatus.PENDING:
                return False, "invite_not_pending"
            if invite.expires_at and invite.expires_at <= datetime.now(UTC):
                return False, "invite_expired"
            if invite.email.lower() != to_email.lower():
                return False, "invite_email_mismatch"

            existing_user = session.execute(
                select(User).where(func.lower(User.email) == to_email.lower()).limit(1)
            ).scalar_one_or_none()
            if existing_user:
                is_member = session.execute(
                    select(Membership.id)
                    .where(
                        Membership.user_id == existing_user.id,
                        Membership.org_id == invite.org_id,
                    )
                    .limit(1)
                ).scalar_one_or_none()
                if is_member:
                    return False, "already_member"
    except Exception:
        logging.getLogger("notifications").exception("Invite pre-send validation failed")
        return False, "validation_failed"
    return True, "ok"


def _send_email_notification_impl(
    task,
    *,
    to_email: str,
    subject: str,
    body: str,
    kind: str,
    locale: str | None = None,
) -> dict:
    logger = logging.getLogger("notifications")
    if not settings.ENABLE_EMAIL:
        logger.info("Email sending disabled; skipping message", extra={"kind": kind, "to": to_email})
        _inc_email_send_metric(kind=kind, status="disabled")
        return {"status": "disabled", "to": to_email}

    try:
        html_body = render_notification_email_html(subject=subject, body_text=body, kind=kind, locale=locale)
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
            body_html=html_body,
            use_tls=bool(settings.SMTP_TLS),
            timeout_s=float(settings.SMTP_TIMEOUT_S),
        )
        logger.info("Email sent", extra={"kind": kind, "to": to_email})
        _inc_email_send_metric(kind=kind, status="sent")
        return {"status": "sent", "to": to_email}
    except EmailSendError as exc:
        permanent_error_codes = {"smtp_not_configured", "smtp_from_not_configured", "smtp_to_missing"}
        logger.exception("Email send failed", extra={"kind": kind, "to": to_email, "error": str(exc)})
        _inc_email_send_metric(kind=kind, status="failed")
        if str(exc) in permanent_error_codes:
            logger.error(
                "Email send failed permanently; retry suppressed",
                extra={"kind": kind, "to": to_email, "error": str(exc)},
            )
            return {"status": "failed", "to": to_email, "error": str(exc)}
        try:
            task.retry(exc=exc)
        except task.MaxRetriesExceededError:
            logger.error("Max retries exceeded for email", extra={"kind": kind, "to": to_email, "error": str(exc)})
            return {"status": "failed", "to": to_email, "error": str(exc)}
        logger.warning("Email scheduled for retry", extra={"kind": kind, "to": to_email, "error": str(exc)})
        return {"status": "retrying", "to": to_email}


@celery.task(
    name="send_email_notification",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_jitter=True,
)
def send_email_notification(
    self,
    to_email: str,
    subject: str,
    body: str,
    kind: str = "generic",
    locale: str | None = None,
) -> dict:
    """Send email notification via SMTP."""
    return _send_email_notification_impl(
        self,
        to_email=to_email,
        subject=subject,
        body=body,
        kind=kind,
        locale=locale,
    )


@celery.task(
    name="send_invite_email",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_jitter=True,
)
def send_invite_email(
    self,
    to_email: str,
    org_name: str,
    invite_token: str,
    invite_url: str | None = None,
    locale: str | None = None,
) -> dict:
    """Send invite email via SMTP."""
    logger = logging.getLogger("notifications")
    can_send, reason = _can_send_invite_email(to_email=to_email, invite_token=invite_token)
    _inc_invite_validation_metric(result=reason)
    if not can_send:
        logger.info("Invite email skipped: to=%s reason=%s", to_email, reason)
        return {"status": "skipped", "to": to_email, "reason": reason}

    url = invite_url or f"{settings.FRONTEND_URL.rstrip('/')}/auth/accept-invite?token={invite_token}"
    subject, body = compose_invite_email(org_name=org_name, invite_url=url, locale=locale)
    return _send_email_notification_impl(
        self,
        to_email=to_email,
        subject=subject,
        body=body,
        kind="invite",
        locale=locale,
    )


@celery.task(
    name="send_password_reset_email",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    retry_backoff=True,
    retry_jitter=True,
)
def send_password_reset_email(
    self,
    to_email: str,
    reset_token: str,
    reset_url: str | None = None,
    locale: str | None = None,
) -> dict:
    """Send password reset email via SMTP."""
    url = reset_url or f"{settings.FRONTEND_URL.rstrip('/')}/auth/reset-password?token={reset_token}"
    subject, body = compose_password_reset_email(reset_url=url, locale=locale)
    return _send_email_notification_impl(
        self,
        to_email=to_email,
        subject=subject,
        body=body,
        kind="password_reset",
        locale=locale,
    )
