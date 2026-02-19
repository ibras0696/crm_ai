"""Superadmin panel — full analytics across all orgs. Access via SUPERADMIN role only."""
import uuid
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, text

from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.common.exceptions import ForbiddenError, UnauthorizedError
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/superadmin", tags=["superadmin"])


# ── Auth ──────────────────────────────────────────────────────────────────────

class SuperadminLoginRequest(BaseModel):
    email: str
    password: str


class SuperadminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


async def require_superadmin(authorization: str | None = None):
    """Dependency: validates superadmin JWT."""
    from fastapi import Header
    return authorization


def _superadmin_dep():
    from fastapi import Header
    from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
    import jwt as pyjwt
    from src.modules.auth.security import decode_access_token

    bearer = HTTPBearer(auto_error=False)

    async def _check(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
        if not credentials:
            raise UnauthorizedError("Missing authorization header")
        try:
            payload = decode_access_token(credentials.credentials)
        except Exception:
            raise UnauthorizedError("Invalid token")
        if payload.get("role") != UserRole.SUPERADMIN.value:
            raise ForbiddenError("Superadmin access required")
        return payload
    return _check


SuperadminDep = _superadmin_dep()


@router.post("/login", response_model=ApiResponse[SuperadminTokenResponse])
async def superadmin_login(body: SuperadminLoginRequest):
    """Login as superadmin using credentials from .env."""
    if not settings.SUPERADMIN_EMAIL or not settings.SUPERADMIN_PASSWORD:
        return ApiResponse(ok=False, data=None, error={
            "code": "SUPERADMIN_NOT_CONFIGURED",
            "message": "Суперадмин не настроен. Добавьте SUPERADMIN_EMAIL и SUPERADMIN_PASSWORD в .env"
        })
    if body.email != settings.SUPERADMIN_EMAIL or body.password != settings.SUPERADMIN_PASSWORD:
        raise UnauthorizedError("Invalid credentials")

    from datetime import UTC, timedelta
    import jwt as pyjwt
    now = __import__('datetime').datetime.now(UTC)
    payload = {
        "sub": "superadmin",
        "role": UserRole.SUPERADMIN.value,
        "type": "access",
        "iat": now,
        "exp": now + timedelta(hours=12),
    }
    token = pyjwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")
    return ApiResponse(data=SuperadminTokenResponse(access_token=token))


# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard", response_model=ApiResponse[dict])
async def superadmin_dashboard(payload: dict = Depends(SuperadminDep)):
    """Global platform stats."""
    from src.modules.org.models import Organization, Membership
    from src.modules.auth.models import User
    from src.modules.tables.models import Table
    from src.modules.tables.records import Record
    from src.modules.files.models import File
    from src.modules.ai.routes import AIUsageLog

    async with UnitOfWork() as uow:
        orgs_count = (await uow.session.execute(select(func.count()).select_from(Organization))).scalar() or 0
        users_count = (await uow.session.execute(select(func.count()).select_from(User))).scalar() or 0
        tables_count = (await uow.session.execute(select(func.count()).select_from(Table))).scalar() or 0
        records_count = (await uow.session.execute(select(func.count()).select_from(Record))).scalar() or 0
        files_row = (await uow.session.execute(
            select(func.count(), func.coalesce(func.sum(File.size), 0)).select_from(File)
        )).one()
        ai_row = (await uow.session.execute(
            select(func.count(), func.coalesce(func.sum(AIUsageLog.total_tokens), 0)).select_from(AIUsageLog)
        )).one()

        # Registrations per day (last 30 days)
        thirty_days_ago = datetime.now(timezone.utc) - timedelta(days=30)
        reg_stmt = (
            select(
                func.date_trunc("day", User.created_at).label("day"),
                func.count().label("cnt"),
            )
            .where(User.created_at >= thirty_days_ago)
            .group_by(text("day"))
            .order_by(text("day"))
        )
        reg_rows = (await uow.session.execute(reg_stmt)).all()

        # Orgs by plan
        plan_stmt = (
            select(Organization.plan, func.count().label("cnt"))
            .group_by(Organization.plan)
        )
        plan_rows = (await uow.session.execute(plan_stmt)).all()

    return ApiResponse(data={
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
        "registrations_timeline": [
            {"date": str(r.day)[:10], "count": r.cnt} for r in reg_rows
        ],
        "orgs_by_plan": [
            {"plan": str(r.plan.value if hasattr(r.plan, "value") else r.plan), "count": r.cnt}
            for r in plan_rows
        ],
    })


@router.get("/orgs", response_model=ApiResponse[list])
async def superadmin_orgs(
    limit: int = 50,
    offset: int = 0,
    payload: dict = Depends(SuperadminDep),
):
    """List all organizations with stats."""
    from src.modules.org.models import Organization, Membership
    from src.modules.tables.models import Table
    from src.modules.tables.records import Record

    async with UnitOfWork() as uow:
        stmt = select(Organization).order_by(Organization.created_at.desc()).limit(limit).offset(offset)
        orgs = list((await uow.session.execute(stmt)).scalars().all())

        result = []
        for org in orgs:
            mem_cnt = (await uow.session.execute(
                select(func.count()).select_from(Membership).where(Membership.org_id == org.id)
            )).scalar() or 0
            tbl_cnt = (await uow.session.execute(
                select(func.count()).select_from(Table).where(Table.org_id == org.id)
            )).scalar() or 0
            rec_cnt = (await uow.session.execute(
                select(func.count()).select_from(Record).where(Record.org_id == org.id)
            )).scalar() or 0
            result.append({
                "id": str(org.id),
                "name": org.name,
                "slug": org.slug,
                "plan": org.plan.value if hasattr(org.plan, "value") else str(org.plan),
                "created_at": org.created_at.isoformat() if org.created_at else None,
                "members": mem_cnt,
                "tables": tbl_cnt,
                "records": rec_cnt,
            })

    return ApiResponse(data=result)


@router.get("/users", response_model=ApiResponse[list])
async def superadmin_users(
    limit: int = 50,
    offset: int = 0,
    payload: dict = Depends(SuperadminDep),
):
    """List all users."""
    from src.modules.auth.models import User
    from src.modules.org.models import Membership

    async with UnitOfWork() as uow:
        stmt = select(User).order_by(User.created_at.desc()).limit(limit).offset(offset)
        users = list((await uow.session.execute(stmt)).scalars().all())
        result = []
        for u in users:
            orgs = [
                {"org_id": str(m.org_id), "role": m.role.value if hasattr(m.role, "value") else str(m.role)}
                for m in u.memberships
            ]
            result.append({
                "id": str(u.id),
                "email": u.email,
                "first_name": u.first_name,
                "last_name": u.last_name,
                "is_active": u.is_active,
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "orgs": orgs,
            })
    return ApiResponse(data=result)


@router.get("/tables", response_model=ApiResponse[list])
async def superadmin_tables(
    limit: int = 50,
    offset: int = 0,
    payload: dict = Depends(SuperadminDep),
):
    """List all tables across all orgs."""
    from src.modules.tables.models import Table
    from src.modules.tables.records import Record

    async with UnitOfWork() as uow:
        stmt = select(Table).order_by(Table.created_at.desc()).limit(limit).offset(offset)
        tables = list((await uow.session.execute(stmt)).scalars().all())
        result = []
        for t in tables:
            rec_cnt = (await uow.session.execute(
                select(func.count()).select_from(Record).where(Record.table_id == t.id)
            )).scalar() or 0
            result.append({
                "id": str(t.id),
                "name": t.name,
                "org_id": str(t.org_id),
                "columns": len(t.columns) if t.columns else 0,
                "records": rec_cnt,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            })
    return ApiResponse(data=result)


@router.get("/ai-usage", response_model=ApiResponse[list])
async def superadmin_ai_usage(payload: dict = Depends(SuperadminDep)):
    """AI usage stats per org."""
    from src.modules.ai.routes import AIUsageLog
    from src.modules.org.models import Organization

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

        # Get org names
        org_ids = [r.org_id for r in rows]
        orgs_map: dict = {}
        if org_ids:
            orgs = list((await uow.session.execute(
                select(Organization).where(Organization.id.in_(org_ids))
            )).scalars().all())
            orgs_map = {o.id: o.name for o in orgs}

    return ApiResponse(data=[
        {
            "org_id": str(r.org_id),
            "org_name": orgs_map.get(r.org_id, "—"),
            "requests": r.requests,
            "tokens": r.tokens,
        }
        for r in rows
    ])


@router.patch("/orgs/{org_id}/plan", response_model=ApiResponse[dict])
async def superadmin_set_plan(
    org_id: str,
    body: dict,
    payload: dict = Depends(SuperadminDep),
):
    """Change org plan."""
    from src.modules.org.models import Organization
    from src.common.enums import PlanTier

    plan_name = body.get("plan", "free")
    try:
        plan_tier = PlanTier(plan_name)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_PLAN", "message": f"Неверный тариф: {plan_name}"})

    async with UnitOfWork() as uow:
        org = (await uow.session.execute(
            select(Organization).where(Organization.id == uuid.UUID(org_id))
        )).scalar_one_or_none()
        if not org:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Организация не найдена"})
        org.plan = plan_tier
        await uow.commit()

    return ApiResponse(data={"org_id": org_id, "plan": plan_name})
