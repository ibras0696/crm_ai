from __future__ import annotations

import re
import unicodedata
from urllib.parse import quote

_FILENAME_SAFE_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _ascii_filename_fallback(filename: str) -> str:
    # RFC 6266: provide ASCII-only fallback for user agents not supporting filename*.
    # Keep extension if possible.
    s = (filename or "").strip()
    if not s:
        return "download"
    base = s
    ext = ""
    if "." in s and not s.endswith("."):
        base, ext = s.rsplit(".", 1)
        ext = "." + ext

    base_ascii = unicodedata.normalize("NFKD", base).encode("ascii", "ignore").decode("ascii")
    base_ascii = _FILENAME_SAFE_RE.sub("_", base_ascii).strip("._")
    if not base_ascii:
        base_ascii = "download"

    ext_ascii = unicodedata.normalize("NFKD", ext).encode("ascii", "ignore").decode("ascii")
    ext_ascii = _FILENAME_SAFE_RE.sub("_", ext_ascii).strip("._")
    if ext_ascii:
        ext_ascii = "." + ext_ascii.lstrip(".")

    return f"{base_ascii}{ext_ascii}"


def content_disposition(filename: str, *, disposition: str = "attachment") -> str:
    """
    Build a safe Content-Disposition header value.
    Uses:
    - filename="<ascii-fallback>"
    - filename*=UTF-8''<urlencoded>
    """
    safe_disposition = "inline" if disposition == "inline" else "attachment"
    original = (filename or "download").strip() or "download"
    fallback = _ascii_filename_fallback(original)
    encoded = quote(original, safe="")
    return f"{safe_disposition}; filename=\"{fallback}\"; filename*=UTF-8''{encoded}"


def content_disposition_attachment(filename: str) -> str:
    return content_disposition(filename, disposition="attachment")


def content_disposition_inline(filename: str) -> str:
    return content_disposition(filename, disposition="inline")
