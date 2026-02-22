from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select, text

from src.infrastructure.uow import UnitOfWork
from src.modules.ai.models import AIUsageLog
from src.modules.auth.models import User
from src.modules.files.models import File
from src.modules.org.models import Organization
from src.modules.tables.models import Table
from src.modules.tables.records import Record


def _safe_int(v) -> int:
    try:
        return int(v or 0)
    except Exception:
        return 0


class SuperadminOverviewService:
    """Overview/dashboard use-cases for superadmin."""

    async def dashboard_data(self) -> dict:
        async with UnitOfWork() as uow:
            orgs_count = (await uow.session.execute(select(func.count()).select_from(Organization))).scalar() or 0
            users_count = (await uow.session.execute(select(func.count()).select_from(User))).scalar() or 0
            tables_count = (await uow.session.execute(select(func.count()).select_from(Table))).scalar() or 0
            records_count = (await uow.session.execute(select(func.count()).select_from(Record))).scalar() or 0
            files_row = (
                await uow.session.execute(
                    select(func.count(), func.coalesce(func.sum(File.size), 0)).select_from(File),
                )
            ).one()
            ai_row = (
                await uow.session.execute(
                    select(func.count(), func.coalesce(func.sum(AIUsageLog.total_tokens), 0)).select_from(AIUsageLog),
                )
            ).one()

            thirty_days_ago = datetime.now(UTC) - timedelta(days=30)
            reg_stmt = (
                select(func.date_trunc("day", User.created_at).label("day"), func.count().label("cnt"))
                .where(User.created_at >= thirty_days_ago)
                .group_by(text("day"))
                .order_by(text("day"))
            )
            reg_rows = (await uow.session.execute(reg_stmt)).all()

            plan_stmt = select(Organization.plan, func.count().label("cnt")).group_by(Organization.plan)
            plan_rows = (await uow.session.execute(plan_stmt)).all()

        return {
            "totals": {
                "orgs": _safe_int(orgs_count),
                "users": _safe_int(users_count),
                "tables": _safe_int(tables_count),
                "records": _safe_int(records_count),
                "files": _safe_int(files_row[0]),
                "storage_bytes": _safe_int(files_row[1]),
                "ai_requests": _safe_int(ai_row[0]),
                "ai_tokens": _safe_int(ai_row[1]),
            },
            "registrations_timeline": [{"date": str(r.day)[:10], "count": r.cnt} for r in reg_rows],
            "orgs_by_plan": [
                {"plan": str(r.plan.value if hasattr(r.plan, "value") else r.plan), "count": r.cnt}
                for r in plan_rows
            ],
        }

    async def list_org_options(self, limit: int = 200) -> list[dict]:
        async with UnitOfWork() as uow:
            stmt = select(Organization).order_by(Organization.created_at.desc()).limit(limit)
            orgs = list((await uow.session.execute(stmt)).scalars().all())
            return [
                {
                    "id": str(org.id),
                    "name": org.name,
                    "slug": org.slug,
                    "plan": org.plan.value if hasattr(org.plan, "value") else str(org.plan),
                    "created_at": org.created_at.isoformat() if org.created_at else None,
                }
                for org in orgs
            ]

    async def overview_data(self, org_limit: int = 200) -> dict:
        dash = await self.dashboard_data()
        orgs = await self.list_org_options(limit=org_limit)
        return {"dashboard": dash, "orgs": orgs, "generated_at": datetime.now(UTC).isoformat()}

    async def list_tables(self, limit: int, offset: int) -> list[dict]:
        async with UnitOfWork() as uow:
            stmt = select(Table).order_by(Table.created_at.desc()).limit(limit).offset(offset)
            tables = list((await uow.session.execute(stmt)).scalars().all())
            result: list[dict] = []
            for table in tables:
                rec_cnt = (
                    await uow.session.execute(
                        select(func.count()).select_from(Record).where(Record.table_id == table.id),
                    )
                ).scalar() or 0
                result.append(
                    {
                        "id": str(table.id),
                        "name": table.name,
                        "org_id": str(table.org_id),
                        "columns": len(table.columns) if table.columns else 0,
                        "records": rec_cnt,
                        "created_at": table.created_at.isoformat() if table.created_at else None,
                    },
                )
        return result

    async def ai_usage_by_org(self) -> list[dict]:
        async with UnitOfWork() as uow:
            stmt = (
                select(
                    AIUsageLog.org_id,
                    func.count().label("requests"),
                    func.coalesce(func.sum(AIUsageLog.total_tokens), 0).label("tokens"),
                )
                .group_by(AIUsageLog.org_id)
                .order_by(func.sum(AIUsageLog.total_tokens).desc())
            )
            rows = (await uow.session.execute(stmt)).all()
            org_ids = [row.org_id for row in rows]
            orgs_map: dict = {}
            if org_ids:
                orgs = list(
                    (
                        await uow.session.execute(select(Organization).where(Organization.id.in_(org_ids)))
                    ).scalars().all(),
                )
                orgs_map = {org.id: org.name for org in orgs}

        return [
            {
                "org_id": str(row.org_id),
                "org_name": orgs_map.get(row.org_id, "-"),
                "requests": _safe_int(row.requests),
                "tokens": _safe_int(row.tokens),
            }
            for row in rows
        ]
