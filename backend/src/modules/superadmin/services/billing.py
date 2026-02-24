from __future__ import annotations

from sqlalchemy import select

from src.infrastructure.uow import UnitOfWork
from src.modules.billing.models import Plan, TokenPackage


class SuperadminBillingService:
    async def billing_config(self) -> dict:
        async with UnitOfWork() as uow:
            plans = (
                await uow.session.execute(select(Plan).order_by(Plan.price_monthly.asc(), Plan.name.asc()))
            ).scalars().all()
            packages = (
                await uow.session.execute(
                    select(TokenPackage).order_by(TokenPackage.sort_order.asc(), TokenPackage.created_at.asc())
                )
            ).scalars().all()
        return {
            "plans": [
                {
                    "name": p.name,
                    "display_name": p.display_name,
                    "price_monthly": int(p.price_monthly),
                    "price_yearly": int(p.price_yearly),
                    "max_members": int(p.max_members),
                    "max_tables": int(p.max_tables),
                    "max_records": int(p.max_records),
                    "max_storage_mb": int(p.max_storage_mb),
                    "has_ai": bool(p.has_ai),
                    "ai_max_tokens_per_request": int(p.ai_max_tokens_per_request),
                    "ai_tokens_per_day": int(p.ai_tokens_per_day),
                    "ai_rpm_per_user": int(p.ai_rpm_per_user),
                    "is_active": bool(p.is_active),
                }
                for p in plans
            ],
            "token_packages": [
                {
                    "code": t.code,
                    "display_name": t.display_name,
                    "tokens": int(t.tokens),
                    "price_rub_cents": int(t.price_rub_cents),
                    "is_active": bool(t.is_active),
                    "sort_order": int(t.sort_order),
                }
                for t in packages
            ],
        }

    async def update_plan(self, *, plan_name: str, payload: dict) -> dict:
        async with UnitOfWork() as uow:
            plan = (await uow.session.execute(select(Plan).where(Plan.name == plan_name))).scalars().first()
            if plan is None:
                raise LookupError("PLAN_NOT_FOUND")

            for field in [
                "display_name",
                "price_monthly",
                "price_yearly",
                "max_members",
                "max_tables",
                "max_records",
                "max_storage_mb",
                "has_ai",
                "ai_max_tokens_per_request",
                "ai_tokens_per_day",
                "ai_rpm_per_user",
                "is_active",
            ]:
                if field in payload and payload[field] is not None:
                    setattr(plan, field, payload[field])

            await uow.commit()
            return {
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
                "is_active": bool(plan.is_active),
            }

    async def upsert_token_package(self, *, code: str, payload: dict) -> dict:
        async with UnitOfWork() as uow:
            package = (await uow.session.execute(select(TokenPackage).where(TokenPackage.code == code))).scalars().first()
            created = False
            if package is None:
                created = True
                package = TokenPackage(
                    code=code,
                    display_name=payload.get("display_name") or code,
                    tokens=int(payload.get("tokens") or 0),
                    price_rub_cents=int(payload.get("price_rub_cents") or 0),
                    is_active=bool(payload.get("is_active", True)),
                    sort_order=int(payload.get("sort_order") or 100),
                )
                uow.session.add(package)
            else:
                for field in ["display_name", "tokens", "price_rub_cents", "is_active", "sort_order"]:
                    if field in payload and payload[field] is not None:
                        setattr(package, field, payload[field])
            await uow.commit()
            return {
                "created": created,
                "code": package.code,
                "display_name": package.display_name,
                "tokens": int(package.tokens),
                "price_rub_cents": int(package.price_rub_cents),
                "is_active": bool(package.is_active),
                "sort_order": int(package.sort_order),
            }
