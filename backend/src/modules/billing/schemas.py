from __future__ import annotations

import uuid

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
    period: str = "monthly"  # monthly | yearly

