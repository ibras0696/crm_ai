"""Billing HTTP routes."""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.billing.schemas import CreatePaymentRequest, PlanOut, UsageOut
from src.modules.billing.service import BillingOperationError, BillingService

router = APIRouter(prefix="/billing", tags=["billing"])
logger = logging.getLogger("billing")

_billing_service = BillingService()


@router.get("/plans", response_model=ApiResponse[list[PlanOut]])
async def list_plans(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    plans = await _billing_service.list_plans()
    return ApiResponse(data=[PlanOut.model_validate(p) for p in plans])


@router.get("/usage", response_model=ApiResponse[UsageOut])
async def current_usage(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    usage = await _billing_service.get_usage(org_id=current_user.org_id)
    return ApiResponse(data=usage)


@router.post("/create-payment", response_model=ApiResponse[dict])
async def create_yookassa_payment(
    body: CreatePaymentRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER)),
):
    """Create YooKassa payment for plan upgrade."""
    try:
        data = await _billing_service.create_payment(
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            plan_name=body.plan_name,
            period=body.period,
        )
        return ApiResponse(data=data)
    except BillingOperationError as exc:
        return ApiResponse(ok=False, data=None, error={"code": exc.code, "message": exc.message})


@router.get("/subscription", response_model=ApiResponse[dict])
async def get_subscription(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    """Get current organization subscription."""
    data = await _billing_service.get_subscription(org_id=current_user.org_id)
    return ApiResponse(data=data)


@router.post("/webhook/yookassa", include_in_schema=False)
async def yookassa_webhook(request: Request):
    """Handle YooKassa payment notifications."""
    try:
        body = await request.json()
        await _billing_service.handle_yookassa_webhook(body)
        return {"status": "ok"}
    except Exception as exc:
        logger.error("Webhook error: %s", exc)
        raise HTTPException(status_code=400, detail="Invalid webhook payload") from exc


@router.post("/cancel-subscription", response_model=ApiResponse)
async def cancel_subscription(current_user: CurrentUser = Depends(require_roles(UserRole.OWNER))):
    """Downgrade org to free plan immediately."""
    data = await _billing_service.cancel_subscription(org_id=current_user.org_id)
    return ApiResponse(data=data)

