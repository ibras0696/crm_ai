import uuid

from fastapi import APIRouter, Depends, Query, UploadFile
from fastapi import File as FastAPIFile
from fastapi.responses import Response

from src.common.enums import UserRole
from src.common.http_headers import content_disposition_attachment
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.files.errors import FilesModuleError
from src.modules.files.schemas import FileItem
from src.modules.files.service import FilesService

router = APIRouter(prefix="/files", tags=["files"])

FILE_NOT_FOUND_MESSAGE = "\u0424\u0430\u0439\u043b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d"


@router.post("/upload", response_model=ApiResponse[FileItem])
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write")),
):
    async with UnitOfWork() as uow:
        service = FilesService(uow.session)
        try:
            db_file = await service.upload(org_id=current_user.org_id, user_id=current_user.user_id, file=file)
        except FilesModuleError as exc:
            return ApiResponse(ok=False, data=None, error={"code": exc.code, "message": exc.message})
        await uow.commit()
        item = FileItem.model_validate(db_file)
    return ApiResponse(data=item)


@router.get("/", response_model=ApiResponse[list[FileItem]])
async def list_files(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read")),
):
    async with UnitOfWork() as uow:
        service = FilesService(uow.session)
        files = await service.list_org_files(org_id=current_user.org_id, limit=limit, offset=offset)
        items = [FileItem.model_validate(db_file) for db_file in files]
    return ApiResponse(data=items)


@router.get("/{file_id}/download")
async def download_file(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read", resource_id_param="file_id")),
):
    async with UnitOfWork() as uow:
        service = FilesService(uow.session)
        db_file = await service.get_for_org(org_id=current_user.org_id, file_id=file_id)
        if db_file is None:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": FILE_NOT_FOUND_MESSAGE})

    data, content_type = service.download_payload(db_file)
    return Response(
        content=data,
        media_type=content_type,
        headers={"Content-Disposition": content_disposition_attachment(db_file.original_name)},
    )


@router.delete("/{file_id}", response_model=ApiResponse[None])
async def delete_file(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
    _: None = Depends(require_access(resource_type="files", permission="can_delete", resource_id_param="file_id")),
):
    async with UnitOfWork() as uow:
        service = FilesService(uow.session)
        deleted = await service.delete_for_org(org_id=current_user.org_id, file_id=file_id)
        if not deleted:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": FILE_NOT_FOUND_MESSAGE})
        await uow.commit()
    return ApiResponse(data=None)
