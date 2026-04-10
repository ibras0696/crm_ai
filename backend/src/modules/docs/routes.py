"""HTTP-роуты модуля Docs."""

from __future__ import annotations

import logging
import uuid  # noqa: TC003

import httpx
import jwt
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, Response
from kombu.exceptions import OperationalError

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.docs.domain import FileType
from src.modules.docs.errors import DocsModuleError
from src.modules.docs.magic_bytes import validate_magic_bytes
from src.modules.docs.schemas import (
    AIGenerateOut,
    AIGenerateRequest,
    AIGenerationJobOut,
    CreateEmptyFileRequest,
    CreateFolderRequest,
    DocsTreeOut,
    DownloadOut,
    FileOut,
    FileTextOut,
    FileVersionOut,
    FinishUploadRequest,
    FolderOut,
    InitUploadOut,
    InitUploadRequest,
    MoveFileRequest,
    OpenDocxOut,
    SaveTextRequest,
    UpdateFolderRequest,
    UsageOut,
)
from src.modules.docs.service import DocsService
from src.modules.docs.tasks import ai_generate, run_ai_generate_inline, scan_version
from src.modules.files.storage import get_s3_client

router = APIRouter(prefix="/docs", tags=["docs"])
logger = logging.getLogger(__name__)


def _error_response(error: DocsModuleError) -> ApiResponse[None]:
    """Преобразовать бизнес-ошибку в API-ответ."""
    return ApiResponse(
        ok=False,
        data=None,
        error={
            "code": error.code,
            "message": error.message,
            "field": getattr(error, "field", None),
            "details": getattr(error, "details", None),
        },
    )


@router.get("/tree", response_model=ApiResponse[DocsTreeOut])
async def get_docs_tree(
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read")),
):
    """Получить дерево папок и файлов в модуле Docs."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        folders, files = await service.list_tree(org_id=current_user.org_id)
        payload = DocsTreeOut(
            folders=[FolderOut.model_validate(item) for item in folders],
            files=[FileOut.model_validate(item) for item in files],
        )
    return ApiResponse(data=payload)


@router.post("/folders", response_model=ApiResponse[FolderOut])
async def create_folder(
    body: CreateFolderRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="files", permission="can_write")),
):
    """Создать папку документов."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            folder = await service.create_folder(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                name=body.name,
                parent_id=body.parent_id,
            )
        except DocsModuleError as error:
            return _error_response(error)
        await uow.commit()
        item = FolderOut.model_validate(folder)
    return ApiResponse(data=item)


@router.patch("/folders/{folder_id}", response_model=ApiResponse[FolderOut])
async def update_folder(
    folder_id: uuid.UUID,
    body: UpdateFolderRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="files", permission="can_write")),
):
    """Переименовать/переместить папку документов."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            folder = await service.update_folder(
                org_id=current_user.org_id,
                folder_id=folder_id,
                updates=body.model_dump(exclude_unset=True),
            )
        except DocsModuleError as error:
            return _error_response(error)
        await uow.commit()
        item = FolderOut.model_validate(folder)
    return ApiResponse(data=item)


@router.delete("/folders/{folder_id}", response_model=ApiResponse[None])
async def delete_folder(
    folder_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="files", permission="can_delete")),
):
    """Удалить пустую папку документов."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            await service.delete_folder(org_id=current_user.org_id, folder_id=folder_id)
        except DocsModuleError as error:
            return _error_response(error)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/files/init-upload", response_model=ApiResponse[InitUploadOut])
async def init_upload(
    body: InitUploadRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write")),
):
    """Инициализировать загрузку файла: резерв квоты + presigned PUT URL."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            payload = await service.init_upload(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                filename=body.filename,
                content_type=body.content_type,
                size_bytes=body.size_bytes,
                folder_id=body.folder_id,
                title=body.title,
            )
        except DocsModuleError as error:
            return _error_response(error)
        await uow.commit()
        item = InitUploadOut.model_validate(payload)
    return ApiResponse(data=item)


@router.post("/files/finish-upload", response_model=ApiResponse[FileOut])
async def finish_upload(
    body: FinishUploadRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write")),
):
    """Завершить загрузку: создать версию и перевести файл в SCANNING."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            result = await service.finish_upload(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                file_id=body.file_id,
                size_bytes=body.size_bytes,
                sha256=body.sha256,
            )
        except DocsModuleError as error:
            return _error_response(error)
        file_obj = result.file
        await uow.session.refresh(file_obj)
        await uow.commit()
        try:
            scan_version.delay(str(result.version_id))
        except (OperationalError, OSError, RuntimeError):
            logger.exception("docs_scan_enqueue_failed", extra={"file_id": str(file_obj.id)})
            scan_version.run(str(result.version_id))
        item = FileOut.model_validate(file_obj)
    return ApiResponse(data=item)


@router.post("/files/{file_id}/abort-upload", response_model=ApiResponse[FileOut])
async def abort_upload(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write", resource_id_param="file_id")),
):
    """Отменить незавершенную загрузку файла в статусе UPLOADING."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            file_obj = await service.abort_upload(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                file_id=file_id,
            )
            await uow.session.refresh(file_obj)
            await uow.commit()
        except DocsModuleError as error:
            return _error_response(error)
        item = FileOut.model_validate(file_obj)
    return ApiResponse(data=item)


@router.post("/files/create-empty", response_model=ApiResponse[FileOut])
async def create_empty_file(
    body: CreateEmptyFileRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write")),
):
    """Создать пустой DOCX файл в выбранной папке или в корне."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            file_obj = await service.create_empty_file(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                file_type=body.type,
                folder_id=body.folder_id,
                title=body.title,
            )
            await uow.session.refresh(file_obj)
            await uow.commit()
        except DocsModuleError as error:
            return _error_response(error)
        item = FileOut.model_validate(file_obj)
    return ApiResponse(data=item)


@router.delete("/files/{file_id}", response_model=ApiResponse[None])
async def delete_file(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write", resource_id_param="file_id")),
):
    """Удалить файл документа и запустить фоновую очистку в S3."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            await service.delete_file(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                file_id=file_id,
            )
            await uow.commit()
        except DocsModuleError as error:
            return _error_response(error)
    return ApiResponse(data=None)


@router.patch("/files/{file_id}", response_model=ApiResponse[FileOut])
async def move_file(
    file_id: uuid.UUID,
    body: MoveFileRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write", resource_id_param="file_id")),
):
    """Переместить файл в папку или в корень."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            file_obj = await service.move_file(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                file_id=file_id,
                folder_id=body.folder_id,
            )
            await uow.session.refresh(file_obj)
            await uow.commit()
        except DocsModuleError as error:
            return _error_response(error)
        item = FileOut.model_validate(file_obj)
    return ApiResponse(data=item)


@router.get("/files/{file_id}", response_model=ApiResponse[FileOut])
async def get_file(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read", resource_id_param="file_id")),
):
    """Получить метаданные файла."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            file_obj = await service.get_file(org_id=current_user.org_id, file_id=file_id)
        except DocsModuleError as error:
            return _error_response(error)
        item = FileOut.model_validate(file_obj)
    return ApiResponse(data=item)


@router.post("/files/{file_id}/save-text", response_model=ApiResponse[FileOut])
async def save_text(
    file_id: uuid.UUID,
    body: SaveTextRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write", resource_id_param="file_id")),
):
    """Сохранить новое текстовое содержимое TXT-файла."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            file_obj = await service.save_text(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                file_id=file_id,
                content=body.content,
                title=body.title,
                expected_updated_at=body.expected_updated_at,
            )
            await uow.session.refresh(file_obj)
            await uow.commit()
        except DocsModuleError as error:
            if error.status_code == 409:
                return JSONResponse(
                    status_code=error.status_code,
                    content={"ok": False, "data": None, "error": {"code": error.code, "message": error.message}},
                )
            return _error_response(error)
        item = FileOut.model_validate(file_obj)
    return ApiResponse(data=item)


@router.get("/files/{file_id}/text", response_model=ApiResponse[FileTextOut])
async def get_file_text(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read", resource_id_param="file_id")),
):
    """Получить текстовое содержимое TXT-файла."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            payload = await service.get_text_content(org_id=current_user.org_id, file_id=file_id)
        except DocsModuleError as error:
            return _error_response(error)
        item = FileTextOut.model_validate(payload)
    return ApiResponse(data=item)


@router.get("/files/{file_id}/versions", response_model=ApiResponse[list[FileVersionOut]])
async def list_file_versions(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read", resource_id_param="file_id")),
):
    """Получить read-only историю версий файла."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            rows = await service.list_versions(org_id=current_user.org_id, file_id=file_id, limit=100)
        except DocsModuleError as error:
            return _error_response(error)
        payload = [FileVersionOut.model_validate(item) for item in rows]
    return ApiResponse(data=payload)


@router.post("/files/{file_id}/open-docx", response_model=ApiResponse[OpenDocxOut])
async def open_docx(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write", resource_id_param="file_id")),
):
    """Открыть DOCX в OnlyOffice и вернуть editor config."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            result = await service.open_docx(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                file_id=file_id,
                user_name=str(current_user.user_id),
            )
        except DocsModuleError as error:
            return _error_response(error)
        await uow.session.refresh(result.file)
        await uow.commit()
        payload = OpenDocxOut(
            file=FileOut.model_validate(result.file),
            document_server_url=result.document_server_url,
            config=result.config,
            token=result.token,
        )
    return ApiResponse(data=payload)


@router.get("/files/internal-download/{version_id}")
async def internal_download(version_id: uuid.UUID, token: str):
    """Внутренний роут для скачивания файла сервером OnlyOffice."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        if payload.get("action") != "internal_download" or payload.get("sub") != str(version_id):
            raise HTTPException(status_code=403, detail="Invalid token scope")
    except jwt.InvalidTokenError as err:
        raise HTTPException(status_code=403, detail="Invalid token") from err

    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            version = await service.repo.get_file_version_by_id(version_id=version_id)
            if not version or not version.s3_key:
                raise HTTPException(status_code=404, detail="Version not found")
        except DocsModuleError as err:
            raise HTTPException(status_code=404, detail="Version not found") from err

    s3 = get_s3_client()
    try:
        resp = s3.get_object(Bucket=version.s3_bucket, Key=version.s3_key)
        payload = bytes(resp["Body"].read())
        magic_ok, magic_reason = validate_magic_bytes(FileType.DOCX, payload)
        if not magic_ok:
            logger.error(
                "docs_internal_download_magic_mismatch",
                extra={
                    "version_id": str(version_id),
                    "reason": magic_reason,
                    "payload_head_hex": payload[:16].hex(),
                    "payload_size": len(payload),
                },
            )
            raise HTTPException(status_code=409, detail="Invalid DOCX payload")
        logger.info(
            "docs_internal_download_ok",
            extra={
                "version_id": str(version_id),
                "bucket": version.s3_bucket,
                "key": version.s3_key,
                "size_bytes": len(payload),
                "magic_reason": magic_reason,
            },
        )
        return Response(
            content=payload,
            media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            headers={
                "Content-Disposition": "attachment; filename*=UTF-8''document.docx",
                "Cache-Control": "no-store",
            },
        )
    except HTTPException:
        raise
    except (BotoCoreError, ClientError, KeyError, OSError) as err:
        logger.error(f"S3 download failed internally: {err}")
        raise HTTPException(status_code=500, detail="Storage error") from err


@router.get("/files/internal-source-download/{version_id}")
async def internal_source_download(version_id: uuid.UUID, token: str):
    """Внутренний роут для скачивания исходника конвертации (pdf/txt/docx)."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        if payload.get("action") != "internal_download_source" or payload.get("sub") != str(version_id):
            raise HTTPException(status_code=403, detail="Invalid token scope")
    except jwt.InvalidTokenError as err:
        raise HTTPException(status_code=403, detail="Invalid token") from err

    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            version = await service.repo.get_file_version_by_id(version_id=version_id)
            if not version or not version.s3_key:
                raise HTTPException(status_code=404, detail="Version not found")
        except DocsModuleError as err:
            raise HTTPException(status_code=404, detail="Version not found") from err

    s3 = get_s3_client()
    try:
        resp = s3.get_object(Bucket=version.s3_bucket, Key=version.s3_key)
        payload = bytes(resp["Body"].read())
        media_type = str(resp.get("ContentType", "application/octet-stream") or "application/octet-stream")
        extension = "bin"
        if media_type == "application/pdf":
            extension = "pdf"
        elif media_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            extension = "docx"
        elif media_type == "text/plain":
            extension = "txt"
        logger.info(
            "docs_internal_source_download_ok",
            extra={
                "version_id": str(version_id),
                "bucket": version.s3_bucket,
                "key": version.s3_key,
                "media_type": media_type,
                "size_bytes": len(payload),
            },
        )
        return Response(
            content=payload,
            media_type=media_type,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''source.{extension}",
                "Cache-Control": "no-store",
            },
        )
    except (BotoCoreError, ClientError, KeyError, OSError) as err:
        logger.error(f"S3 source download failed internally: {err}")
        raise HTTPException(status_code=500, detail="Storage error") from err


@router.post("/integrations/onlyoffice/callback")
async def onlyoffice_callback(request: Request):
    """Callback от OnlyOffice при сохранении DOCX."""
    state_token = str(request.query_params.get("state") or "").strip()
    if not state_token:
        return JSONResponse(status_code=401, content={"error": 1, "message": "Missing callback state"})
    try:
        body = await request.json()
        if not isinstance(body, dict):
            body = {}
    except ValueError:
        body = {}

    auth_header = request.headers.get("Authorization")
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            result = await service.process_onlyoffice_callback(
                body=body,
                state_token=state_token,
                auth_header=auth_header,
            )
            new_version_id = result.get("new_version_id")
            await uow.commit()
        except DocsModuleError as error:
            await uow.rollback()
            return JSONResponse(
                status_code=error.status_code,
                content={"error": 1, "message": error.message, "code": error.code},
            )
        except (httpx.HTTPError, jwt.InvalidTokenError, KeyError, LookupError, RuntimeError, TypeError, ValueError):
            await uow.rollback()
            logger.exception("docs_onlyoffice_callback_failed")
            return JSONResponse(status_code=500, content={"error": 1, "message": "Callback processing failed"})

    if isinstance(new_version_id, str) and new_version_id.strip():
        try:
            scan_version.delay(str(new_version_id))
        except (OperationalError, OSError, RuntimeError):
            logger.exception("docs_onlyoffice_scan_enqueue_failed", extra={"version_id": new_version_id})
            scan_version.run(str(new_version_id))
    return JSONResponse(status_code=200, content={"error": 0})


@router.post("/files/ai/generate", response_model=ApiResponse[AIGenerateOut])
async def create_file_via_ai(
    body: AIGenerateRequest,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write")),
):
    """Поставить AI-задачу генерации DOCX документа."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            result = await service.request_ai_generate(
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                file_type=body.type,
                prompt=body.prompt,
                template=body.template,
                folder_id=body.folder_id,
                title=body.title,
                language=body.language,
            )
            await uow.commit()
        except DocsModuleError as error:
            return _error_response(error)

    task_id: str | None = None
    if result.should_enqueue_task:
        try:
            task = ai_generate.delay(str(result.job.id))
            task_id = str(getattr(task, "id", "") or "")
        except (OperationalError, OSError, RuntimeError):
            logger.exception("docs_ai_generate_enqueue_failed", extra={"job_id": str(result.job.id)})
            await run_ai_generate_inline(job_id=str(result.job.id), task_id="inline-route-fallback")

        if task_id:
            async with UnitOfWork() as uow:
                service = DocsService(uow.session)
                try:
                    job = await service.get_ai_generation_job(org_id=current_user.org_id, job_id=result.job.id)
                    job.task_id = task_id
                    await uow.commit()
                except DocsModuleError:
                    await uow.rollback()

    payload = AIGenerateOut(
        job_id=result.job.id,
        file_id=result.file.id,
        status=result.job.status,
        estimated_request_tokens=int(result.estimated_request_tokens),
    )
    return ApiResponse(data=payload)


@router.get("/files/ai/jobs/{job_id}", response_model=ApiResponse[AIGenerationJobOut])
async def get_ai_generation_job(
    job_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read")),
):
    """Получить статус AI-задачи генерации документа."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            job = await service.get_ai_generation_job(org_id=current_user.org_id, job_id=job_id)
        except DocsModuleError as error:
            return _error_response(error)
        payload = AIGenerationJobOut.model_validate(job)
    return ApiResponse(data=payload)


@router.get("/files/ai/jobs", response_model=ApiResponse[list[AIGenerationJobOut]])
async def list_ai_generation_jobs(
    limit: int = Query(default=20, ge=1, le=100),
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read")),
):
    """Получить последние AI-задачи генерации документов."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        jobs = await service.list_ai_generation_jobs(org_id=current_user.org_id, limit=limit)
        payload = [AIGenerationJobOut.model_validate(item) for item in jobs]
    return ApiResponse(data=payload)


@router.post("/files/ai/jobs/{job_id}/stop", response_model=ApiResponse[AIGenerationJobOut])
async def stop_ai_generation_job(
    job_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write")),
):
    """Остановить активную AI-задачу генерации документа."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            job = await service.stop_ai_generation_job(
                org_id=current_user.org_id,
                actor_id=current_user.user_id,
                job_id=job_id,
            )
        except DocsModuleError as error:
            return _error_response(error)
        await uow.session.refresh(job)
        await uow.commit()
        payload = AIGenerationJobOut.model_validate(job)
    return ApiResponse(data=payload)


@router.delete("/files/ai/jobs/{job_id}", response_model=ApiResponse[None])
async def delete_ai_generation_job(
    job_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_write")),
):
    """Удалить AI-задачу из истории."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            await service.delete_ai_generation_job(
                org_id=current_user.org_id,
                actor_id=current_user.user_id,
                job_id=job_id,
            )
        except DocsModuleError as error:
            return _error_response(error)
        await uow.commit()
    return ApiResponse(data=None)


@router.get("/files/{file_id}/download", response_model=ApiResponse[DownloadOut])
async def get_download_url(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read", resource_id_param="file_id")),
):
    """Получить presigned URL для скачивания READY-файла."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            payload = await service.build_download(org_id=current_user.org_id, file_id=file_id)
        except DocsModuleError as error:
            return _error_response(error)
        item = DownloadOut.model_validate(payload)
    return ApiResponse(data=item)


@router.get("/files/{file_id}/export-pdf", response_model=ApiResponse[DownloadOut])
async def get_export_pdf_url(
    file_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read", resource_id_param="file_id")),
):
    """Экспортировать DOCX в PDF и вернуть временную ссылку на скачивание."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        try:
            payload = await service.export_pdf(org_id=current_user.org_id, file_id=file_id)
        except DocsModuleError as error:
            return _error_response(error)
        item = DownloadOut.model_validate(payload)
    return ApiResponse(data=item)


@router.get("/usage", response_model=ApiResponse[UsageOut])
async def get_usage(
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY),
    ),
    _: None = Depends(require_access(resource_type="files", permission="can_read")),
):
    """Получить текущий usage/лимит хранилища организации."""
    async with UnitOfWork() as uow:
        service = DocsService(uow.session)
        payload = await service.get_usage(org_id=current_user.org_id)
        await uow.commit()
        item = UsageOut.model_validate(payload)
    return ApiResponse(data=item)
