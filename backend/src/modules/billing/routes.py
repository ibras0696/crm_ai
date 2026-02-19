"""Billing: plans listing, usage, YooKassa payment integration."""
import uuid
from datetime import datetime

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import func, select

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.dependencies import CurrentUser, require_org, require_roles
from src.modules.billing.models import Plan
from src.modules.files.models import File
from src.modules.tables.models import Table
from src.modules.tables.records import Record

router = APIRouter(prefix="/billing", tags=["billing"])


class PlanOut(BaseModel):
    id: uuid.UUID
    name: str
    display_name: str
    price_monthly: int
    price_yearly: int
    max_members: int
    max_tables: int
    max_records: int
    max_storage_mb: int
    has_ai: bool
    features: dict | None
    model_config = {"from_attributes": True}


class UsageOut(BaseModel):
    members: int
    tables: int
    records: int
    files: int
    storage_bytes: int


@router.get("/plans", response_model=ApiResponse[list[PlanOut]])
async def list_plans(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    async with UnitOfWork() as uow:
        stmt = select(Plan).where(Plan.is_active.is_(True)).order_by(Plan.price_monthly)
        result = await uow.session.execute(stmt)
        plans = list(result.scalars().all())
        items = [PlanOut.model_validate(p) for p in plans]
    return ApiResponse(data=items)


@router.get("/usage", response_model=ApiResponse[UsageOut])
async def current_usage(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    from src.modules.org.models import Membership

    async with UnitOfWork() as uow:
        mem_cnt = await uow.session.execute(
            select(func.count()).select_from(Membership).where(Membership.org_id == current_user.org_id)
        )
        tbl_cnt = await uow.session.execute(
            select(func.count()).select_from(Table).where(Table.org_id == current_user.org_id)
        )
        rec_cnt = await uow.session.execute(
            select(func.count()).select_from(Record).where(Record.org_id == current_user.org_id)
        )
        file_stmt = (
            select(func.count(), func.coalesce(func.sum(File.size), 0))
            .select_from(File)
            .where(File.org_id == current_user.org_id)
        )
        file_result = await uow.session.execute(file_stmt)
        file_row = file_result.one()

        usage = UsageOut(
            members=mem_cnt.scalar() or 0,
            tables=tbl_cnt.scalar() or 0,
            records=rec_cnt.scalar() or 0,
            files=file_row[0] or 0,
            storage_bytes=file_row[1] or 0,
        )
    return ApiResponse(data=usage)


class CreatePaymentRequest(BaseModel):
    plan_name: str
    period: str = "monthly"  # monthly | yearly


@router.post("/create-payment", response_model=ApiResponse[dict])
async def create_yookassa_payment(
    body: CreatePaymentRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER)),
):
    """Create YooKassa payment for plan upgrade."""
    if body.period not in {"monthly", "yearly"}:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_PERIOD", "message": "period должен быть monthly или yearly"})

    if not settings.YOOKASSA_SHOP_ID or not settings.YOOKASSA_SECRET_KEY:
        return ApiResponse(
            ok=False,
            data=None,
            error={
                "code": "BILLING_NOT_CONFIGURED",
                "message": "Платежный шлюз не настроен. Добавьте YOOKASSA_SHOP_ID и YOOKASSA_SECRET_KEY в .env",
            },
        )

    async with UnitOfWork() as uow:
        stmt = select(Plan).where(Plan.name == body.plan_name, Plan.is_active.is_(True))
        result = await uow.session.execute(stmt)
        plan = result.scalar_one_or_none()

    if not plan:
        return ApiResponse(ok=False, data=None, error={"code": "PLAN_NOT_FOUND", "message": f"Тариф '{body.plan_name}' не найден"})

    amount = plan.price_yearly if body.period == "yearly" else plan.price_monthly
    if amount == 0:
        return ApiResponse(ok=False, data=None, error={"code": "FREE_PLAN", "message": "Этот тариф бесплатный"})

    idempotency_key = str(uuid.uuid4())
    payload = {
        "amount": {"value": f"{amount / 100:.2f}", "currency": "RUB"},
        "confirmation": {"type": "redirect", "return_url": settings.YOOKASSA_RETURN_URL},
        "capture": True,
        "description": f"Тариф {plan.display_name} ({body.period})",
        "metadata": {
            "org_id": str(current_user.org_id),
            "user_id": str(current_user.user_id),
            "plan_name": body.plan_name,
            "period": body.period,
        },
    }

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.yookassa.ru/v3/payments",
                json=payload,
                auth=(settings.YOOKASSA_SHOP_ID, settings.YOOKASSA_SECRET_KEY),
                headers={"Idempotence-Key": idempotency_key, "Content-Type": "application/json"},
            )
            resp.raise_for_status()
            data = resp.json()
            confirmation_url = data.get("confirmation", {}).get("confirmation_url", "")
            return ApiResponse(
                data={
                    "payment_id": data.get("id"),
                    "status": data.get("status"),
                    "confirmation_url": confirmation_url,
                    "amount": amount,
                    "plan": plan.display_name,
                }
            )
    except httpx.HTTPStatusError as e:
        return ApiResponse(ok=False, data=None, error={"code": "PAYMENT_ERROR", "message": f"Ошибка платежного шлюза: {e.response.status_code}"})
    except Exception as e:
        return ApiResponse(ok=False, data=None, error={"code": "PAYMENT_ERROR", "message": str(e)})


@router.get("/subscription", response_model=ApiResponse[dict])
async def get_subscription(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    """Get current org subscription."""
    from src.modules.org.models import Subscription

    async with UnitOfWork() as uow:
        stmt = select(Subscription).where(Subscription.org_id == current_user.org_id)
        sub = (await uow.session.execute(stmt)).scalar_one_or_none()
        if not sub:
            return ApiResponse(data={"plan": "free", "status": "active", "current_period_start": None, "current_period_end": None})
        return ApiResponse(
            data={
                "plan": sub.plan.value if sub.plan else "free",
                "status": sub.status.value if sub.status else "active",
                "current_period_start": sub.current_period_start.isoformat() if sub.current_period_start else None,
                "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
                "external_id": sub.external_id,
            }
        )


@router.post("/webhook/yookassa", include_in_schema=False)
async def yookassa_webhook(request: Request):
    """Handle YooKassa payment notifications."""
    import logging
    from datetime import timedelta, timezone as tz

    from src.common.enums import PlanTier, SubscriptionStatus
    from src.modules.org.models import Organization, Subscription

    logger = logging.getLogger("billing")
    try:
        body = await request.json()
        event = body.get("event", "")
        obj = body.get("object", {})

        if event == "payment.succeeded":
            metadata = obj.get("metadata", {})
            org_id = metadata.get("org_id")
            plan_name = metadata.get("plan_name")
            period = metadata.get("period", "monthly")
            payment_id = obj.get("id")

            if org_id and plan_name:
                plan_map = {"free": PlanTier.FREE, "team": PlanTier.TEAM, "business": PlanTier.BUSINESS}
                plan_tier = plan_map.get(plan_name, PlanTier.FREE)
                now = datetime.now(tz.utc)
                period_end = now + (timedelta(days=365) if period == "yearly" else timedelta(days=30))

                async with UnitOfWork() as uow:
                    org_uuid = uuid.UUID(org_id)
                    stmt = select(Subscription).where(Subscription.org_id == org_uuid)
                    sub = (await uow.session.execute(stmt)).scalar_one_or_none()
                    if sub:
                        sub.plan = plan_tier
                        sub.status = SubscriptionStatus.ACTIVE
                        sub.current_period_start = now
                        sub.current_period_end = period_end
                        sub.external_id = payment_id
                    else:
                        sub = Subscription(
                            org_id=org_uuid,
                            plan=plan_tier,
                            status=SubscriptionStatus.ACTIVE,
                            current_period_start=now,
                            current_period_end=period_end,
                            external_id=payment_id,
                        )
                        uow.session.add(sub)

                    org_stmt = select(Organization).where(Organization.id == org_uuid)
                    org = (await uow.session.execute(org_stmt)).scalar_one_or_none()
                    if org:
                        org.plan = plan_tier

                    await uow.commit()
                logger.info("Payment succeeded: org=%s plan=%s period=%s", org_id, plan_name, period)

        return {"status": "ok"}
    except Exception as e:
        logger.error("Webhook error: %s", e)
        raise HTTPException(status_code=400, detail="Invalid webhook payload")


@router.post("/cancel-subscription", response_model=ApiResponse)
async def cancel_subscription(current_user: CurrentUser = Depends(require_roles(UserRole.OWNER))):
    """Downgrade org to free plan immediately."""
    from src.common.enums import PlanTier, SubscriptionStatus
    from src.modules.org.models import Organization, Subscription

    async with UnitOfWork() as uow:
        stmt = select(Subscription).where(Subscription.org_id == current_user.org_id)
        sub = (await uow.session.execute(stmt)).scalar_one_or_none()

        if sub:
            sub.plan = PlanTier.FREE
            sub.status = SubscriptionStatus.CANCELLED
            sub.current_period_end = None
            sub.external_id = None
        else:
            sub = Subscription(
                org_id=current_user.org_id,
                plan=PlanTier.FREE,
                status=SubscriptionStatus.CANCELLED,
            )
            uow.session.add(sub)

        org_stmt = select(Organization).where(Organization.id == current_user.org_id)
        org = (await uow.session.execute(org_stmt)).scalar_one_or_none()
        if org:
            org.plan = PlanTier.FREE

        await uow.commit()

    return ApiResponse(data={"plan": "free", "status": "cancelled"})
