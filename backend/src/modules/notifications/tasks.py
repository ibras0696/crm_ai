"""Celery tasks for notifications (email sending, etc.)."""
from src.infrastructure.celery_app import celery


@celery.task(name="send_email_notification")
def send_email_notification(to_email: str, subject: str, body: str) -> dict:
    """Stub: send email notification. Replace with real SMTP/provider later."""
    # TODO: integrate real email provider (SMTP / SendGrid / etc.)
    print(f"[EMAIL STUB] To: {to_email}, Subject: {subject}, Body: {body[:100]}...")
    return {"status": "sent_stub", "to": to_email}


@celery.task(name="send_invite_email")
def send_invite_email(to_email: str, org_name: str, invite_token: str, invite_url: str | None = None) -> dict:
    """Stub: send invite email."""
    url = invite_url or f"http://localhost:5173/invite/accept?token={invite_token}"
    print(f"[INVITE EMAIL STUB] To: {to_email}, Org: {org_name}, URL: {url}")
    return {"status": "sent_stub", "to": to_email}
