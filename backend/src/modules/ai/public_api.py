from __future__ import annotations

from src.modules.ai.limits import check_ai_limits as _check_ai_limits
from src.modules.ai.limits import is_org_ai_enabled as _is_org_ai_enabled


async def check_ai_limits(session, *, org_id, user_id, estimated_request_tokens: int):
    """Public boundary for AI quota checks consumed by other modules."""
    return await _check_ai_limits(
        session,
        org_id=org_id,
        user_id=user_id,
        estimated_request_tokens=estimated_request_tokens,
    )


async def is_org_ai_enabled(session, *, org_id):
    """Public boundary for org-level AI availability checks."""
    return await _is_org_ai_enabled(session, org_id=org_id)


__all__ = ["check_ai_limits", "is_org_ai_enabled"]
