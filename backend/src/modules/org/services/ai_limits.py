from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select

from src.common.enums import AuditAction, UserRole
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.limits import resolve_org_plan, resolve_plan_limits
from src.modules.ai.models import AIOrgLimit, AIUsageLog, AIUserLimit
from src.modules.audit.repository import AuditRepository
from src.modules.billing.models import Plan
from src.modules.org.models import Membership
from src.modules.auth.models import User


class OrgAILimitsService:
    """Use-cases управления AI-лимитами в org-admin."""

    async def get_limits(self, *, org_id: uuid.UUID) -> dict:
        now = datetime.now(timezone.utc)
        day_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
        month_start = datetime(now.year, now.month, 1, tzinfo=timezone.utc)
        minute_start = now - timedelta(seconds=60)

        async with UnitOfWork() as uow:
            plan_tier = await resolve_org_plan(uow.session, org_id=org_id)
            plan_db = (
                await uow.session.execute(select(Plan).where(Plan.name == plan_tier.value, Plan.is_active.is_(True)))
            ).scalars().first()
            effective_defaults = resolve_plan_limits(plan_tier, plan_db)

            org_limit = (await uow.session.execute(select(AIOrgLimit).where(AIOrgLimit.org_id == org_id))).scalars().first()
            user_limits = (
                await uow.session.execute(select(AIUserLimit).where(AIUserLimit.org_id == org_id))
            ).scalars().all()
            user_limit_map: dict[uuid.UUID, AIUserLimit] = {item.user_id: item for item in user_limits}

            members = (
                await uow.session.execute(
                    select(Membership, User)
                    .join(User, User.id == Membership.user_id)
                    .where(Membership.org_id == org_id)
                    .order_by(Membership.created_at.asc())
                )
            ).all()

            today_rows = (
                await uow.session.execute(
                    select(AIUsageLog.user_id, func.coalesce(func.sum(AIUsageLog.total_tokens), 0))
                    .where(AIUsageLog.org_id == org_id, AIUsageLog.created_at >= day_start)
                    .group_by(AIUsageLog.user_id)
                )
            ).all()
            month_rows = (
                await uow.session.execute(
                    select(AIUsageLog.user_id, func.coalesce(func.sum(AIUsageLog.total_tokens), 0))
                    .where(AIUsageLog.org_id == org_id, AIUsageLog.created_at >= month_start)
                    .group_by(AIUsageLog.user_id)
                )
            ).all()
            rpm_rows = (
                await uow.session.execute(
                    select(AIUsageLog.user_id, func.count(AIUsageLog.id))
                    .where(AIUsageLog.org_id == org_id, AIUsageLog.created_at >= minute_start)
                    .group_by(AIUsageLog.user_id)
                )
            ).all()

        today_map: dict[uuid.UUID, int] = {uid: int(tokens or 0) for uid, tokens in today_rows if uid is not None}
        month_map: dict[uuid.UUID, int] = {uid: int(tokens or 0) for uid, tokens in month_rows if uid is not None}
        rpm_map: dict[uuid.UUID, int] = {uid: int(count or 0) for uid, count in rpm_rows if uid is not None}

        users: list[dict] = []
        for membership, user in members:
            if membership.role == UserRole.READONLY:
                continue
            per_user_limit = user_limit_map.get(membership.user_id)
            users.append(
                {
                    "user_id": membership.user_id,
                    "membership_id": membership.id,
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "role": membership.role,
                    "daily_tokens_limit": int(per_user_limit.daily_tokens_limit if per_user_limit else 0),
                    "rpm_limit": int(per_user_limit.rpm_limit if per_user_limit else 0),
                    "usage_today_tokens": int(today_map.get(membership.user_id, 0)),
                    "usage_month_tokens": int(month_map.get(membership.user_id, 0)),
                    "usage_last_min_requests": int(rpm_map.get(membership.user_id, 0)),
                }
            )

        return {
            "org_limits": {
                "daily_tokens_limit": int(org_limit.daily_tokens_limit if org_limit else 0),
                "monthly_tokens_limit": int(org_limit.monthly_tokens_limit if org_limit else 0),
            },
            "effective_defaults": {
                "plan_daily_tokens_limit": int(effective_defaults["daily_tokens"]),
                "plan_rpm_per_user": int(effective_defaults["rpm_per_user"]),
                "plan_max_tokens_per_request": int(effective_defaults["max_tokens_per_request"]),
            },
            "users": users,
        }

    async def update_org_limits(
        self,
        *,
        org_id: uuid.UUID,
        actor_id: uuid.UUID,
        daily_tokens_limit: int,
        monthly_tokens_limit: int,
        ip_address: str | None = None,
    ) -> dict:
        async with UnitOfWork() as uow:
            row = (await uow.session.execute(select(AIOrgLimit).where(AIOrgLimit.org_id == org_id))).scalars().first()
            if row is None:
                row = AIOrgLimit(org_id=org_id)
                uow.session.add(row)
                await uow.session.flush()
            old_daily = int(row.daily_tokens_limit or 0)
            old_monthly = int(row.monthly_tokens_limit or 0)
            row.daily_tokens_limit = int(max(0, daily_tokens_limit))
            row.monthly_tokens_limit = int(max(0, monthly_tokens_limit))

            audit_repo = AuditRepository(uow.session)
            await audit_repo.log(
                org_id=org_id,
                actor_id=actor_id,
                action=AuditAction.UPDATE,
                entity_type="org_ai_limit",
                entity_id=str(org_id),
                meta={
                    "old_daily_tokens_limit": old_daily,
                    "new_daily_tokens_limit": int(row.daily_tokens_limit),
                    "old_monthly_tokens_limit": old_monthly,
                    "new_monthly_tokens_limit": int(row.monthly_tokens_limit),
                },
                ip_address=ip_address,
            )
            await uow.commit()

        return await self.get_limits(org_id=org_id)

    async def upsert_user_limit(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        actor_id: uuid.UUID,
        daily_tokens_limit: int,
        rpm_limit: int,
        ip_address: str | None = None,
    ) -> dict:
        async with UnitOfWork() as uow:
            membership = (
                await uow.session.execute(
                    select(Membership).where(Membership.org_id == org_id, Membership.user_id == user_id).limit(1)
                )
            ).scalars().first()
            if membership is None:
                raise LookupError("MEMBER_NOT_FOUND")

            row = (
                await uow.session.execute(select(AIUserLimit).where(AIUserLimit.org_id == org_id, AIUserLimit.user_id == user_id))
            ).scalars().first()
            if row is None:
                row = AIUserLimit(org_id=org_id, user_id=user_id)
                uow.session.add(row)
                await uow.session.flush()
            old_daily = int(row.daily_tokens_limit or 0)
            old_rpm = int(row.rpm_limit or 0)
            row.daily_tokens_limit = int(max(0, daily_tokens_limit))
            row.rpm_limit = int(max(0, rpm_limit))

            audit_repo = AuditRepository(uow.session)
            await audit_repo.log(
                org_id=org_id,
                actor_id=actor_id,
                action=AuditAction.UPDATE,
                entity_type="org_ai_user_limit",
                entity_id=str(user_id),
                meta={
                    "old_daily_tokens_limit": old_daily,
                    "new_daily_tokens_limit": int(row.daily_tokens_limit),
                    "old_rpm_limit": old_rpm,
                    "new_rpm_limit": int(row.rpm_limit),
                },
                ip_address=ip_address,
            )
            await uow.commit()

        return await self.get_limits(org_id=org_id)
