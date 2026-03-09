from __future__ import annotations

import smtplib
import ssl
from email.message import EmailMessage


class EmailSendError(RuntimeError):
    pass


def send_smtp_email(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    from_email: str,
    from_name: str | None,
    to_email: str,
    subject: str,
    body_text: str,
    use_tls: bool = True,
    timeout_s: float = 10.0,
) -> None:
    """
    Minimal SMTP sender (sync).
    - Supports STARTTLS (default) on port 587.
    - Uses plain auth if username/password are provided.
    """
    if not host or not port:
        raise EmailSendError("smtp_not_configured")
    if not from_email:
        raise EmailSendError("smtp_from_not_configured")
    if not to_email:
        raise EmailSendError("smtp_to_missing")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = f"{from_name} <{from_email}>" if from_name else from_email
    msg["To"] = to_email
    msg.set_content(body_text or "")

    try:
        with smtplib.SMTP(host=host, port=int(port), timeout=float(timeout_s)) as smtp:
            smtp.ehlo()
            if use_tls:
                ctx = ssl.create_default_context()
                smtp.starttls(context=ctx)
                smtp.ehlo()
            if username and password:
                smtp.login(username, password)
            smtp.send_message(msg)
    except Exception as exc:
        raise EmailSendError(str(exc)) from exc
