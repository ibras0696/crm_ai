from __future__ import annotations

import re
from html import escape

from src.config import settings

_URL_RE = re.compile(r"(https?://[^\s<]+)", re.IGNORECASE)

_KIND_ACCENT = {
    "schedule_reminder": "#2563EB",
    "invite": "#7C3AED",
    "password_reset": "#DC2626",
    "registration_confirm": "#0EA5E9",
    "billing_lifecycle": "#0D9488",
}

_KIND_CTA_LABEL = {
    "invite": "Принять приглашение",
    "password_reset": "Сбросить пароль",
    "registration_confirm": "Подтвердить регистрацию",
}


def _extract_first_url(text: str) -> str | None:
    match = _URL_RE.search(text or "")
    if not match:
        return None
    return match.group(1)


def _linkify_html(text: str) -> str:
    if not text:
        return ""

    parts: list[str] = []
    last = 0
    for match in _URL_RE.finditer(text):
        start, end = match.span()
        if start > last:
            parts.append(escape(text[last:start]))
        url = match.group(1)
        safe_url = escape(url, quote=True)
        parts.append(
            f'<a href="{safe_url}" style="color:#2563EB;text-decoration:none;word-break:break-all;">{safe_url}</a>'
        )
        last = end
    if last < len(text):
        parts.append(escape(text[last:]))
    return "".join(parts)


def _render_body_blocks(body_text: str) -> str:
    lines = (body_text or "").splitlines()
    paragraphs: list[list[str]] = []
    current: list[str] = []

    for raw_line in lines:
        line = raw_line.rstrip()
        if not line.strip():
            if current:
                paragraphs.append(current)
                current = []
            continue
        current.append(line)
    if current:
        paragraphs.append(current)

    if not paragraphs:
        paragraphs = [[""]]

    rendered: list[str] = []
    for paragraph in paragraphs:
        content = "<br />".join(_linkify_html(item) for item in paragraph)
        rendered.append(f'<p style="margin:0 0 14px;color:#334155;font-size:15px;line-height:1.6;">{content}</p>')
    return "".join(rendered)


def render_notification_email_html(*, subject: str, body_text: str, kind: str = "generic") -> str:
    accent = _KIND_ACCENT.get(kind, "#2563EB")
    preheader = (body_text or "").strip().replace("\n", " ")
    preheader = preheader[:140] if preheader else "Уведомление CRM Platform"
    app_name = settings.APP_NAME or "CRM Platform"

    first_url = _extract_first_url(body_text)
    cta_label = _KIND_CTA_LABEL.get(kind, "Открыть CRM Platform")
    cta_url = first_url or settings.FRONTEND_URL

    cta_html = ""
    if cta_url:
        safe_url = escape(cta_url, quote=True)
        cta_html = (
            '<tr><td style="padding:0 32px 8px;">'
            f'<a href="{safe_url}" '
            f'style="display:inline-block;background:{accent};color:#ffffff;text-decoration:none;'
            'font-weight:600;font-size:14px;padding:12px 18px;border-radius:10px;">'
            f"{escape(cta_label)}</a></td></tr>"
        )

    body_blocks_html = _render_body_blocks(body_text)

    return (
        "<!doctype html><html lang=\"ru\"><head><meta charset=\"UTF-8\" />"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />"
        "<title>CRM Platform</title>"
        "</head>"
        '<body style="margin:0;padding:0;background:#F1F5F9;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{escape(preheader)}</div>'
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:28px 12px;">'
        "<tr><td align=\"center\">"
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        'style="max-width:640px;background:#ffffff;border:1px solid #E2E8F0;border-radius:18px;overflow:hidden;">'
        f'<tr><td style="padding:18px 24px;background:{accent};color:#ffffff;font-size:13px;'
        f'font-weight:700;letter-spacing:.08em;text-transform:uppercase;">{escape(app_name)}</td></tr>'
        "<tr><td "
        'style="padding:28px 32px 4px;color:#0F172A;font-size:24px;line-height:1.3;font-weight:700;">'
        f"{escape(subject)}</td></tr>"
        f'<tr><td style="padding:8px 32px 10px;">{body_blocks_html}</td></tr>'
        f"{cta_html}"
        '<tr><td style="padding:18px 32px 26px;color:#64748B;font-size:12px;line-height:1.6;">'
        "Это автоматическое уведомление CRM Platform. Пожалуйста, не отвечайте на это письмо."
        "</td></tr>"
        "</table>"
        "</td></tr>"
        "</table>"
        "</body></html>"
    )
