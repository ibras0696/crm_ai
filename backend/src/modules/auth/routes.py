from fastapi import APIRouter, Depends, Request, Response

from src.common.exceptions import BadRequestError, NotFoundError, UnauthorizedError
from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.cache import CacheService
from src.infrastructure.redis_client import redis_client
from src.modules.auth.dependencies import CurrentUser, get_current_user
from src.modules.auth.schemas import (
    ForgotPasswordRequest,
    LoginRequest,
    RefreshRequest,
    RegisterConfirmRequest,
    RegisterRequest,
    ResetPasswordRequest,
    TokenResponse,
    UpdateMeRequest,
    UserResponse,
)
from src.modules.auth.service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])

_auth_service = AuthService()


def _set_auth_cookies(response: Response, tokens: TokenResponse, *, remember_me: bool = False) -> None:
    secure = bool(settings.AUTH_COOKIE_SECURE)
    samesite = settings.AUTH_COOKIE_SAMESITE
    domain = settings.AUTH_COOKIE_DOMAIN or None
    path = settings.AUTH_COOKIE_PATH or "/"
    refresh_days = (
        int(settings.REFRESH_TOKEN_REMEMBER_ME_EXPIRE_DAYS)
        if remember_me
        else int(settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )

    response.set_cookie(
        key=settings.AUTH_ACCESS_COOKIE_NAME,
        value=tokens.access_token,
        httponly=True,
        secure=secure,
        samesite=samesite,  # type: ignore[arg-type]
        max_age=int(settings.ACCESS_TOKEN_EXPIRE_MINUTES) * 60,
        path=path,
        domain=domain,
    )
    response.set_cookie(
        key=settings.AUTH_REFRESH_COOKIE_NAME,
        value=tokens.refresh_token,
        httponly=True,
        secure=secure,
        samesite=samesite,  # type: ignore[arg-type]
        max_age=refresh_days * 24 * 3600,
        path=path,
        domain=domain,
    )


def _clear_auth_cookies(response: Response) -> None:
    domain = settings.AUTH_COOKIE_DOMAIN or None
    path = settings.AUTH_COOKIE_PATH or "/"
    response.delete_cookie(settings.AUTH_ACCESS_COOKIE_NAME, path=path, domain=domain)
    response.delete_cookie(settings.AUTH_REFRESH_COOKIE_NAME, path=path, domain=domain)


@router.post("/register", response_model=ApiResponse[TokenResponse], status_code=201)
async def register(body: RegisterRequest, request: Request, response: Response):
    ip = request.client.host if request.client else None
    accept_language = request.headers.get("accept-language")
    _, _, tokens = await _auth_service.register(body, ip_address=ip, accept_language=accept_language)
    _set_auth_cookies(response, tokens)
    return ApiResponse(data=tokens)


@router.post("/register/request", response_model=ApiResponse, status_code=202)
async def request_registration_confirmation(body: RegisterRequest, request: Request):
    ip = request.client.host if request.client else None
    accept_language = request.headers.get("accept-language")
    await _auth_service.request_registration_confirmation(body, ip_address=ip, accept_language=accept_language)
    return ApiResponse(data=None)


@router.post("/register/confirm", response_model=ApiResponse[TokenResponse], status_code=201)
async def confirm_registration(body: RegisterConfirmRequest, request: Request, response: Response):
    ip = request.client.host if request.client else None
    accept_language = request.headers.get("accept-language")
    _, _, tokens = await _auth_service.confirm_registration(
        token=body.token, ip_address=ip, accept_language=accept_language
    )
    _set_auth_cookies(response, tokens)
    return ApiResponse(data=tokens)


@router.post("/login", response_model=ApiResponse[TokenResponse])
async def login(body: LoginRequest, request: Request, response: Response):
    ip = request.client.host if request.client else None
    ua = request.headers.get("user-agent")
    _, tokens = await _auth_service.login(body.email, body.password, ip_address=ip, user_agent=ua)
    _set_auth_cookies(response, tokens, remember_me=bool(body.remember_me))
    return ApiResponse(data=tokens)


@router.post("/refresh", response_model=ApiResponse[TokenResponse])
async def refresh(request: Request, response: Response, body: RefreshRequest | None = None):
    raw_refresh = (body.refresh_token if body else None) or request.cookies.get(settings.AUTH_REFRESH_COOKIE_NAME)
    if not raw_refresh:
        raise UnauthorizedError("Missing refresh token")
    ip = request.client.host if request.client else None
    tokens = await _auth_service.refresh(raw_refresh, ip_address=ip)
    _set_auth_cookies(response, tokens)
    return ApiResponse(data=tokens)


@router.post("/logout", response_model=ApiResponse)
async def logout(request: Request, response: Response, body: RefreshRequest | None = None):
    raw_refresh = (body.refresh_token if body else None) or request.cookies.get(settings.AUTH_REFRESH_COOKIE_NAME)
    if raw_refresh:
        await _auth_service.logout(raw_refresh)
    _clear_auth_cookies(response)
    return ApiResponse(data=None)


@router.get("/me", response_model=ApiResponse[UserResponse])
async def me(current_user: CurrentUser = Depends(get_current_user)):
    cache = CacheService(redis_client)
    cache_key = f"user_profile:{current_user.user_id}"
    cached = await cache.get(cache_key)
    if cached:
        if isinstance(cached, dict) and "locale" not in cached:
            cached["locale"] = "ru"
        return ApiResponse(data=cached)

    user = await _auth_service.get_user(current_user.user_id)
    if not user:
        raise NotFoundError("User")

    response_data = UserResponse.model_validate(user).model_dump(mode="json")
    response_data.setdefault("locale", "ru")
    await cache.set(cache_key, response_data, ttl=300)
    return ApiResponse(data=response_data)


@router.patch("/me", response_model=ApiResponse[UserResponse])
async def update_me(body: UpdateMeRequest, current_user: CurrentUser = Depends(get_current_user)):
    user = await _auth_service.update_user(current_user.user_id, body)
    if not user:
        raise NotFoundError("User")

    cache = CacheService(redis_client)
    cache_key = f"user_profile:{current_user.user_id}"
    await cache.delete(cache_key)

    return ApiResponse(data=UserResponse.model_validate(user))


@router.post("/forgot-password", response_model=ApiResponse)
async def forgot_password(body: ForgotPasswordRequest):
    # Always return success to prevent user enum
    await _auth_service.request_password_reset(body.email)
    return ApiResponse(data=None)


@router.post("/reset-password", response_model=ApiResponse)
async def reset_password(body: ResetPasswordRequest):
    success = await _auth_service.reset_password(body.token, body.new_password)
    if not success:
        raise BadRequestError("Неверный токен или срок его действия истек")
    return ApiResponse(data=None)
