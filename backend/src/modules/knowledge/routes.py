import uuid

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.knowledge.schemas import CreatePageRequest, PageOut, UpdatePageRequest
from src.modules.knowledge.errors import KnowledgeModuleError
from src.modules.knowledge.service import KnowledgeService

router = APIRouter(prefix="/knowledge", tags=["knowledge"])

PAGE_NOT_FOUND_MESSAGE = (
    "\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u0430"
)


@router.post("/pages", response_model=ApiResponse[PageOut])
async def create_page(
    body: CreatePageRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="knowledge", permission="can_write")),
):
    async with UnitOfWork() as uow:
        service = KnowledgeService(uow.session)
        page = await service.create_page(org_id=current_user.org_id, user_id=current_user.user_id, body=body)
        await uow.commit()
        item = PageOut.model_validate(page)
    return ApiResponse(data=item)


@router.get("/pages", response_model=ApiResponse[list[PageOut]])
async def list_pages(
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="knowledge", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = KnowledgeService(uow.session)
        pages = await service.list_pages(org_id=current_user.org_id)
        items = [PageOut.model_validate(page) for page in pages]
    return ApiResponse(data=items)


@router.get("/pages/{page_id}", response_model=ApiResponse[PageOut])
async def get_page(
    page_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="knowledge", permission="can_read", resource_id_param="page_id")),
):
    async with UnitOfWork() as uow:
        service = KnowledgeService(uow.session)
        page = await service.get_page(org_id=current_user.org_id, page_id=page_id)
        if page is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": PAGE_NOT_FOUND_MESSAGE})
        item = PageOut.model_validate(page)
    return ApiResponse(data=item)


@router.patch("/pages/{page_id}", response_model=ApiResponse[PageOut])
async def update_page(
    page_id: uuid.UUID,
    body: UpdatePageRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="knowledge", permission="can_write", resource_id_param="page_id")),
):
    async with UnitOfWork() as uow:
        service = KnowledgeService(uow.session)
        try:
            page = await service.update_page(org_id=current_user.org_id, page_id=page_id, body=body)
        except KnowledgeModuleError as error:
            return JSONResponse(
                status_code=error.status_code,
                content={"ok": False, "data": None, "error": {"code": error.code, "message": error.message}},
            )
        if page is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": PAGE_NOT_FOUND_MESSAGE})
        await uow.commit()
        await uow.session.refresh(page)
        item = PageOut.model_validate(page)
    return ApiResponse(data=item)


@router.delete("/pages/{page_id}", response_model=ApiResponse[None])
async def delete_page(
    page_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    _: None = Depends(require_access(resource_type="knowledge", permission="can_delete", resource_id_param="page_id")),
):
    async with UnitOfWork() as uow:
        service = KnowledgeService(uow.session)
        deleted = await service.delete_page(org_id=current_user.org_id, page_id=page_id)
        if not deleted:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": PAGE_NOT_FOUND_MESSAGE})
        await uow.commit()
    return ApiResponse(data=None)
