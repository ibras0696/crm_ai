from __future__ import annotations

import uuid

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.exceptions import ForbiddenError
from src.infrastructure.database import get_async_session
from src.modules.auth.dependencies import CurrentUser, require_org
from src.modules.access.service import check_access


def require_access(
    *,
    resource_type: str,
    permission: str = "can_read",
    resource_id_param: str | None = None,
    enforce_if_rules_exist: bool = True,
):
    """
    Dependency factory for fine-grained access checks (RBAC + access rules).

    Policy is implemented in `src.modules.access.service.check_access`.
    """

    async def _dep(
        request: Request,
        current_user: CurrentUser = Depends(require_org),
        session: AsyncSession = Depends(get_async_session),
    ) -> None:
        resource_id: uuid.UUID | None = None
        if resource_id_param:
            raw = request.path_params.get(resource_id_param)
            if raw is not None:
                resource_id = uuid.UUID(str(raw))

        allowed = await check_access(
            session,
            org_id=current_user.org_id,  # type: ignore[arg-type]
            user_id=current_user.user_id,
            user_role=current_user.role or "",
            resource_type=resource_type,
            resource_id=resource_id,
            permission=permission,
            enforce_if_rules_exist=enforce_if_rules_exist,
        )
        if not allowed:
            raise ForbiddenError("Недостаточно прав.")

    return _dep

