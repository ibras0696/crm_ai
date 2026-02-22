from __future__ import annotations

import re

from src.config import settings
from src.modules.auth.schemas import TokenResponse


def slugify_org_name(name: str) -> str:
    """Build URL-safe organization slug."""
    slug = re.sub(r"[^\w\s-]", "", name.lower().strip())
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug or "org"


def build_token_response(*, access_token: str, refresh_token: str) -> TokenResponse:
    """Build unified token response payload."""
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

