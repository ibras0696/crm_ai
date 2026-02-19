import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Query, UploadFile, File as FastAPIFile
from fastapi.responses import Response
from pydantic import BaseModel

from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.files.models import File
from src.modules.files.repository import FileRepository
from src.modules.files import storage
from src.infrastructure.uow import UnitOfWork

router = APIRouter(prefix="/files", tags=["files"])


class FileItem(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    uploaded_by: uuid.UUID | None
    filename: str
    original_name: str
    content_type: str
    size: int
    created_at: datetime

    model_config = {"from_attributes": True}


@router.post("/upload", response_model=ApiResponse[FileItem])
async def upload_file(
    file: UploadFile = FastAPIFile(...),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    data = await file.read()
    content_type = file.content_type or "application/octet-stream"
    original_name = file.filename or "unnamed"

    s3_key, bucket = storage.upload_file(data, content_type, current_user.org_id, original_name)

    async with UnitOfWork() as uow:
        repo = FileRepository(uow.session)
        db_file = File(
            org_id=current_user.org_id,
            uploaded_by=current_user.user_id,
            filename=s3_key.split("/")[-1],
            original_name=original_name,
            content_type=content_type,
            size=len(data),
            s3_key=s3_key,
            s3_bucket=bucket,
        )
        db_file = await repo.create(db_file)
        await uow.commit()
        item = FileItem.model_validate(db_file)

    return ApiResponse(data=item)


@router.get("/", response_model=ApiResponse[list[FileItem]])
async def list_files(
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        repo = FileRepository(uow.session)
        files = await repo.list_by_org(current_user.org_id, limit=limit, offset=offset)
        items = [FileItem.model_validate(f) for f in files]
    return ApiResponse(data=items)


@router.get("/{file_id}/download")
async def download_file(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        repo = FileRepository(uow.session)
        db_file = await repo.get_by_id(file_id)
        if not db_file or db_file.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Файл не найден"})

    data, ct = storage.download_file(db_file.s3_key, db_file.s3_bucket)
    return Response(content=data, media_type=ct, headers={"Content-Disposition": f'attachment; filename="{db_file.original_name}"'})


@router.delete("/{file_id}", response_model=ApiResponse[None])
async def delete_file(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    async with UnitOfWork() as uow:
        repo = FileRepository(uow.session)
        db_file = await repo.get_by_id(file_id)
        if not db_file or db_file.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Файл не найден"})

        storage.delete_file(db_file.s3_key, db_file.s3_bucket)
        await repo.delete(db_file)
        await uow.commit()

    return ApiResponse(data=None)
