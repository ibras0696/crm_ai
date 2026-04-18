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

_KIND_LABEL = {
    "schedule_reminder": "Напоминание",
    "invite": "Приглашение",
    "password_reset": "Безопасность",
    "registration_confirm": "Регистрация",
    "billing_lifecycle": "Биллинг",
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
    kind_label = _KIND_LABEL.get(kind, "Уведомление")

    first_url = _extract_first_url(body_text)
    cta_label = _KIND_CTA_LABEL.get(kind, "Открыть CRM Platform")
    cta_url = first_url or settings.FRONTEND_URL

    cta_html = ""
    if cta_url:
        safe_url = escape(cta_url, quote=True)
        cta_html = (
            '<tr><td style="padding:10px 32px 6px;">'
            f'<a href="{safe_url}" '
            'style="display:inline-block;background:#2563EB;'
            "background-image:linear-gradient(135deg,#2563EB 0%,#9B5DE5 100%);"
            "color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 20px;border-radius:12px;"
            'box-shadow:0 10px 24px rgba(37,99,235,0.30);">'
            f"{escape(cta_label)}</a></td></tr>"
            '<tr><td style="padding:0 32px 8px;color:#64748B;font-size:12px;line-height:1.5;">'
            f'Если кнопка не работает, откройте ссылку: <a href="{safe_url}" '
            'style="color:#2563EB;text-decoration:none;word-break:break-all;">'
            f"{safe_url}</a></td></tr>"
        )

    body_blocks_html = _render_body_blocks(body_text)

    return (
        "<!doctype html><html lang=\"ru\"><head><meta charset=\"UTF-8\" />"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />"
        "<title>CRM Platform</title>"
        "</head>"
        '<body style="margin:0;padding:0;background:#EEF2FF;font-family:Inter,Segoe UI,Roboto,Arial,sans-serif;">'
        f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">{escape(preheader)}</div>'
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:28px 12px;">'
        "<tr><td align=\"center\">"
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        'style="max-width:640px;background:#ffffff;border:1px solid #D6DEFF;border-radius:20px;overflow:hidden;'
        'box-shadow:0 18px 50px rgba(15,23,42,0.10);">'
        '<tr><td style="padding:22px 24px;background:#0F172A;'
        'background-image:linear-gradient(135deg,#0F172A 0%,#1E3A8A 50%,#7C3AED 100%);">'
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr>'
        '<td style="vertical-align:middle;">'
        '<table role="presentation" cellpadding="0" cellspacing="0"><tr>'
        '<td style="height:34px;width:34px;border-radius:10px;'
        'background:#2563EB;background-image:linear-gradient(135deg,#2563EB 0%,#9B5DE5 100%);'
        'text-align:center;color:#ffffff;font-size:20px;font-weight:800;line-height:34px;">C</td>'
        '<td style="padding-left:10px;color:#E2E8F0;font-size:14px;font-weight:700;letter-spacing:.02em;">'
        f"{escape(app_name)}"
        "</td>"
        "</tr></table>"
        "</td>"
        '<td align="right" style="vertical-align:middle;">'
        '<span style="display:inline-block;padding:6px 10px;border-radius:999px;'
        "background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.26);"
        'color:#DBEAFE;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">'
        f"{escape(kind_label)}"
        "</span>"
        "</td>"
        "</tr></table>"
        "</td></tr>"
        '<tr><td style="padding:24px 32px 8px;color:#0F172A;font-size:26px;line-height:1.28;font-weight:800;">'
        f"{escape(subject)}</td></tr>"
        f'<tr><td style="padding:8px 32px 2px;color:{accent};font-size:13px;font-weight:700;">'
        f"{escape(kind_label)} CRM Platform"
        "</td></tr>"
        '<tr><td style="padding:10px 24px 0;">'
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" '
        'style="border:1px solid #E2E8F0;border-radius:14px;background:#F8FAFF;">'
        '<tr><td style="padding:18px 18px 6px;">'
        f"{body_blocks_html}"
        "</td></tr></table>"
        "</td></tr>"
        f"{cta_html}"
        '<tr><td style="padding:16px 32px 8px;color:#64748B;font-size:12px;line-height:1.6;">'
        "Если вы не выполняли это действие, проверьте активные сессии и смените пароль."
        "</td></tr>"
        '<tr><td style="padding:0 32px 26px;color:#94A3B8;font-size:11px;line-height:1.6;">'
        "Это автоматическое уведомление CRM Platform. Пожалуйста, не отвечайте на это письмо."
        "</td></tr>"
        "</table>"
        "</td></tr>"
        "</table>"
        "</body></html>"
    )
