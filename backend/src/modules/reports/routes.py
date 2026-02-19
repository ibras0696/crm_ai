"""Reports: aggregate data from tables, export PDF placeholder."""
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, func

from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.tables.models import Table
from src.modules.tables.records import Record
from src.infrastructure.uow import UnitOfWork

router = APIRouter(prefix="/reports", tags=["reports"])


class TableSummary(BaseModel):
    id: str
    name: str
    records_count: int
    columns_count: int


class OrgReport(BaseModel):
    tables_count: int
    records_count: int
    columns_count: int
    tables: list[TableSummary]


@router.get("/summary", response_model=ApiResponse[OrgReport])
async def org_summary(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    async with UnitOfWork() as uow:
        from sqlalchemy.orm import selectinload
        stmt = select(Table).where(Table.org_id == current_user.org_id, Table.is_archived == False).options(selectinload(Table.columns))
        result = await uow.session.execute(stmt)
        tables = list(result.scalars().all())

        summaries = []
        total_records = 0
        total_columns = 0
        for t in tables:
            cnt_stmt = select(func.count()).select_from(Record).where(Record.table_id == t.id)
            cnt_result = await uow.session.execute(cnt_stmt)
            cnt = cnt_result.scalar() or 0
            total_records += cnt
            col_cnt = len(t.columns)
            total_columns += col_cnt
            summaries.append(TableSummary(id=str(t.id), name=t.name, records_count=cnt, columns_count=col_cnt))

        report = OrgReport(tables_count=len(tables), records_count=total_records, columns_count=total_columns, tables=summaries)
    return ApiResponse(data=report)


class ColumnAggRequest(BaseModel):
    table_id: str
    column_ids: list[str] = []  # empty = all columns


class ColumnAggResult(BaseModel):
    column_id: str
    column_name: str
    field_type: str
    count: int
    non_empty: int
    sum: float | None = None
    avg: float | None = None
    min_val: str | None = None
    max_val: str | None = None
    top_values: list[dict] | None = None  # [{value, count}]


class TableAggResponse(BaseModel):
    table_id: str
    table_name: str
    total_records: int
    columns: list[ColumnAggResult]


@router.post("/table-analytics", response_model=ApiResponse[TableAggResponse])
async def table_analytics(
    body: ColumnAggRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
):
    """Detailed per-column analytics for a specific table."""
    from sqlalchemy.orm import selectinload
    async with UnitOfWork() as uow:
        tbl_stmt = select(Table).where(
            Table.id == uuid.UUID(body.table_id),
            Table.org_id == current_user.org_id,
        ).options(selectinload(Table.columns))
        tbl_result = await uow.session.execute(tbl_stmt)
        table = tbl_result.scalar_one_or_none()
        if not table:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Таблица не найдена"})

        rec_stmt = select(Record).where(Record.table_id == table.id)
        rec_result = await uow.session.execute(rec_stmt)
        records = list(rec_result.scalars().all())

        target_cols = table.columns
        if body.column_ids:
            col_set = set(body.column_ids)
            target_cols = [c for c in table.columns if str(c.id) in col_set]

        col_results = []
        for col in target_cols:
            cid = str(col.id)
            values = [r.data.get(cid) for r in records if r.data.get(cid) is not None and str(r.data.get(cid)).strip() != '']
            non_empty = len(values)

            agg = ColumnAggResult(
                column_id=cid,
                column_name=col.name,
                field_type=col.field_type,
                count=len(records),
                non_empty=non_empty,
            )

            # Numeric aggregations
            if col.field_type in ('number', 'formula'):
                nums = []
                for v in values:
                    try:
                        nums.append(float(v))
                    except (ValueError, TypeError):
                        pass
                if nums:
                    agg.sum = round(sum(nums), 4)
                    agg.avg = round(sum(nums) / len(nums), 4)
                    agg.min_val = str(min(nums))
                    agg.max_val = str(max(nums))
            else:
                if values:
                    str_vals = [str(v) for v in values]
                    agg.min_val = min(str_vals)
                    agg.max_val = max(str_vals)

            # Top values distribution (up to 10)
            from collections import Counter
            freq = Counter(str(v) for v in values)
            agg.top_values = [{"value": k, "count": c} for k, c in freq.most_common(10)]

            col_results.append(agg)

        resp = TableAggResponse(
            table_id=str(table.id),
            table_name=table.name,
            total_records=len(records),
            columns=col_results,
        )
    return ApiResponse(data=resp)


class TimeSeriesPoint(BaseModel):
    date: str
    count: int


@router.get("/timeline", response_model=ApiResponse[list[TimeSeriesPoint]])
async def records_timeline(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)),
    days: int = 30,
):
    """Records created per day for the last N days."""
    from datetime import timedelta, timezone as tz
    cutoff = datetime.now(tz.utc) - timedelta(days=days)
    async with UnitOfWork() as uow:
        stmt = (
            select(
                func.date_trunc('day', Record.created_at).label('day'),
                func.count().label('cnt'),
            )
            .where(Record.org_id == current_user.org_id, Record.created_at >= cutoff)
            .group_by('day')
            .order_by('day')
        )
        rows = (await uow.session.execute(stmt)).all()
        points = [TimeSeriesPoint(date=str(r.day.date()), count=r.cnt) for r in rows]
    return ApiResponse(data=points)
