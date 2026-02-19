"""Table views (saved filters/sorts) and CSV/XLSX export."""
import uuid
import csv
import io
from datetime import datetime
from io import BytesIO

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy import ForeignKey, String, Text

from src.common.base_model import BaseDBModel
from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.models import Table
from src.modules.tables.repository import TableRepository
from src.modules.tables.records import Record, RecordRepository
from src.infrastructure.uow import UnitOfWork


# --- Model ---
class TableView(BaseDBModel):
    __tablename__ = "table_views"

    table_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tables.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    view_type: Mapped[str] = mapped_column(String(50), nullable=False, default="grid")  # grid, kanban, calendar
    filters: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    sorts: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    config: Mapped[dict | None] = mapped_column(JSONB, nullable=True)


# --- Schemas ---
class ViewOut(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    name: str
    view_type: str
    filters: dict | None
    sorts: dict | None
    config: dict | None
    created_at: datetime
    model_config = {"from_attributes": True}

class CreateViewRequest(BaseModel):
    name: str
    view_type: str = "grid"
    filters: dict | None = None
    sorts: dict | None = None
    config: dict | None = None

class FilterRequest(BaseModel):
    filters: dict | None = None  # {col_id: {op: "eq"|"contains"|"gt"|"lt", value: ...}}
    sorts: list[dict] | None = None  # [{col_id: str, dir: "asc"|"desc"}]

class RecordOut(BaseModel):
    id: uuid.UUID
    table_id: uuid.UUID
    data: dict
    created_by: uuid.UUID | None
    created_at: datetime
    updated_at: datetime
    model_config = {"from_attributes": True}


router = APIRouter(prefix="/tables/{table_id}/views", tags=["views"])


@router.post("/", response_model=ApiResponse[ViewOut])
async def create_view(
    table_id: uuid.UUID,
    body: CreateViewRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        t_repo = TableRepository(uow.session)
        table = await t_repo.get_by_id(table_id, with_columns=False)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})
        view = TableView(table_id=table_id, org_id=current_user.org_id, name=body.name, view_type=body.view_type, filters=body.filters, sorts=body.sorts, config=body.config)
        uow.session.add(view)
        await uow.session.flush()
        await uow.commit()
        item = ViewOut.model_validate(view)
    return ApiResponse(data=item)


@router.get("/", response_model=ApiResponse[list[ViewOut]])
async def list_views(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    async with UnitOfWork() as uow:
        stmt = select(TableView).where(TableView.table_id == table_id, TableView.org_id == current_user.org_id).order_by(TableView.created_at)
        result = await uow.session.execute(stmt)
        views = list(result.scalars().all())
        items = [ViewOut.model_validate(v) for v in views]
    return ApiResponse(data=items)


@router.delete("/{view_id}", response_model=ApiResponse[None])
async def delete_view(
    table_id: uuid.UUID,
    view_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        view = await uow.session.get(TableView, view_id)
        if not view or view.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Вид не найден"})
        await uow.session.delete(view)
        await uow.commit()
    return ApiResponse(data=None)


# --- Filter/Search endpoint ---
filter_router = APIRouter(prefix="/tables/{table_id}", tags=["records"])


@filter_router.post("/filter", response_model=ApiResponse[dict])
async def filter_records(
    table_id: uuid.UUID,
    body: FilterRequest,
    limit: int = Query(default=100, le=500),
    offset: int = Query(default=0, ge=0),
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE, UserRole.READONLY)),
):
    """Filter records using JSONB operators. Simple in-memory filter for now."""
    async with UnitOfWork() as uow:
        t_repo = TableRepository(uow.session)
        table = await t_repo.get_by_id(table_id, with_columns=False)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        r_repo = RecordRepository(uow.session)
        all_records = await r_repo.list_by_table(table_id, limit=500, offset=0)

        # Apply filters in-memory
        filtered = all_records
        if body.filters:
            for col_id, cond in body.filters.items():
                op = cond.get("op", "eq") if isinstance(cond, dict) else "eq"
                val = cond.get("value", "") if isinstance(cond, dict) else cond
                val_str = str(val).lower()
                new_filtered = []
                for rec in filtered:
                    cell = str(rec.data.get(col_id, "")).lower()
                    if op == "eq" and cell == val_str:
                        new_filtered.append(rec)
                    elif op == "contains" and val_str in cell:
                        new_filtered.append(rec)
                    elif op == "gt" and cell > val_str:
                        new_filtered.append(rec)
                    elif op == "lt" and cell < val_str:
                        new_filtered.append(rec)
                    elif op == "neq" and cell != val_str:
                        new_filtered.append(rec)
                filtered = new_filtered

        # Apply sorts
        if body.sorts:
            for s in reversed(body.sorts):
                col_id = s.get("col_id", "")
                desc = s.get("dir", "asc") == "desc"
                filtered.sort(key=lambda r: str(r.data.get(col_id, "")), reverse=desc)

        total = len(filtered)
        page = filtered[offset:offset + limit]
        items = [RecordOut.model_validate(r) for r in page]
    return ApiResponse(data={"records": [i.model_dump() for i in items], "total": total})


# --- Export CSV ---
@filter_router.get("/export/csv")
async def export_csv(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        t_repo = TableRepository(uow.session)
        table = await t_repo.get_by_id(table_id, with_columns=True)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        r_repo = RecordRepository(uow.session)
        records = await r_repo.list_by_table(table_id, limit=5000, offset=0)

        columns = sorted(table.columns, key=lambda c: c.position)
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([c.name for c in columns])
        for rec in records:
            writer.writerow([str(rec.data.get(str(c.id), "")) for c in columns])

        output.seek(0)
        return StreamingResponse(
            iter([output.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="{table.name}.csv"'},
        )


@filter_router.get("/export/xlsx")
async def export_xlsx(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        t_repo = TableRepository(uow.session)
        table = await t_repo.get_by_id(table_id, with_columns=True)
        if not table or table.org_id != current_user.org_id:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "РўР°Р±Р»РёС†Р° РЅРµ РЅР°Р№РґРµРЅР°"})

        r_repo = RecordRepository(uow.session)
        records = await r_repo.list_by_table(table_id, limit=5000, offset=0)

        columns = sorted(table.columns, key=lambda c: c.position)
        wb = Workbook()
        ws = wb.active
        ws.title = "Table"
        ws.append([c.name for c in columns])
        for rec in records:
            ws.append([str(rec.data.get(str(c.id), "")) for c in columns])

        output = BytesIO()
        wb.save(output)
        output.seek(0)

        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": f'attachment; filename="{table.name}.xlsx"'},
        )


# --- Import CSV ---
@filter_router.post("/import/csv", response_model=ApiResponse[dict])
async def import_csv(
    table_id: uuid.UUID,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    """Import CSV — placeholder. In production, use UploadFile."""
    from fastapi import UploadFile, File as FastAPIFile
    # This is a simplified version; real implementation would parse the uploaded CSV
    return ApiResponse(data={"message": "CSV импорт доступен через API. Загрузите файл через POST multipart/form-data."})
