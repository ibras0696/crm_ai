from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.schemas import ApiResponse
from src.infrastructure.database import get_async_session
from src.modules.auth.dependencies import CurrentUser, get_current_user

from .repository import AppearanceRepository
from .schemas import AppearanceRead, AppearanceUpdate

router = APIRouter(prefix="/appearance", tags=["appearance"])

_repo = AppearanceRepository()

_DEFAULTS = AppearanceRead(
    mode="dark",
    accent="teal",
    custom_enabled=False,
    primary_h=174.0,
    primary_s=80.0,
    primary_l=39.0,
    radius=0.5,
)


@router.get("", response_model=ApiResponse[AppearanceRead])
async def get_appearance(
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
) -> ApiResponse[AppearanceRead]:
    row = await _repo.get(session, current_user.user_id)
    data = AppearanceRead.model_validate(row) if row else _DEFAULTS
    return ApiResponse(ok=True, data=data)


@router.put("", response_model=ApiResponse[AppearanceRead])
async def update_appearance(
    body: AppearanceUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_async_session),
) -> ApiResponse[AppearanceRead]:
    patch = body.model_dump(exclude_none=True)
    row = await _repo.upsert(session, current_user.user_id, patch)
    await session.commit()
    return ApiResponse(ok=True, data=AppearanceRead.model_validate(row))
