import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.knowledge.models import KBPage
from src.infrastructure.uow import UnitOfWork
from sqlalchemy import select

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class PageOut(BaseModel):
    id: uuid.UUID
    parent_id: uuid.UUID | None
    title: str
    slug: str
    content: str | None
    icon: str | None
    position: int
    is_published: bool
    created_at: datetime
    model_config = {"from_attributes": True}


class CreatePageRequest(BaseModel):
    title: str
    content: str | None = None
    parent_id: uuid.UUID | None = None
    icon: str | None = None


class UpdatePageRequest(BaseModel):
    title: str | None = None
    content: str | None = None
    parent_id: uuid.UUID | None = None
    icon: str | None = None
    position: int | None = None
    is_published: bool | None = None


@router.post("/pages", response_model=ApiResponse[PageOut])
async def create_page(
    body: CreatePageRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        slug = body.title.lower().replace(" ", "-")[:200]
        page = KBPage(
            org_id=current_user.org_id,
            created_by=current_user.user_id,
            title=body.title,
            slug=slug,
            content=body.content,
            parent_id=body.parent_id,
            icon=body.icon,
        )
        uow.session.add(page)
        await uow.session.flush()
        await uow.commit()
        item = PageOut.model_validate(page)
    return ApiResponse(data=item)


@router.get("/pages", response_model=ApiResponse[list[PageOut]])
async def list_pages(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        stmt = select(KBPage).where(KBPage.org_id == current_user.org_id).order_by(KBPage.position, KBPage.created_at)
        result = await uow.session.execute(stmt)
        pages = list(result.scalars().all())
        items = [PageOut.model_validate(p) for p in pages]
    return ApiResponse(data=items)


@router.get("/pages/{page_id}", response_model=ApiResponse[PageOut])
async def get_page(
    page_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        page = await uow.session.get(KBPage, page_id)
        if not page or page.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Страница не найдена"})
        item = PageOut.model_validate(page)
    return ApiResponse(data=item)


@router.patch("/pages/{page_id}", response_model=ApiResponse[PageOut])
async def update_page(
    page_id: uuid.UUID,
    body: UpdatePageRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        page = await uow.session.get(KBPage, page_id)
        if not page or page.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Страница не найдена"})
        for field, value in body.model_dump(exclude_unset=True).items():
            setattr(page, field, value)
        if body.title:
            page.slug = body.title.lower().replace(" ", "-")[:200]
        await uow.session.flush()
        await uow.commit()
        item = PageOut.model_validate(page)
    return ApiResponse(data=item)


@router.delete("/pages/{page_id}", response_model=ApiResponse[None])
async def delete_page(
    page_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    async with UnitOfWork() as uow:
        page = await uow.session.get(KBPage, page_id)
        if not page or page.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Страница не найдена"})
        await uow.session.delete(page)
        await uow.commit()
    return ApiResponse(data=None)
