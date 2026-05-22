import uuid
from datetime import UTC, datetime, timedelta

from src.common.enums import AuditAction, PlanTier, SubscriptionStatus
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.repository import AuditRepository
from src.modules.org.models import Subscription
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

    async def create_or_get_org_deletion_job(self, *, org_id: str, requested_by: str) -> dict:
        org_uuid = uuid.UUID(org_id)
        requested_by_email = (requested_by or "").strip() or "superadmin"

        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            org = await repo.get_org_model(org_id=org_uuid)
            if not org:
                raise LookupError("NOT_FOUND")

            existing = await repo.get_active_org_deletion_job(org_id=org_uuid)
            if existing:
                return self._serialize_org_deletion_job(existing)

            job = await repo.create_org_deletion_job(
                org_id=org_uuid,
                org_name=str(org.name or "").strip() or "Организация",
                requested_by=requested_by_email,
            )
            await uow.commit()
            await uow.session.refresh(job)
            return self._serialize_org_deletion_job(job)

    async def set_org_deletion_job_task_id(self, *, job_id: str, task_id: str) -> dict:
        job_uuid = uuid.UUID(job_id)
        safe_task_id = (task_id or "").strip()

        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            job = await repo.get_org_deletion_job(job_id=job_uuid)
            if not job:
                raise LookupError("NOT_FOUND")
            job.task_id = safe_task_id or None
            await uow.commit()
            await uow.session.refresh(job)
            return self._serialize_org_deletion_job(job)

    async def get_org_deletion_job(self, *, job_id: str) -> dict:
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            job = await repo.get_org_deletion_job(job_id=uuid.UUID(job_id))
            if not job:
                raise LookupError("NOT_FOUND")
            return self._serialize_org_deletion_job(job)

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
            repo = SuperadminRepository(uow.session)
            org_uuid = uuid.UUID(org_id)
            org = await repo.get_org_model(org_id=org_uuid)
            if not org:
                raise LookupError("NOT_FOUND")
            old_plan = org.plan.value if hasattr(org.plan, "value") else str(org.plan)

            sub = await repo.get_subscription_by_org(org_id=org_uuid)
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

    async def set_subscription_period(
        self,
        *,
        org_id: str,
        plan_name: str,
        period_days: int | None,
        current_period_end: datetime | None,
    ) -> dict:
        try:
            plan_tier = PlanTier(plan_name)
        except ValueError as exc:
            raise ValueError("INVALID_PLAN") from exc

        org_uuid = uuid.UUID(org_id)
        now = datetime.now(UTC)
        start_at = now

        if current_period_end is not None:
            end_at = (
                current_period_end.astimezone(UTC)
                if current_period_end.tzinfo
                else current_period_end.replace(tzinfo=UTC)
            )
        elif period_days is not None:
            end_at = now + timedelta(days=int(period_days))
        else:
            raise ValueError("INVALID_PERIOD")

        if end_at <= now:
            raise ValueError("INVALID_PERIOD")

        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            org = await repo.get_org_model(org_id=org_uuid)
            if not org:
                raise LookupError("NOT_FOUND")
            old_plan = org.plan.value if hasattr(org.plan, "value") else str(org.plan)

            sub = await repo.get_subscription_by_org(org_id=org_uuid)
            old_sub = {
                "status": (sub.status.value if hasattr(sub.status, "value") else str(sub.status)) if sub else None,
                "period_end": sub.current_period_end.isoformat() if sub and sub.current_period_end else None,
            }
            if sub:
                sub.plan = plan_tier
                sub.status = SubscriptionStatus.ACTIVE
                sub.current_period_start = start_at
                sub.current_period_end = end_at
                sub.grace_period_end = None
                sub.data_purge_at = None
                sub.pre_expiry_notified_at = None
                sub.post_expiry_notified_at = None
                sub.downgraded_at = None
                sub.data_purged_at = None
            else:
                sub = Subscription(
                    org_id=org_uuid,
                    plan=plan_tier,
                    status=SubscriptionStatus.ACTIVE,
                    current_period_start=start_at,
                    current_period_end=end_at,
                )
                uow.session.add(sub)

            org.plan = plan_tier

            audit_repo = AuditRepository(uow.session)
            await audit_repo.log(
                org_id=org_uuid,
                actor_id=None,
                action=AuditAction.UPDATE,
                entity_type="org_subscription_period",
                entity_id=str(org_uuid),
                meta={
                    "superadmin": True,
                    "old_plan": old_plan,
                    "new_plan": plan_tier.value,
                    "old_sub_status": old_sub["status"],
                    "old_period_end": old_sub["period_end"],
                    "new_sub_status": SubscriptionStatus.ACTIVE.value,
                    "new_period_start": start_at.isoformat(),
                    "new_period_end": end_at.isoformat(),
                    "period_days": int(period_days) if period_days is not None else None,
                },
            )
            await uow.commit()

        return {
            "org_id": org_id,
            "plan": plan_tier.value,
            "status": SubscriptionStatus.ACTIVE.value,
            "current_period_start": start_at.isoformat(),
            "current_period_end": end_at.isoformat(),
        }

    async def set_org_ai_enabled(self, *, org_id: str, enabled: bool) -> dict:
        """Включить или выключить AI на уровне организации."""
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            org_uuid = uuid.UUID(org_id)
            org = await repo.get_org_model(org_id=org_uuid)
            if not org:
                raise LookupError("NOT_FOUND")

            old_enabled = bool(org.ai_enabled)
            org.ai_enabled = bool(enabled)

            audit_repo = AuditRepository(uow.session)
            await audit_repo.log(
                org_id=org_uuid,
                actor_id=None,
                action=AuditAction.UPDATE,
                entity_type="org_ai_settings",
                entity_id=str(org_uuid),
                meta={
                    "superadmin": True,
                    "old_ai_enabled": old_enabled,
                    "new_ai_enabled": bool(enabled),
                },
            )
            await uow.commit()
            return {"org_id": org_id, "ai_enabled": bool(org.ai_enabled)}

    async def reset_org_ai_usage_today(self, *, org_id: str) -> dict:
        """Сбросить AI usage за текущий день для организации."""
        now = datetime.now(UTC)
        day_start = datetime(now.year, now.month, now.day, tzinfo=UTC)

        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            org_uuid = uuid.UUID(org_id)
            org = await repo.get_org_model(org_id=org_uuid)
            if not org:
                raise LookupError("NOT_FOUND")

            removed_requests, removed_tokens = await repo.reset_ai_usage_today(org_id=org_uuid, day_start=day_start)

            audit_repo = AuditRepository(uow.session)
            await audit_repo.log(
                org_id=org_uuid,
                actor_id=None,
                action=AuditAction.UPDATE,
                entity_type="org_ai_usage",
                entity_id=str(org_uuid),
                meta={
                    "superadmin": True,
                    "operation": "reset_today",
                    "removed_requests": removed_requests,
                    "removed_tokens": removed_tokens,
                    "day_start": day_start.isoformat(),
                },
            )
            await uow.commit()

        return {
            "org_id": org_id,
            "scope": "today",
            "removed_requests": removed_requests,
            "removed_tokens": removed_tokens,
        }

    async def audit_logs_page(self, *, org_id: str | None, limit: int, offset: int) -> dict:
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            items, total = await repo.list_audit_logs_page(
                org_id=uuid.UUID(org_id) if org_id else None,
                limit=limit,
                offset=offset,
            )
        return {"items": items, "total": total, "limit": int(limit), "offset": int(offset)}

    @staticmethod
    def _serialize_org_deletion_job(job) -> dict:
        return {
            "id": str(job.id),
            "org_id": str(job.org_id),
            "org_name": job.org_name,
            "requested_by": job.requested_by,
            "status": str(job.status),
            "task_id": job.task_id,
            "progress_total": int(job.progress_total or 0),
            "progress_processed": int(job.progress_processed or 0),
            "storage_objects_deleted": int(job.storage_objects_deleted or 0),
            "error_message": job.error_message,
            "meta_json": job.meta_json,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        }
