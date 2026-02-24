"""Эндпоинты фильтрации/экспорта/импорта записей таблиц.

Роуты должны быть тонкими: валидация входа + вызов сервиса.
Бизнес-логика вынесена в `TableQueryService`.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import StreamingResponse

from src.common.enums import UserRole
from src.common.http_headers import content_disposition_attachment
from src.common.schemas import ApiResponse
from src.infrastructure.uow import UnitOfWork
from src.modules.access.dependencies import require_access
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.query_service import TableQueryService
from src.modules.tables.schemas import FilterRequest, RecordOut


router = APIRouter(prefix="/tables/{table_id}", tags=["records"])


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
    """Фильтр записей (в памяти, для небольших объемов)."""
    async with UnitOfWork() as uow:
        svc = TableQueryService(uow.session)
        try:
            result = await svc.filter_records(
                table_id=table_id,
                org_id=current_user.org_id,
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
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
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
                return ApiResponse(ok=False, data=None, error={"code": "EXPORT_TOO_MANY_ROWS", "message": "Слишком много строк для экспорта."})
            if code == "EXPORT_TOO_MANY_COLUMNS":
                return ApiResponse(ok=False, data=None, error={"code": "EXPORT_TOO_MANY_COLUMNS", "message": "Слишком много колонок для экспорта."})
            return ApiResponse(ok=False, data=None, error={"code": "BAD_REQUEST", "message": "Невозможно выполнить экспорт."})

        return StreamingResponse(
            iter([payload]),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition_attachment(filename)},
        )


@router.get("/export/xlsx")
async def export_xlsx(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
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
                return ApiResponse(ok=False, data=None, error={"code": "EXPORT_TOO_MANY_ROWS", "message": "Слишком много строк для экспорта."})
            if code == "EXPORT_TOO_MANY_COLUMNS":
                return ApiResponse(ok=False, data=None, error={"code": "EXPORT_TOO_MANY_COLUMNS", "message": "Слишком много колонок для экспорта."})
            return ApiResponse(ok=False, data=None, error={"code": "BAD_REQUEST", "message": "Невозможно выполнить экспорт."})

        return StreamingResponse(
            iter([payload]),
            media_type=media_type,
            headers={"Content-Disposition": content_disposition_attachment(filename)},
        )


@router.post("/import/csv", response_model=ApiResponse[dict])
async def import_csv(
    table_id: uuid.UUID,
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
            )
        except LookupError:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        except ValueError as exc:
            code = str(exc)
            if code == "EMPTY_CSV":
                return ApiResponse(ok=False, data=None, error={"code": "BAD_REQUEST", "message": "Пустой CSV"})
            if code == "NO_MATCHING_COLUMNS":
                return ApiResponse(ok=False, data=None, error={"code": "NO_MATCHING_COLUMNS", "message": "В CSV нет совпадений с колонками таблицы."})
            if code == "CSV_TOO_LARGE":
                return ApiResponse(ok=False, data=None, error={"code": "CSV_TOO_LARGE", "message": "CSV превышает допустимый размер."})
            if code == "TOO_MANY_COLUMNS":
                return ApiResponse(ok=False, data=None, error={"code": "TOO_MANY_COLUMNS", "message": "В CSV слишком много колонок."})
            if code == "TOO_MANY_ROWS":
                return ApiResponse(ok=False, data=None, error={"code": "TOO_MANY_ROWS", "message": "В CSV слишком много строк."})
            if code == "CELL_TOO_LARGE":
                return ApiResponse(ok=False, data=None, error={"code": "CELL_TOO_LARGE", "message": "В CSV есть слишком длинные значения."})
            if code == "IMPORT_TIMEOUT":
                return ApiResponse(ok=False, data=None, error={"code": "IMPORT_TIMEOUT", "message": "Импорт прерван по лимиту времени."})
            return ApiResponse(ok=False, data=None, error={"code": "BAD_REQUEST", "message": "Некорректный CSV"})

        await uow.commit()
        return ApiResponse(data={"records_created": int(result.get("created", 0))})
