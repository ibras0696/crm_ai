from fastapi import APIRouter, Depends, Request

from src.common.schemas import ApiResponse
from src.modules.auth.dependencies import CurrentUser, get_current_user
from src.modules.auth.schemas import (
    LoginRequest,
    RefreshRequest,
    RegisterRequest,
    TokenResponse,
    UserResponse,
)
from src.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

_auth_service = AuthService()


@router.post("/register", response_model=ApiResponse[TokenResponse], status_code=201)
async def register(body: RegisterRequest, request: Request):
    ip = request.client.host if request.client else None
    user, org, tokens = await _auth_service.register(body, ip_address=ip)
    return ApiResponse(data=tokens)


@router.post("/login", response_model=ApiResponse[TokenResponse])
async def login(body: LoginRequest, request: Request):
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    user, tokens = await _auth_service.login(body.email, body.password, ip_address=ip, user_agent=ua)
    return ApiResponse(data=tokens)


@router.post("/refresh", response_model=ApiResponse[TokenResponse])
async def refresh(body: RefreshRequest, request: Request):
    ip = request.client.host if request.client else None
    tokens = await _auth_service.refresh(body.refresh_token, ip_address=ip)
    return ApiResponse(data=tokens)


@router.post("/logout", response_model=ApiResponse)
async def logout(body: RefreshRequest):
    await _auth_service.logout(body.refresh_token)
    return ApiResponse(data=None)


@router.get("/me", response_model=ApiResponse[UserResponse])
async def me(current_user: CurrentUser = Depends(get_current_user)):
    from src.infrastructure.uow import UnitOfWork
    from src.modules.auth.repository import UserRepository

    async with UnitOfWork() as uow:
        repo = UserRepository(uow.session)
        user = await repo.get_by_id(current_user.user_id)
    if not user:
        from src.common.exceptions import NotFoundError
        raise NotFoundError("User")
    return ApiResponse(data=UserResponse.model_validate(user))
