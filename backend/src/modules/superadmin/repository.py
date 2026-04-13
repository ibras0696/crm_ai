"""Запросы к БД для модуля supеradmin (read-модели).

Правило: в service не должно быть SQL. Здесь только выборки/агрегации.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from sqlalchemy import String, and_, delete, func, or_, select
from sqlalchemy.orm import selectinload

from src.common.enums import SubscriptionStatus
from src.modules.ai.models import AIUsageLog
from src.modules.audit.models import AuditLog
from src.modules.auth.models import User
from src.modules.billing.models import Plan
from src.modules.files.models import File
from src.modules.org.models import Membership, Organization, Subscription
from src.modules.superadmin.models import SuperadminOrgDeletionJob
from src.modules.tables.models import Column, Table
from src.modules.tables.records import Record

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession


def _utc_day_start(dt: datetime) -> datetime:
    dt = dt.astimezone(UTC)
    return datetime(dt.year, dt.month, dt.day, tzinfo=UTC)


class SuperadminRepository:
    """Репозиторий supеradmin.

    Содержит только операции чтения/агрегаций и безопасные выборки.
    """

    def __init__(self, session: AsyncSession):
        self.session = session

    async def list_orgs_page(
        self,
        *,
        q: str | None,
        plan: str | None,
        sub_status: str | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict], int]:
        return await list_orgs_page(self.session, q=q, plan=plan, sub_status=sub_status, limit=limit, offset=offset)

    async def get_org_detail(self, *, org_id: uuid.UUID) -> dict | None:
        return await get_org_detail(self.session, org_id=org_id)

    async def list_org_members(self, *, org_id: uuid.UUID, limit: int, offset: int) -> tuple[list[dict], int]:
        return await list_org_members(self.session, org_id=org_id, limit=limit, offset=offset)

    async def list_users_page(
        self,
        *,
        q: str | None,
        org_id: uuid.UUID | None,
        is_active: bool | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict], int]:
        return await list_users_page(self.session, q=q, org_id=org_id, is_active=is_active, limit=limit, offset=offset)

    async def list_audit_logs_page(
        self,
        *,
        org_id: uuid.UUID | None,
        limit: int,
        offset: int,
    ) -> tuple[list[dict], int]:
        return await list_audit_logs_page(self.session, org_id=org_id, limit=limit, offset=offset)

    async def get_org_model(self, *, org_id: uuid.UUID) -> Organization | None:
        """Получить ORM-модель организации по ID."""
        return (await self.session.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()

    async def get_subscription_by_org(self, *, org_id: uuid.UUID) -> Subscription | None:
        """Получить подписку организации (если есть)."""
        return (
            await self.session.execute(select(Subscription).where(Subscription.org_id == org_id))
        ).scalar_one_or_none()

    async def get_org_deletion_job(self, *, job_id: uuid.UUID) -> SuperadminOrgDeletionJob | None:
        return (
            await self.session.execute(
                select(SuperadminOrgDeletionJob).where(SuperadminOrgDeletionJob.id == job_id)
            )
        ).scalar_one_or_none()

    async def get_active_org_deletion_job(self, *, org_id: uuid.UUID) -> SuperadminOrgDeletionJob | None:
        return (
            await self.session.execute(
                select(SuperadminOrgDeletionJob)
                .where(
                    SuperadminOrgDeletionJob.org_id == org_id,
                    SuperadminOrgDeletionJob.status.in_(("queued", "running")),
                )
                .order_by(SuperadminOrgDeletionJob.created_at.desc())
                .limit(1)
            )
        ).scalar_one_or_none()

    async def create_org_deletion_job(
        self,
        *,
        org_id: uuid.UUID,
        org_name: str,
        requested_by: str,
    ) -> SuperadminOrgDeletionJob:
        job = SuperadminOrgDeletionJob(
            org_id=org_id,
            org_name=org_name,
            requested_by=requested_by,
            status="queued",
        )
        self.session.add(job)
        await self.session.flush()
        return job

    async def reset_ai_usage_today(self, *, org_id: uuid.UUID, day_start: datetime) -> tuple[int, int]:
        """Сбросить usage AI за текущий день для организации.

        Returns:
            (removed_requests, removed_tokens).
        """
        usage_before = (
            await self.session.execute(
                select(
                    func.count(AIUsageLog.id),
                    func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
                ).where(
                    AIUsageLog.org_id == org_id,
                    AIUsageLog.created_at >= day_start,
                )
            )
        ).one()
        removed_requests = int(usage_before[0] or 0)
        removed_tokens = int(usage_before[1] or 0)

        if removed_requests > 0:
            await self.session.execute(
                delete(AIUsageLog).where(
                    AIUsageLog.org_id == org_id,
                    AIUsageLog.created_at >= day_start,
                )
            )

        return removed_requests, removed_tokens

    async def list_tables_by_org_page(
        self,
        *,
        org_id: uuid.UUID,
        q: str | None,
        include_archived: bool,
        limit: int,
        offset: int,
    ) -> tuple[list[dict], int]:
        """Список таблиц организации (без N+1)."""
        col_sq = (
            select(Column.table_id.label("table_id"), func.count().label("columns"))
            .group_by(Column.table_id)
            .subquery()
        )
        rec_sq = (
            select(Record.table_id.label("table_id"), func.count().label("records"))
            .group_by(Record.table_id)
            .subquery()
        )

        stmt = (
            select(
                Table.id,
                Table.org_id,
                Table.folder_id,
                Table.name,
                Table.description,
                Table.icon,
                Table.color,
                Table.is_archived,
                Table.created_at,
                func.coalesce(col_sq.c.columns, 0).label("columns"),
                func.coalesce(rec_sq.c.records, 0).label("records"),
            )
            .select_from(Table)
            .outerjoin(col_sq, col_sq.c.table_id == Table.id)
            .outerjoin(rec_sq, rec_sq.c.table_id == Table.id)
            .where(Table.org_id == org_id)
            .order_by(Table.created_at.desc())
        )

        filters = []
        if not include_archived:
            filters.append(Table.is_archived.is_(False))
        if q:
            like = f"%{q.strip()}%"
            filters.append(Table.name.ilike(like))
        if filters:
            stmt = stmt.where(and_(*filters))

        count_stmt = select(func.count()).select_from(Table).where(Table.org_id == org_id)
        if filters:
            count_stmt = count_stmt.where(and_(*filters))

        total = int((await self.session.execute(count_stmt)).scalar() or 0)
        rows = (await self.session.execute(stmt.limit(limit).offset(offset))).all()

        items = [
            {
                "id": str(r.id),
                "org_id": str(r.org_id),
                "folder_id": str(r.folder_id) if r.folder_id else None,
                "name": r.name,
                "description": r.description,
                "icon": r.icon,
                "color": r.color,
                "is_archived": bool(r.is_archived),
                "created_at": r.created_at.isoformat() if r.created_at else None,
                "columns": int(r.columns or 0),
                "records": int(r.records or 0),
            }
            for r in rows
        ]
        return items, total

    async def get_table_in_org(self, *, org_id: uuid.UUID, table_id: uuid.UUID) -> Table | None:
        """Получить таблицу с колонками, проверяя принадлежность организации."""
        stmt = select(Table).where(Table.id == table_id, Table.org_id == org_id).options()
        # TableRepository already uses selectinload, но здесь проще явно.
        stmt = stmt.options(selectinload(Table.columns))
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_table_records_page(
        self,
        *,
        org_id: uuid.UUID,
        table_id: uuid.UUID,
        q: str | None,
        sort_col_id: str | None,
        sort_dir: str,
        limit: int,
        offset: int,
    ) -> tuple[list[Record], int]:
        """Список записей таблицы с пагинацией + простым поиском/сортировкой.

        Поиск:
        - если указан sort_col_id, то используем data->>col_id ILIKE.
        - иначе ищем по строковому представлению JSONB (data::text ILIKE).
          Это медленнее, но приемлемо для read-only админки.
        """
        stmt = select(Record).where(Record.org_id == org_id, Record.table_id == table_id)
        count_stmt = (
            select(func.count()).select_from(Record).where(Record.org_id == org_id, Record.table_id == table_id)
        )

        if q:
            like = f"%{q.strip().lower()}%"
            if sort_col_id:
                stmt = stmt.where(func.lower(Record.data.op("->>")(sort_col_id)).ilike(like))
                count_stmt = count_stmt.where(func.lower(Record.data.op("->>")(sort_col_id)).ilike(like))
            else:
                stmt = stmt.where(func.lower(Record.data.cast(String)).ilike(like))
                count_stmt = count_stmt.where(func.lower(Record.data.cast(String)).ilike(like))

        # Default order is the same as normal tables view.
        if sort_col_id:
            key_expr = Record.data.op("->>")(sort_col_id)
            if sort_dir == "desc":
                stmt = stmt.order_by(key_expr.desc().nullslast(), Record.position.asc(), Record.created_at.desc())
            else:
                stmt = stmt.order_by(key_expr.asc().nullsfirst(), Record.position.asc(), Record.created_at.desc())
        else:
            stmt = stmt.order_by(Record.position.asc(), Record.created_at.desc())

        total = int((await self.session.execute(count_stmt)).scalar() or 0)
        rows = list((await self.session.execute(stmt.limit(limit).offset(offset))).scalars().all())
        return rows, total


async def list_orgs_page(
    session: AsyncSession,
    *,
    q: str | None,
    plan: str | None,
    sub_status: str | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    """Return (items, total) for organizations list."""

    mem_sq = (
        select(Membership.org_id.label("org_id"), func.count().label("members")).group_by(Membership.org_id).subquery()
    )
    tbl_sq = select(Table.org_id.label("org_id"), func.count().label("tables")).group_by(Table.org_id).subquery()
    rec_sq = select(Record.org_id.label("org_id"), func.count().label("records")).group_by(Record.org_id).subquery()

    # Subscription is 1:1 with org (unique), left join is safe.
    stmt = (
        select(
            Organization.id,
            Organization.name,
            Organization.slug,
            Organization.plan,
            Organization.created_at,
            Subscription.plan.label("sub_plan"),
            Subscription.status.label("sub_status"),
            Subscription.current_period_start,
            Subscription.current_period_end,
            func.coalesce(mem_sq.c.members, 0).label("members"),
            func.coalesce(tbl_sq.c.tables, 0).label("tables"),
            func.coalesce(rec_sq.c.records, 0).label("records"),
        )
        .select_from(Organization)
        .outerjoin(Subscription, Subscription.org_id == Organization.id)
        .outerjoin(mem_sq, mem_sq.c.org_id == Organization.id)
        .outerjoin(tbl_sq, tbl_sq.c.org_id == Organization.id)
        .outerjoin(rec_sq, rec_sq.c.org_id == Organization.id)
        .order_by(Organization.created_at.desc())
    )

    filters = []
    if q:
        like = f"%{q.strip()}%"
        filters.append(or_(Organization.name.ilike(like), Organization.slug.ilike(like)))
    if plan:
        filters.append(Organization.plan == plan)
    if sub_status:
        if sub_status == "none":
            filters.append(Subscription.org_id.is_(None))
        else:
            # Validate against enum values; invalid values return empty list.
            try:
                SubscriptionStatus(sub_status)
            except Exception:
                filters.append(and_(False))
            else:
                filters.append(Subscription.status == sub_status)

    if filters:
        stmt = stmt.where(and_(*filters))

    count_stmt = (
        select(func.count()).select_from(Organization).outerjoin(Subscription, Subscription.org_id == Organization.id)
    )
    if filters:
        count_stmt = count_stmt.where(and_(*filters))

    total = int((await session.execute(count_stmt)).scalar() or 0)
    rows = (await session.execute(stmt.limit(limit).offset(offset))).all()

    items = [
        {
            "id": str(r.id),
            "name": r.name,
            "slug": r.slug,
            "plan": r.plan.value if hasattr(r.plan, "value") else str(r.plan),
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "members": int(r.members or 0),
            "tables": int(r.tables or 0),
            "records": int(r.records or 0),
            "subscription": (
                None
                if r.sub_status is None and r.sub_plan is None
                else {
                    "plan": r.sub_plan.value if hasattr(r.sub_plan, "value") else str(r.sub_plan),
                    "status": r.sub_status.value if hasattr(r.sub_status, "value") else str(r.sub_status),
                    "current_period_start": r.current_period_start.isoformat() if r.current_period_start else None,
                    "current_period_end": r.current_period_end.isoformat() if r.current_period_end else None,
                }
            ),
        }
        for r in rows
    ]
    return items, total


async def get_org_detail(session: AsyncSession, *, org_id: uuid.UUID) -> dict | None:
    org = (await session.execute(select(Organization).where(Organization.id == org_id))).scalar_one_or_none()
    if not org:
        return None

    sub = (await session.execute(select(Subscription).where(Subscription.org_id == org_id))).scalar_one_or_none()

    # Usage counts.
    mem_cnt = (
        await session.execute(select(func.count()).select_from(Membership).where(Membership.org_id == org_id))
    ).scalar() or 0
    tbl_cnt = (
        await session.execute(select(func.count()).select_from(Table).where(Table.org_id == org_id))
    ).scalar() or 0
    rec_cnt = (
        await session.execute(select(func.count()).select_from(Record).where(Record.org_id == org_id))
    ).scalar() or 0
    files_row = (
        await session.execute(
            select(func.count(), func.coalesce(func.sum(File.size), 0)).select_from(File).where(File.org_id == org_id)
        )
    ).one()

    # Plan limits (source of truth: plans table).
    plan_name = org.plan.value if hasattr(org.plan, "value") else str(org.plan)
    if sub and getattr(sub, "status", None) == SubscriptionStatus.ACTIVE and getattr(sub, "plan", None) is not None:
        plan_name = sub.plan.value if hasattr(sub.plan, "value") else str(sub.plan)

    plan = (
        (await session.execute(select(Plan).where(Plan.name == plan_name, Plan.is_active.is_(True)))).scalars().first()
    )

    # AI usage today (for progress UI).
    now = datetime.now(UTC)
    used_today = (
        await session.execute(
            select(func.coalesce(func.sum(AIUsageLog.total_tokens), 0)).where(
                AIUsageLog.org_id == org_id, AIUsageLog.created_at >= _utc_day_start(now)
            )
        )
    ).scalar_one()

    return {
        "org": {
            "id": str(org.id),
            "name": org.name,
            "slug": org.slug,
            "plan": org.plan.value if hasattr(org.plan, "value") else str(org.plan),
            "ai_enabled": bool(org.ai_enabled),
            "created_at": org.created_at.isoformat() if org.created_at else None,
        },
        "subscription": (
            None
            if not sub
            else {
                "plan": sub.plan.value if hasattr(sub.plan, "value") else str(sub.plan),
                "status": sub.status.value if hasattr(sub.status, "value") else str(sub.status),
                "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
                "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
                "external_id": sub.external_id,
            }
        ),
        "plan_limits": (
            None
            if not plan
            else {
                "name": plan.name,
                "display_name": plan.display_name,
                "price_monthly": int(plan.price_monthly),
                "price_yearly": int(plan.price_yearly),
                "max_members": int(plan.max_members),
                "max_tables": int(plan.max_tables),
                "max_records": int(plan.max_records),
                "max_storage_mb": int(plan.max_storage_mb),
                "has_ai": bool(plan.has_ai),
                "ai_max_tokens_per_request": int(plan.ai_max_tokens_per_request),
                "ai_tokens_per_day": int(plan.ai_tokens_per_day),
                "ai_rpm_per_user": int(plan.ai_rpm_per_user),
            }
        ),
        "usage": {
            "members": int(mem_cnt),
            "tables": int(tbl_cnt),
            "records": int(rec_cnt),
            "files": int(files_row[0] or 0),
            "storage_bytes": int(files_row[1] or 0),
        },
        "ai_usage_today": {
            "tokens_used": int(used_today or 0),
        },
    }


async def list_org_members(
    session: AsyncSession, *, org_id: uuid.UUID, limit: int, offset: int
) -> tuple[list[dict], int]:
    total = int(
        (
            await session.execute(select(func.count()).select_from(Membership).where(Membership.org_id == org_id))
        ).scalar()
        or 0
    )
    stmt = (
        select(Membership, User)
        .join(User, User.id == Membership.user_id)
        .where(Membership.org_id == org_id)
        .order_by(User.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    rows = (await session.execute(stmt)).all()
    items: list[dict] = []
    for m, u in rows:
        items.append(
            {
                "user": {
                    "id": str(u.id),
                    "email": u.email,
                    "first_name": u.first_name,
                    "last_name": u.last_name,
                    "is_active": bool(u.is_active),
                    "created_at": u.created_at.isoformat() if u.created_at else None,
                },
                "membership": {
                    "id": str(m.id),
                    "role": m.role.value if hasattr(m.role, "value") else str(m.role),
                    "created_at": m.created_at.isoformat() if m.created_at else None,
                },
            }
        )
    return items, total


async def list_users_page(
    session: AsyncSession,
    *,
    q: str | None,
    org_id: uuid.UUID | None,
    is_active: bool | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    stmt = select(User).order_by(User.created_at.desc())
    count_stmt = select(func.count()).select_from(User)

    filters = []
    if q:
        like = f"%{q.strip()}%"
        filters.append(or_(User.email.ilike(like), User.first_name.ilike(like), User.last_name.ilike(like)))
    if is_active is not None:
        filters.append(User.is_active.is_(bool(is_active)))
    if org_id is not None:
        stmt = stmt.join(Membership, Membership.user_id == User.id).where(Membership.org_id == org_id)
        count_stmt = count_stmt.join(Membership, Membership.user_id == User.id).where(Membership.org_id == org_id)

    if filters:
        stmt = stmt.where(and_(*filters))
        count_stmt = count_stmt.where(and_(*filters))

    total = int((await session.execute(count_stmt)).scalar() or 0)
    users = list((await session.execute(stmt.limit(limit).offset(offset))).scalars().all())

    # Batch-load memberships for returned users.
    memberships: dict[uuid.UUID, list[dict]] = {u.id: [] for u in users}
    if users:
        mem_rows = (
            (await session.execute(select(Membership).where(Membership.user_id.in_([u.id for u in users]))))
            .scalars()
            .all()
        )
        for m in mem_rows:
            memberships.setdefault(m.user_id, []).append(
                {"org_id": str(m.org_id), "role": m.role.value if hasattr(m.role, "value") else str(m.role)}
            )

    items = [
        {
            "id": str(u.id),
            "email": u.email,
            "first_name": u.first_name,
            "last_name": u.last_name,
            "is_active": bool(u.is_active),
            "created_at": u.created_at.isoformat() if u.created_at else None,
            "orgs": memberships.get(u.id, []),
        }
        for u in users
    ]
    return items, total


async def list_audit_logs_page(
    session: AsyncSession,
    *,
    org_id: uuid.UUID | None,
    limit: int,
    offset: int,
) -> tuple[list[dict], int]:
    base = (
        select(AuditLog, Organization.name)
        .join(Organization, Organization.id == AuditLog.org_id)
        .order_by(AuditLog.created_at.desc())
    )
    count_stmt = select(func.count()).select_from(AuditLog)
    if org_id is not None:
        base = base.where(AuditLog.org_id == org_id)
        count_stmt = count_stmt.where(AuditLog.org_id == org_id)

    total = int((await session.execute(count_stmt)).scalar() or 0)
    rows = (await session.execute(base.limit(limit).offset(offset))).all()
    items: list[dict] = []
    for log, org_name in rows:
        items.append(
            {
                "id": str(log.id),
                "org_id": str(log.org_id),
                "org_name": org_name,
                "actor_id": str(log.actor_id) if log.actor_id else None,
                "action": log.action.value if hasattr(log.action, "value") else str(log.action),
                "entity_type": log.entity_type,
                "entity_id": log.entity_id,
                "meta": log.meta,
                "ip_address": log.ip_address,
                "correlation_id": log.correlation_id,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
        )
    return items, total
