from __future__ import annotations

import logging
from dataclasses import dataclass

from kombu.exceptions import KombuError, OperationalError

from src.modules.notifications import tasks as notification_tasks_module

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class NotificationEnqueueResult:
    queued: bool
    kind: str
    to_email: str
    reason: str


def queue_email_notification(
    *,
    to_email: str,
    subject: str,
    body: str,
    kind: str = "generic",
) -> NotificationEnqueueResult:
    try:
        notification_tasks_module.send_email_notification.delay(
            to_email=to_email,
            subject=subject,
            body=body,
            kind=kind,
        )
        return NotificationEnqueueResult(queued=True, kind=kind, to_email=to_email, reason="queued")
    except (KombuError, OperationalError, OSError):
        logger.exception("notification_enqueue_failed", extra={"kind": kind, "to_email": to_email})
        return NotificationEnqueueResult(queued=False, kind=kind, to_email=to_email, reason="enqueue_failed")


def queue_invite_email(
    *,
    to_email: str,
    org_name: str,
    invite_token: str,
    invite_url: str | None = None,
) -> NotificationEnqueueResult:
    kind = "invite"
    try:
        notification_tasks_module.send_invite_email.delay(to_email, org_name, invite_token, invite_url)
        return NotificationEnqueueResult(queued=True, kind=kind, to_email=to_email, reason="queued")
    except (KombuError, OperationalError, OSError):
        logger.exception("notification_enqueue_failed", extra={"kind": kind, "to_email": to_email})
        return NotificationEnqueueResult(queued=False, kind=kind, to_email=to_email, reason="enqueue_failed")


def queue_password_reset_email(
    *,
    to_email: str,
    reset_token: str,
    reset_url: str | None = None,
) -> NotificationEnqueueResult:
    kind = "password_reset"
    try:
        notification_tasks_module.send_password_reset_email.delay(
            to_email=to_email,
            reset_token=reset_token,
            reset_url=reset_url,
        )
        return NotificationEnqueueResult(queued=True, kind=kind, to_email=to_email, reason="queued")
    except (KombuError, OperationalError, OSError):
        logger.exception("notification_enqueue_failed", extra={"kind": kind, "to_email": to_email})
        return NotificationEnqueueResult(queued=False, kind=kind, to_email=to_email, reason="enqueue_failed")


__all__ = [
    "NotificationEnqueueResult",
    "queue_email_notification",
    "queue_invite_email",
    "queue_password_reset_email",
]
