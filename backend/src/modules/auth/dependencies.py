import uuid
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from src.common.enums import UserRole
from src.common.exceptions import ForbiddenError, UnauthorizedError
from src.modules.auth.security import decode_user_access_token

bearer_scheme = HTTPBearer(auto_error=False)


@dataclass
class CurrentUser:
    user_id: uuid.UUID
    org_id: uuid.UUID | None = None
    role: str | None = None


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> CurrentUser:
    if not credentials:
        raise UnauthorizedError("Missing authorization header")

    try:
        payload = decode_user_access_token(credentials.credentials)
    except jwt.ExpiredSignatureError:
        raise UnauthorizedError("Token expired")
    except jwt.InvalidTokenError:
        raise UnauthorizedError("Invalid token")

    user_id = uuid.UUID(payload["sub"])
    org_id = uuid.UUID(payload["org_id"]) if payload.get("org_id") else None
    role = payload.get("role")

    return CurrentUser(user_id=user_id, org_id=org_id, role=role)


def require_roles(*allowed_roles: UserRole):
    """Dependency factory: raises ForbiddenError if user role not in allowed_roles."""

    async def _check(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if not current_user.role:
            raise ForbiddenError("No role assigned")
        if current_user.role not in [r.value for r in allowed_roles]:
            raise ForbiddenError(f"Role '{current_user.role}' is not permitted for this action")
        return current_user

    return _check


def require_org(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Ensures user has an active org context."""
    if not current_user.org_id:
        raise ForbiddenError("No organization context. Please select an organization.")
    return current_user
