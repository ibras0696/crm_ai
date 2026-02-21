"""Service layer for superadmin module."""

import uuid
from datetime import UTC, datetime, timedelta, timezone

import jwt as pyjwt
from sqlalchemy import func, select, text

from src.common.enums import PlanTier, UserRole
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.models import AIUsageLog
from src.modules.auth.models import User
from src.modules.files.models import File
from src.modules.org.models import Membership, Organization
from src.modules.tables.models import Table
from src.modules.tables.records import Record


def authenticate_superadmin(email: str, password: str) -> str:
    if not settings.SUPERADMIN_EMAIL or not settings.SUPERADMIN_PASSWORD:
        raise RuntimeError("SUPERADMIN_NOT_CONFIGURED")
    if email != settings.SUPERADMIN_EMAIL or password != settings.SUPERADMIN_PASSWORD:
        raise ValueError("INVALID_CREDENTIALS")
    now = datetime.now(UTC)
    payload = {
        "sub": "superadmin",
        "role": UserRole.SUPERADMIN.value,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(hours=12),
    }
    return pyjwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


async def dashboard_data() -> dict:
    async with UnitOfWork() as uow:
        orgs_count = (await uow.session.execute(select(func.count()).select_from(Organization))).scalar() or 0
        users_count = (await uow.session.execute(select(func.count()).select_from(User))).scalar() or 0
        tables_count = (await uow.session.execute(select(func.count()).select_from(Table))).scalar() or 0
        records_count = (await uow.session.execute(select(func.count()).select_from(Record))).scalar() or 0
        files_row = (
            await uow.session.execute(select(func.count(), func.coalesce(func.sum(File.size), 0)).select_from(File))
        ).one()
        ai_row = (
            await uow.session.execute(select(func.count(), func.coalesce(func.sum(AIUsageLog.total_tokens), 0)).select_from(AIUsageLog))
        ).one()

        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
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
            "orgs": orgs_count,
            "users": users_count,
            "tables": tables_count,
            "records": records_count,
            "files": files_row[0],
            "storage_bytes": files_row[1],
            "ai_requests": ai_row[0],
            "ai_tokens": ai_row[1],
        },
        "registrations_timeline": [{"date": str(r.day)[:10], "count": r.cnt} for r in reg_rows],
        "orgs_by_plan": [{"plan": str(r.plan.value if hasattr(r.plan, "value") else r.plan), "count": r.cnt} for r in plan_rows],
    }


async def list_orgs(limit: int, offset: int) -> list[dict]:
    async with UnitOfWork() as uow:
        stmt = select(Organization).order_by(Organization.created_at.desc()).limit(limit).offset(offset)
        orgs = list((await uow.session.execute(stmt)).scalars().all())
        result: list[dict] = []
        for org in orgs:
            mem_cnt = (
                await uow.session.execute(select(func.count()).select_from(Membership).where(Membership.org_id == org.id))
            ).scalar() or 0
            tbl_cnt = (
                await uow.session.execute(select(func.count()).select_from(Table).where(Table.org_id == org.id))
            ).scalar() or 0
            rec_cnt = (
                await uow.session.execute(select(func.count()).select_from(Record).where(Record.org_id == org.id))
            ).scalar() or 0
            result.append(
                {
                    "id": str(org.id),
                    "name": org.name,
                    "slug": org.slug,
                    "plan": org.plan.value if hasattr(org.plan, "value") else str(org.plan),
                    "created_at": org.created_at.isoformat() if org.created_at else None,
                    "members": mem_cnt,
                    "tables": tbl_cnt,
                    "records": rec_cnt,
                }
            )
    return result


async def list_users(limit: int, offset: int) -> list[dict]:
    async with UnitOfWork() as uow:
        stmt = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
        users = list((await uow.session.execute(stmt)).scalars().all())
        result: list[dict] = []
        for user in users:
            memberships = [
                {"org_id": str(m.org_id), "role": m.role.value if hasattr(m.role, "value") else str(m.role)}
                for m in user.memberships
            ]
            result.append(
                {
                    "id": str(user.id),
                    "email": user.email,
                    "first_name": user.first_name,
                    "last_name": user.last_name,
                    "is_active": user.is_active,
                    "created_at": user.created_at.isoformat() if user.created_at else None,
                    "orgs": memberships,
                }
            )
    return result


async def list_tables(limit: int, offset: int) -> list[dict]:
    async with UnitOfWork() as uow:
        stmt = select(Table).order_by(Table.created_at.desc()).limit(limit).offset(offset)
        tables = list((await uow.session.execute(stmt)).scalars().all())
        result: list[dict] = []
        for table in tables:
            rec_cnt = (
                await uow.session.execute(select(func.count()).select_from(Record).where(Record.table_id == table.id))
            ).scalar() or 0
            result.append(
                {
                    "id": str(table.id),
                    "name": table.name,
                    "org_id": str(table.org_id),
                    "columns": len(table.columns) if table.columns else 0,
                    "records": rec_cnt,
                    "created_at": table.created_at.isoformat() if table.created_at else None,
                }
            )
    return result


async def ai_usage_by_org() -> list[dict]:
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
        org_ids = [r.org_id for r in rows]
        orgs_map: dict = {}
        if org_ids:
            orgs = list((await uow.session.execute(select(Organization).where(Organization.id.in_(org_ids)))).scalars().all())
            orgs_map = {o.id: o.name for o in orgs}
    return [
        {
            "org_id": str(r.org_id),
            "org_name": orgs_map.get(r.org_id, "—"),
            "requests": r.requests,
            "tokens": r.tokens,
        }
        for r in rows
    ]


async def set_plan(org_id: str, plan_name: str) -> dict:
    try:
        plan_tier = PlanTier(plan_name)
    except ValueError as exc:
        raise ValueError("INVALID_PLAN") from exc

    async with UnitOfWork() as uow:
        org = (await uow.session.execute(select(Organization).where(Organization.id == uuid.UUID(org_id)))).scalar_one_or_none()
        if not org:
            raise LookupError("NOT_FOUND")
        org.plan = plan_tier
        await uow.commit()
    return {"org_id": org_id, "plan": plan_name}


def ai_config() -> dict:
    base_url = (settings.AI_BASE_URL or "").rstrip("/")
    provider = "timeweb-agent-openai-compatible" if "agent.timeweb.cloud" in base_url else "openai-compatible"
    key = settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY or ""
    return {
        "provider": provider,
        "base_url": base_url,
        "official_provider_docs_url": "https://agent.timeweb.cloud/docs",
        "model": settings.OPENAI_MODEL,
        "key_configured": bool(key),
        "key_prefix": f"{key[:4]}***" if key else "",
    }
