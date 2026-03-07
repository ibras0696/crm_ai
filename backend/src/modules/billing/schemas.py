from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel


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


class CreatePaymentRequest(BaseModel):
    plan_name: str
    period: Literal["monthly"] = "monthly"


class TokenBalanceOut(BaseModel):
    org_id: str
    cycle_key: str
    plan_tokens_monthly_quota: int
    plan_tokens_remaining: int
    addon_tokens_remaining: int
    total_tokens_remaining: int


class TokenPackageOut(BaseModel):
    code: str
    display_name: str
    badge_text: str | None = None
    description: str | None = None
    button_text: str | None = None
    payment_note: str | None = None
    price_caption: str | None = None
    tokens: int
    price_rub_cents: int


class PurchaseTokensRequest(BaseModel):
    package_code: str


class PaymentStatusOut(BaseModel):
    payment_id: str
    status: str
    paid: bool
    amount_value: str | None = None
    amount_currency: str | None = None
    description: str | None = None
    confirmation_url: str | None = None
    created_at: str | None = None
    metadata: dict[str, str] | None = None
