from __future__ import annotations

import re

import bleach
from bleach.css_sanitizer import CSSSanitizer

ALLOWED_TAGS = frozenset(
    {
        "a",
        "abbr",
        "article",
        "aside",
        "b",
        "blockquote",
        "br",
        "caption",
        "code",
        "col",
        "colgroup",
        "dd",
        "del",
        "details",
        "div",
        "dl",
        "dt",
        "em",
        "figcaption",
        "figure",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "hr",
        "i",
        "img",
        "ins",
        "kbd",
        "li",
        "mark",
        "ol",
        "p",
        "pre",
        "s",
        "section",
        "small",
        "span",
        "strong",
        "sub",
        "summary",
        "sup",
        "table",
        "tbody",
        "td",
        "tfoot",
        "th",
        "thead",
        "tr",
        "u",
        "ul",
    }
)

ALLOWED_ATTRIBUTES = {
    "*": ["align", "class", "dir", "id", "lang", "style", "title"],
    "a": ["href", "name", "rel", "target"],
    "col": ["span", "width"],
    "colgroup": ["span", "width"],
    "img": ["alt", "height", "loading", "src", "srcset", "width"],
    "ol": ["reversed", "start", "type"],
    "td": ["colspan", "headers", "rowspan"],
    "th": ["colspan", "headers", "rowspan", "scope"],
    "ul": ["type"],
}

ALLOWED_CSS_PROPERTIES = frozenset(
    {
        "background-color",
        "border",
        "border-bottom",
        "border-color",
        "border-left",
        "border-radius",
        "border-right",
        "border-spacing",
        "border-style",
        "border-top",
        "border-width",
        "box-sizing",
        "caption-side",
        "color",
        "display",
        "font-family",
        "font-size",
        "font-style",
        "font-weight",
        "height",
        "letter-spacing",
        "line-height",
        "list-style-position",
        "list-style-type",
        "margin",
        "margin-bottom",
        "margin-left",
        "margin-right",
        "margin-top",
        "max-width",
        "min-width",
        "padding",
        "padding-bottom",
        "padding-left",
        "padding-right",
        "padding-top",
        "text-align",
        "text-decoration",
        "text-transform",
        "vertical-align",
        "white-space",
        "width",
        "word-break",
    }
)

_CSS_SANITIZER = CSSSanitizer(allowed_css_properties=ALLOWED_CSS_PROPERTIES)
_BLOCKED_CONTAINER_RE = re.compile(
    r"<(script|style|iframe|object|embed|svg|math|template|form)\b[^>]*>.*?</\1\s*>",
    flags=re.IGNORECASE | re.DOTALL,
)


def sanitize_knowledge_html(html: str | None) -> str:
    """Return a safe HTML fragment for sandboxed KB page rendering."""
    without_blocked_containers = _BLOCKED_CONTAINER_RE.sub("", html or "")
    cleaned = bleach.clean(
        without_blocked_containers,
        tags=ALLOWED_TAGS,
        attributes=ALLOWED_ATTRIBUTES,
        protocols={"http", "https", "mailto", "tel"},
        strip=True,
        strip_comments=True,
        css_sanitizer=_CSS_SANITIZER,
    )
    return bleach.linkify(
        cleaned,
        callbacks=[bleach.callbacks.nofollow, bleach.callbacks.target_blank],
        skip_tags={"pre", "code"},
        parse_email=False,
    )
