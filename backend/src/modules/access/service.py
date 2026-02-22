from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import UserRole
from src.common.exceptions import AppError, ValidationError
from src.modules.access.constants import ACCESS_ROLES, PERMISSION_FIELDS, RESOURCE_TYPES
from src.modules.access.models import AccessRule
from src.modules.access.repository import AccessRepository
from src.modules.access.schemas import CreateAccessRuleRequest, UpdateAccessRuleRequest


class AccessService:
    """Application service for access rules."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = AccessRepository(session)

    async def list_rules(
        self,
        *,
        org_id: uuid.UUID,
        resource_type: str | None,
        resource_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> list[AccessRule]:
        if resource_type is not None:
            normalized_resource_type = str(resource_type).strip().lower()
            if normalized_resource_type not in RESOURCE_TYPES:
                raise ValidationError(
                    f"resource_type должен быть одним из: {', '.join(RESOURCE_TYPES)}",
                    field="resource_type",
                )
            resource_type = normalized_resource_type
        return await self.repo.list_rules(
            org_id=org_id,
            resource_type=resource_type,
            resource_id=resource_id,
            limit=limit,
            offset=offset,
        )

    async def create_rule(self, *, org_id: uuid.UUID, body: CreateAccessRuleRequest) -> AccessRule:
        resource_type = str(body.resource_type or "").strip().lower()
        role = str(body.role or "").strip().lower() or None
        user_id = body.user_id

        if resource_type not in RESOURCE_TYPES:
            raise ValidationError(
                f"Тип ресурса должен быть одним из: {', '.join(RESOURCE_TYPES)}",
                field="resource_type",
            )

        # Exactly one subject must be set (role XOR user_id).
        if (role is None) == (user_id is None):
            raise ValidationError("Укажите ровно одно поле: role или user_id.")
        if role is not None and role not in ACCESS_ROLES:
            raise ValidationError(f"role должен быть одним из: {', '.join(ACCESS_ROLES)}", field="role")

        existing = await self.repo.get_exact_rule(
            org_id=org_id,
            resource_type=resource_type,
            resource_id=body.resource_id,
            role=role,
            user_id=user_id,
        )
        if existing is not None:
            raise ValidationError("Такое правило уже существует для указанного ресурса и субъекта.")

        rule = AccessRule(
            org_id=org_id,
            resource_type=resource_type,
            resource_id=body.resource_id,
            role=role,
            user_id=user_id,
            can_read=bool(body.can_read),
            can_write=bool(body.can_write),
            can_delete=bool(body.can_delete),
        )
        return await self.repo.create_rule(rule)

    async def update_rule(self, *, org_id: uuid.UUID, rule_id: uuid.UUID, body: UpdateAccessRuleRequest) -> AccessRule:
        rule = await self.repo.get_rule(org_id=org_id, rule_id=rule_id)
        if not rule:
            raise AppError(code="NOT_FOUND", message="Правило не найдено", status_code=404)

        allowed_fields = {"can_read", "can_write", "can_delete"}
        updates = body.model_dump(exclude_unset=True)
        unknown = set(updates.keys()) - allowed_fields
        if unknown:
            raise ValidationError("Недопустимые поля для обновления правила.", field=next(iter(unknown)))
        if not updates:
            raise ValidationError("Не передано ни одного поля для обновления правила.")
        for field, value in updates.items():
            setattr(rule, field, value)
        await self.session.flush()
        return rule

    async def delete_rule(self, *, org_id: uuid.UUID, rule_id: uuid.UUID) -> None:
        rule = await self.repo.get_rule(org_id=org_id, rule_id=rule_id)
        if not rule:
            raise AppError(code="NOT_FOUND", message="Правило не найдено", status_code=404)
        await self.repo.delete_rule(rule)


async def check_access(
    session: AsyncSession,
    *,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    user_role: str,
    resource_type: str,
    resource_id: uuid.UUID | None = None,
    permission: str = "can_read",
    enforce_if_rules_exist: bool = True,
) -> bool:
    """Check ACL access (RBAC + per-resource rules).

    Precedence policy:
    1. owner/admin -> always allow.
    2. Subject specificity: user rule > role rule.
    3. Resource specificity: resource_id rule > type-wide rule (resource_id is null).
    4. Within same specificity: deny > allow.
    5. If no matching rule:
       - when enforce_if_rules_exist=True and any rules exist for resource_type -> deny (default deny).
       - when no rules exist for resource_type -> allow (backward compatibility).
    """
    if permission not in PERMISSION_FIELDS:
        raise ValidationError("Некорректное permission")

    normalized_resource_type = str(resource_type or "").strip().lower()
    if normalized_resource_type not in RESOURCE_TYPES:
        raise ValidationError(
            f"resource_type должен быть одним из: {', '.join(RESOURCE_TYPES)}",
            field="resource_type",
        )

    if user_role in (UserRole.OWNER.value, UserRole.ADMIN.value):
        return True

    repo = AccessRepository(session)
    matched = await repo.best_match_rule(
        org_id=org_id,
        resource_type=normalized_resource_type,
        resource_id=resource_id,
        user_id=user_id,
        user_role=str(user_role or "").strip().lower(),
        permission=permission,
    )
    if matched is not None:
        return bool(getattr(matched, permission))

    if enforce_if_rules_exist:
        has_any = await repo.org_has_any_rules_for_type(org_id=org_id, resource_type=normalized_resource_type)
        if not has_any:
            return True
        return False

    return False
