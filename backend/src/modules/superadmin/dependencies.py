"""Dependencies for superadmin module."""

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.common.enums import UserRole
from src.common.exceptions import ForbiddenError, UnauthorizedError
from src.modules.auth.security import decode_superadmin_access_token

bearer = HTTPBearer(auto_error=False)


async def require_superadmin(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
) -> dict:
    if not credentials:
        raise UnauthorizedError("Missing authorization header")
    try:
        payload = decode_superadmin_access_token(credentials.credentials)
    except Exception as exc:
        raise UnauthorizedError("Invalid token") from exc
    if payload.get("role") != UserRole.SUPERADMIN.value:
        raise ForbiddenError("Superadmin access required")
    return payload
