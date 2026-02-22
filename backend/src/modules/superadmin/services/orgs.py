import uuid

from sqlalchemy import select

from src.common.enums import AuditAction, PlanTier, SubscriptionStatus
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.repository import AuditRepository
from src.modules.org.models import Organization, Subscription
from src.modules.superadmin.repository import SuperadminRepository


class SuperadminOrgsService:
    """Organization-focused use-cases for superadmin."""

    async def list_orgs_page(
        self,
        *,
        q: str | None,
        plan: str | None,
        sub_status: str | None,
        limit: int,
        offset: int,
    ) -> dict:
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            items, total = await repo.list_orgs_page(
                q=q,
                plan=plan,
                sub_status=sub_status,
                limit=limit,
                offset=offset,
            )
        return {"items": items, "total": total, "limit": int(limit), "offset": int(offset)}

    async def org_detail(self, org_id: str) -> dict:
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            data = await repo.get_org_detail(org_id=uuid.UUID(org_id))
            if not data:
                raise LookupError("NOT_FOUND")
        return data

    async def org_members_page(self, org_id: str, *, limit: int, offset: int) -> dict:
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            items, total = await repo.list_org_members(org_id=uuid.UUID(org_id), limit=limit, offset=offset)
        return {"items": items, "total": total, "limit": int(limit), "offset": int(offset)}

    async def list_users_page(
        self,
        *,
        q: str | None,
        org_id: str | None,
        is_active: bool | None,
        limit: int,
        offset: int,
    ) -> dict:
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            items, total = await repo.list_users_page(
                q=q,
                org_id=uuid.UUID(org_id) if org_id else None,
                is_active=is_active,
                limit=limit,
                offset=offset,
            )
        return {"items": items, "total": total, "limit": int(limit), "offset": int(offset)}

    async def set_plan(self, *, org_id: str, plan_name: str) -> dict:
        try:
            plan_tier = PlanTier(plan_name)
        except ValueError as exc:
            raise ValueError("INVALID_PLAN") from exc

        async with UnitOfWork() as uow:
            org_uuid = uuid.UUID(org_id)
            org = (
                await uow.session.execute(select(Organization).where(Organization.id == org_uuid))
            ).scalar_one_or_none()
            if not org:
                raise LookupError("NOT_FOUND")
            old_plan = org.plan.value if hasattr(org.plan, "value") else str(org.plan)

            sub = (
                await uow.session.execute(select(Subscription).where(Subscription.org_id == org_uuid))
            ).scalar_one_or_none()
            if sub:
                sub.plan = plan_tier
                sub.status = SubscriptionStatus.ACTIVE
            else:
                sub = Subscription(org_id=org_uuid, plan=plan_tier, status=SubscriptionStatus.ACTIVE)
                uow.session.add(sub)

            org.plan = plan_tier

            audit_repo = AuditRepository(uow.session)
            await audit_repo.log(
                org_id=org_uuid,
                actor_id=None,
                action=AuditAction.UPDATE,
                entity_type="org_plan",
                entity_id=str(org_uuid),
                meta={"superadmin": True, "old_plan": old_plan, "new_plan": plan_tier.value},
            )
            await uow.commit()
        return {"org_id": org_id, "plan": plan_name}

    async def audit_logs_page(self, *, org_id: str | None, limit: int, offset: int) -> dict:
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            items, total = await repo.list_audit_logs_page(
                org_id=uuid.UUID(org_id) if org_id else None,
                limit=limit,
                offset=offset,
            )
        return {"items": items, "total": total, "limit": int(limit), "offset": int(offset)}
