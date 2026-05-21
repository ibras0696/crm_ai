"""Эндпоинты фильтрации/экспорта/импорта записей таблиц.

Роуты должны быть тонкими: валидация входа + вызов сервиса.
Бизнес-логика вынесена в `TableQueryService`.
"""

from __future__ import annotations

import uuid  # noqa: TC003

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import StreamingResponse

from src.common.enums import UserRole
from src.common.http_headers import content_disposition_attachment
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.query_service import TableQueryService
from src.modules.tables.schemas import CsvImportCommitOut, CsvImportPreviewOut, FilterRequest, RecordOut

router = APIRouter(prefix="/tables/{table_id}", tags=["records"])


def _csv_error_response(code: str) -> ApiResponse[None]:
    if code == "EMPTY_CSV":
        return ApiResponse(ok=False, data=None, error={"code": "BAD_REQUEST", "message": "Пустой CSV"})
    if code == "NO_MATCHING_COLUMNS":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "NO_MATCHING_COLUMNS", "message": "В CSV нет совпадений с колонками таблицы."},
        )
    if code == "CSV_TOO_LARGE":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "CSV_TOO_LARGE", "message": "CSV превышает допустимый размер."},
        )
    if code == "TOO_MANY_COLUMNS":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "TOO_MANY_COLUMNS", "message": "В CSV слишком много колонок."},
        )
    if code == "TOO_MANY_ROWS":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "TOO_MANY_ROWS", "message": "В CSV слишком много строк."},
        )
    if code == "CELL_TOO_LARGE":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "CELL_TOO_LARGE", "message": "В CSV есть слишком длинные значения."},
        )
    if code == "IMPORT_TIMEOUT":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "IMPORT_TIMEOUT", "message": "Импорт прерван по лимиту времени."},
        )
    if code == "RECORD_LIMIT_REACHED":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "RECORD_LIMIT_REACHED", "message": "Достигнут лимит тарифа по записям."},
        )
    if code == "BAD_IMPORT_MODE":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "BAD_IMPORT_MODE", "message": "Режим импорта должен быть append или replace."},
        )
    if code == "BAD_MAPPING_JSON":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "BAD_MAPPING_JSON", "message": "Некорректный JSON маппинга колонок."},
        )
    if code == "CSV_VALIDATION_FAILED":
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "CSV_VALIDATION_FAILED", "message": "CSV не прошел валидацию. Используйте preview."},
        )
    return ApiResponse(ok=False, data=None, error={"code": "BAD_REQUEST", "message": "Некорректный CSV"})


@router.post("/filter", response_model=ApiResponse[dict])
async def filter_records(
    table_id: uuid.UUID,
    body: FilterRequest,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    """Серверная фильтрация/сортировка записей с пагинацией."""
    async with UnitOfWork() as uow:
        svc = TableQueryService(uow.session)
        try:
            result = await svc.filter_records(
                table_id=table_id,
                org_id=current_user.org_id,
                search=body.search,
                filters=body.filters,
                sorts=body.sorts,
                limit=limit,
                offset=offset,
            )
        except LookupError:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        items = [RecordOut.model_validate(r) for r in result["records"]]
        total = int(result["total"])
        return ApiResponse(data={"records": [i.model_dump() for i in items], "total": total})


@router.get("/export/csv")
async def export_csv(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    """Экспорт таблицы в CSV."""
    async with UnitOfWork() as uow:
        svc = TableQueryService(uow.session)
        try:
            payload, media_type, filename = await svc.export_csv(table_id=table_id, org_id=current_user.org_id)
        except LookupError:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        except ValueError as exc:
            code = str(exc)
            if code == "EXPORT_TOO_MANY_ROWS":
                return ApiResponse(
                    ok=False,
                    data=None,
                    error={"code": "EXPORT_TOO_MANY_ROWS", "message": "Слишком много строк для экспорта."},
                )
            if code == "EXPORT_TOO_MANY_COLUMNS":
                return ApiResponse(
                    ok=False,
                    data=None,
                    error={"code": "EXPORT_TOO_MANY_COLUMNS", "message": "Слишком много колонок для экспорта."},
                )
            return ApiResponse(
                ok=False, data=None, error={"code": "BAD_REQUEST", "message": "Невозможно выполнить экспорт."}
            )

        return StreamingResponse(
            iter([payload]),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition_attachment(filename)},
        )


@router.get("/export/xlsx")
async def export_xlsx(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(
        require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)
    ),
    _: None = Depends(require_access(resource_type="table", permission="can_read", resource_id_param="table_id")),
):
    """Экспорт таблицы в XLSX."""
    async with UnitOfWork() as uow:
        svc = TableQueryService(uow.session)
        try:
            payload, media_type, filename = await svc.export_xlsx(table_id=table_id, org_id=current_user.org_id)
        except LookupError:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        except ValueError as exc:
            code = str(exc)
            if code == "EXPORT_TOO_MANY_ROWS":
                return ApiResponse(
                    ok=False,
                    data=None,
                    error={"code": "EXPORT_TOO_MANY_ROWS", "message": "Слишком много строк для экспорта."},
                )
            if code == "EXPORT_TOO_MANY_COLUMNS":
                return ApiResponse(
                    ok=False,
                    data=None,
                    error={"code": "EXPORT_TOO_MANY_COLUMNS", "message": "Слишком много колонок для экспорта."},
                )
            return ApiResponse(
                ok=False, data=None, error={"code": "BAD_REQUEST", "message": "Невозможно выполнить экспорт."}
            )

        return StreamingResponse(
            iter([payload]),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition_attachment(filename)},
        )


@router.post("/import/csv", response_model=ApiResponse[dict])
async def import_csv(
    table_id: uuid.UUID,
    mode: str = Query(default="append"),
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    """Импорт CSV в существующую таблицу (простая версия)."""
    async with UnitOfWork() as uow:
        svc = TableQueryService(uow.session)
        raw = await file.read()
        try:
            result = await svc.import_csv(
                table_id=table_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                raw_bytes=raw,
                mode=mode,
            )
        except LookupError:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        except ValueError as exc:
            return _csv_error_response(str(exc))

        await uow.commit()
        return ApiResponse(
            data={
                "records_created": int(result.get("created", 0)),
                "deleted_before": int(result.get("deleted_before", 0)),
                "mode": mode,
            }
        )


@router.post("/import/csv/preview", response_model=ApiResponse[CsvImportPreviewOut])
async def preview_import_csv(
    table_id: uuid.UUID,
    mode: str = Query(default="append"),
    mapping_json: str | None = Form(default=None),
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    """Preview import: validate rows and show per-row errors before commit."""
    async with UnitOfWork() as uow:
        svc = TableQueryService(uow.session)
        raw = await file.read()
        try:
            result = await svc.preview_csv_import(
                table_id=table_id,
                org_id=current_user.org_id,
                raw_bytes=raw,
                mode=mode,
                mapping_json=mapping_json,
            )
        except LookupError:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        except ValueError as exc:
            return _csv_error_response(str(exc))
        return ApiResponse(data=CsvImportPreviewOut.model_validate(result))


@router.post("/import/csv/commit", response_model=ApiResponse[CsvImportCommitOut])
async def commit_import_csv(
    table_id: uuid.UUID,
    mode: str = Query(default="append"),
    strict: bool = Query(default=False),
    mapping_json: str | None = Form(default=None),
    file: UploadFile = File(...),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    _: None = Depends(require_access(resource_type="table", permission="can_write", resource_id_param="table_id")),
):
    """Commit import: create records from validated rows."""
    async with UnitOfWork() as uow:
        svc = TableQueryService(uow.session)
        raw = await file.read()
        try:
            result = await svc.commit_csv_import(
                table_id=table_id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                raw_bytes=raw,
                mode=mode,
                mapping_json=mapping_json,
                strict=bool(strict),
            )
        except LookupError:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        except ValueError as exc:
            return _csv_error_response(str(exc))
        await uow.commit()
        return ApiResponse(data=CsvImportCommitOut.model_validate(result))
