"""Dependencies for superadmin module."""

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.common.enums import UserRole
from src.common.exceptions import ForbiddenError, UnauthorizedError
from src.config import settings
from src.modules.auth.security import decode_superadmin_access_token

bearer = HTTPBearer(auto_error=False)


async def require_superadmin(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    token = credentials.credentials if credentials else request.cookies.get(settings.SUPERADMIN_ACCESS_COOKIE_NAME)
    if not token:
        raise UnauthorizedError("Missing authorization credentials")
    try:
        payload = decode_superadmin_access_token(token)
    except Exception as exc:
        raise UnauthorizedError("Invalid token") from exc
    if payload.get("role") != UserRole.SUPERADMIN.value:
        raise ForbiddenError("Superadmin access required")
    return payload
