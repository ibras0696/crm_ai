from __future__ import annotations

import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import UserRole
from src.common.exceptions import AppError, ValidationError
from src.modules.access.constants import PERMISSION_FIELDS, RESOURCE_TYPES
from src.modules.access.models import AccessRule
from src.modules.access.repository import AccessRepository
from src.modules.access.schemas import CreateAccessRuleRequest, UpdateAccessRuleRequest


class AccessService:
    """Сервис управления правилами доступа (access rules)."""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = AccessRepository(session)

    async def list_rules(
        self,
        *,
        org_id: uuid.UUID,
        resource_type: str | None,
        resource_id: uuid.UUID | None,
    ) -> list[AccessRule]:
        if resource_type and resource_type not in RESOURCE_TYPES:
            raise ValidationError(f"resource_type должен быть одним из: {', '.join(RESOURCE_TYPES)}", field="resource_type")
        return await self.repo.list_rules(org_id=org_id, resource_type=resource_type, resource_id=resource_id)

    async def create_rule(self, *, org_id: uuid.UUID, body: CreateAccessRuleRequest) -> AccessRule:
        if body.resource_type not in RESOURCE_TYPES:
            raise ValidationError(
                f"Тип ресурса должен быть одним из: {', '.join(RESOURCE_TYPES)}",
                field="resource_type",
            )
        if not body.role and not body.user_id:
            raise ValidationError("Укажите role или user_id")

        rule = AccessRule(
            org_id=org_id,
            resource_type=body.resource_type,
            resource_id=body.resource_id,
            role=body.role,
            user_id=body.user_id,
            can_read=bool(body.can_read),
            can_write=bool(body.can_write),
            can_delete=bool(body.can_delete),
        )
        return await self.repo.create_rule(rule)

    async def update_rule(self, *, org_id: uuid.UUID, rule_id: uuid.UUID, body: UpdateAccessRuleRequest) -> AccessRule:
        rule = await self.repo.get_rule(org_id=org_id, rule_id=rule_id)
        if not rule:
            raise AppError(code="NOT_FOUND", message="Правило не найдено", status_code=404)

        updates = body.model_dump(exclude_unset=True)
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
    """Проверка доступа (RBAC + access rules).

    Политика:
    - OWNER/ADMIN всегда разрешено.
    - Если enforce_if_rules_exist=True:
      - Если правил для resource_type нет, разрешаем (обратная совместимость).
      - Если хотя бы одно правило есть, дефолт DENY (разрешаем только явным правилом).

    Важно: функция не должна падать на дублях правил в БД.
    """
    if permission not in PERMISSION_FIELDS:
        raise ValidationError("Некорректное permission")

    if user_role in (UserRole.OWNER.value, UserRole.ADMIN.value):
        return True

    repo = AccessRepository(session)

    r = await repo.best_match_rule(
        org_id=org_id,
        resource_type=resource_type,
        resource_id=resource_id,
        user_id=user_id,
        user_role=user_role,
    )
    if r is not None:
        return bool(getattr(r, permission, False))

    if enforce_if_rules_exist:
        # Оптимизация: в обычном сценарии (когда матч есть) это 1 запрос.
        # Второй запрос делаем только если матча нет и нужно понять,
        # включен ли режим "default deny".
        has_any = await repo.org_has_any_rules_for_type(org_id=org_id, resource_type=resource_type)
        if not has_any:
            return True
        return False

    return False
