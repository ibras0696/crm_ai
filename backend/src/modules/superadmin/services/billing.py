from __future__ import annotations

from datetime import UTC, datetime

import httpx
from sqlalchemy import select

from src.common.runtime_secret import decrypt_runtime_secret, encrypt_runtime_secret
from src.infrastructure.uow import UnitOfWork
from src.modules.billing.models import (
    BillingRuntimeAudit,
    BillingRuntimeSecret,
    BillingRuntimeSettings,
    Plan,
    TokenPackage,
    TokenPurchase,
)
from src.modules.billing.runtime_config import resolve_yookassa_runtime_config, yookassa_secret_mask
from src.modules.org.models import Organization


class SuperadminBillingService:
    @staticmethod
    def _serialize_plan(plan: Plan) -> dict:
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

    @staticmethod
    def _serialize_token_package(package: TokenPackage) -> dict:
        return {
            "code": package.code,
            "display_name": package.display_name,
            "tokens": int(package.tokens),
            "price_rub_cents": int(package.price_rub_cents),
            "is_active": bool(package.is_active),
            "sort_order": int(package.sort_order),
        }

    @staticmethod
    def _purchase_status(*, purchase: TokenPurchase, now_utc: datetime) -> str:
        if not purchase.is_active:
            return "inactive"
        if purchase.expires_at and purchase.expires_at <= now_utc:
            return "expired"
        if int(purchase.tokens_remaining or 0) <= 0:
            return "exhausted"
        return "active"

    @staticmethod
    def _serialize_purchase(*, purchase: TokenPurchase, org_name: str, now_utc: datetime) -> dict:
        meta = purchase.meta or {}
        payment_status = str(meta.get("payment_status") or meta.get("status") or "").strip() or None
        return {
            "id": str(purchase.id),
            "org_id": str(purchase.org_id),
            "org_name": org_name or "—",
            "package_code": purchase.package_code,
            "tokens_total": int(purchase.tokens_total),
            "tokens_remaining": int(purchase.tokens_remaining),
            "payment_id": purchase.payment_id,
            "payment_status": payment_status,
            "status": SuperadminBillingService._purchase_status(purchase=purchase, now_utc=now_utc),
            "is_active": bool(purchase.is_active),
            "created_at": purchase.created_at.isoformat() if purchase.created_at else None,
            "expires_at": purchase.expires_at.isoformat() if purchase.expires_at else None,
        }

    async def get_yookassa_config(self) -> dict:
        async with UnitOfWork() as uow:
            resolved = await resolve_yookassa_runtime_config(uow.session)
            audits = (
                await uow.session.execute(
                    select(BillingRuntimeAudit).order_by(BillingRuntimeAudit.created_at.desc()).limit(20)
                )
            ).scalars().all()

        return {
            "shop_id": resolved.shop_id,
            "return_url": resolved.return_url,
            "webhook_url": resolved.webhook_url,
            "secret_key_configured": bool(resolved.secret_key),
            "secret_key_masked": yookassa_secret_mask(resolved.secret_key),
            "audit": [
                {
                    "id": str(item.id),
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                    "actor": item.actor,
                    "ip_address": item.ip_address,
                    "changed_fields": item.changed_fields or [],
                    "meta": item.meta or {},
                }
                for item in audits
            ],
        }

    async def billing_config(self) -> dict:
        now_utc = datetime.now(UTC)
        async with UnitOfWork() as uow:
            plans = (
                await uow.session.execute(select(Plan).order_by(Plan.price_monthly.asc(), Plan.name.asc()))
            ).scalars().all()
            packages = (
                await uow.session.execute(
                    select(TokenPackage).order_by(TokenPackage.sort_order.asc(), TokenPackage.created_at.asc())
                )
            ).scalars().all()
            purchases = (
                await uow.session.execute(
                    select(TokenPurchase, Organization.name)
                    .outerjoin(Organization, Organization.id == TokenPurchase.org_id)
                    .order_by(TokenPurchase.created_at.desc())
                    .limit(50)
                )
            ).all()

        return {
            "plans": [self._serialize_plan(p) for p in plans],
            "token_packages": [self._serialize_token_package(t) for t in packages],
            "recent_purchases": [
                self._serialize_purchase(
                    purchase=row[0],
                    org_name=str(row[1] or ""),
                    now_utc=now_utc,
                )
                for row in purchases
            ],
            "yookassa": await self.get_yookassa_config(),
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
            return self._serialize_plan(plan)

    async def upsert_token_package(self, *, code: str, payload: dict) -> dict:
        async with UnitOfWork() as uow:
            package = (
                await uow.session.execute(select(TokenPackage).where(TokenPackage.code == code))
            ).scalars().first()
            created = False
            if package is None:
                if payload.get("tokens") is None:
                    raise ValueError("TOKENS_REQUIRED")
                if payload.get("price_rub_cents") is None:
                    raise ValueError("PRICE_REQUIRED")
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
            out = self._serialize_token_package(package)
            out["created"] = created
            return out

    async def delete_token_package(self, *, code: str) -> dict:
        async with UnitOfWork() as uow:
            package = (
                await uow.session.execute(select(TokenPackage).where(TokenPackage.code == code))
            ).scalars().first()
            if package is None:
                raise LookupError("TOKEN_PACKAGE_NOT_FOUND")
            package.is_active = False
            await uow.commit()
            return self._serialize_token_package(package)

    async def update_yookassa(
        self,
        payload: dict,
        *,
        changed_by: str,
        ip_address: str | None = None,
    ) -> dict:
        allowed = {
            "yookassa_shop_id",
            "yookassa_secret_key",
            "yookassa_return_url",
            "yookassa_webhook_url",
        }
        updates = {k: v for k, v in payload.items() if k in allowed and v is not None}
        changed_fields: list[str] = []
        old_values: dict[str, object] = {}
        new_values: dict[str, object] = {}

        async with UnitOfWork() as uow:
            settings_row = (await uow.session.execute(select(BillingRuntimeSettings).limit(1))).scalars().first()
            if settings_row is None:
                settings_row = BillingRuntimeSettings()
                uow.session.add(settings_row)
                await uow.session.flush()

            secret_row = (await uow.session.execute(select(BillingRuntimeSecret).limit(1))).scalars().first()
            if secret_row is None:
                secret_row = BillingRuntimeSecret()
                uow.session.add(secret_row)
                await uow.session.flush()

            if "yookassa_shop_id" in updates:
                old_values["yookassa_shop_id"] = settings_row.yookassa_shop_id
                settings_row.yookassa_shop_id = str(updates["yookassa_shop_id"]).strip()
                new_values["yookassa_shop_id"] = settings_row.yookassa_shop_id
                changed_fields.append("yookassa_shop_id")

            if "yookassa_return_url" in updates:
                old_values["yookassa_return_url"] = settings_row.yookassa_return_url
                settings_row.yookassa_return_url = str(updates["yookassa_return_url"]).strip()
                new_values["yookassa_return_url"] = settings_row.yookassa_return_url
                changed_fields.append("yookassa_return_url")

            if "yookassa_webhook_url" in updates:
                old_values["yookassa_webhook_url"] = settings_row.yookassa_webhook_url
                settings_row.yookassa_webhook_url = str(updates["yookassa_webhook_url"]).strip()
                new_values["yookassa_webhook_url"] = settings_row.yookassa_webhook_url
                changed_fields.append("yookassa_webhook_url")

            if "yookassa_secret_key" in updates:
                incoming = str(updates["yookassa_secret_key"] or "").strip()
                old_plain = decrypt_runtime_secret(secret_row.yookassa_secret_key_encrypted)
                old_values["yookassa_secret_key_masked"] = yookassa_secret_mask(old_plain) if old_plain else ""
                if incoming:
                    secret_row.yookassa_secret_key_encrypted = encrypt_runtime_secret(incoming)
                    new_values["yookassa_secret_key_masked"] = yookassa_secret_mask(incoming)
                else:
                    secret_row.yookassa_secret_key_encrypted = ""
                    new_values["yookassa_secret_key_masked"] = ""
                changed_fields.append("yookassa_secret_key")

            if changed_fields:
                uow.session.add(
                    BillingRuntimeAudit(
                        actor=(changed_by or "superadmin").strip() or "superadmin",
                        ip_address=(ip_address or "").strip() or None,
                        changed_fields=changed_fields,
                        meta={"old": old_values, "new": new_values},
                    )
                )

            await uow.commit()

        return await self.get_yookassa_config()

    async def test_yookassa_connection(self) -> dict:
        async with UnitOfWork() as uow:
            resolved = await resolve_yookassa_runtime_config(uow.session)

        if not resolved.shop_id or not resolved.secret_key:
            raise ValueError("YOOKASSA_NOT_CONFIGURED")

        try:
            async with httpx.AsyncClient(timeout=12) as client:
                response = await client.get(
                    "https://api.yookassa.ru/v3/me",
                    auth=(resolved.shop_id, resolved.secret_key),
                )
                response.raise_for_status()
                data = response.json()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(f"YOOKASSA_HTTP_{exc.response.status_code}") from exc
        except (httpx.RequestError, httpx.TimeoutException) as exc:
            raise RuntimeError("YOOKASSA_UNAVAILABLE") from exc

        return {
            "connected": True,
            "status_code": response.status_code,
            "account_id": str(data.get("account_id") or ""),
            "test": bool(data.get("test", False)),
        }
