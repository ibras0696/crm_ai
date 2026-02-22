"""Сервис фильтрации/экспорта/импорта записей таблиц.

Здесь бизнес-логика. Роуты должны быть тонкими: валидация входа + вызов сервиса.
"""

from __future__ import annotations

import csv
import io
import uuid
from io import BytesIO

from openpyxl import Workbook

from src.common.http_headers import content_disposition_attachment
from src.infrastructure.metrics_custom import EXPORTS_TOTAL, IMPORTS_TOTAL
from src.modules.tables.records import Record, RecordRepository
from src.modules.tables.repository import TableRepository


class TableQueryService:
    """Операции над записями (read-heavy): фильтры/экспорт/импорт."""

    def __init__(self, session):
        self.session = session
        self.t_repo = TableRepository(session)
        self.r_repo = RecordRepository(session)

    async def filter_records(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        filters: dict | None,
        sorts: list[dict] | None,
        limit: int,
        offset: int,
    ) -> dict:
        """Фильтрация записей (текущая реализация — в памяти, для небольших объемов)."""
        table = await self.t_repo.get_by_id(table_id, with_columns=False)
        if not table or table.org_id != org_id:
            raise LookupError("NOT_FOUND")

        all_records = await self.r_repo.list_by_table(table_id, limit=500, offset=0)
        filtered = all_records

        if filters:
            for col_id, cond in filters.items():
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

        if sorts:
            for s in reversed(sorts):
                col_id = s.get("col_id", "")
                desc = s.get("dir", "asc") == "desc"
                filtered.sort(key=lambda r: str(r.data.get(col_id, "")), reverse=desc)

        total = len(filtered)
        page = filtered[offset : offset + limit]
        return {"records": page, "total": total}

    async def export_csv(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> tuple[bytes, str, str]:
        """Экспорт таблицы в CSV.

        Возвращает: (payload, media_type, filename)
        """
        table = await self.t_repo.get_by_id(table_id, with_columns=True)
        if not table or table.org_id != org_id:
            raise LookupError("NOT_FOUND")

        records = await self.r_repo.list_by_table(table_id, limit=5000, offset=0)
        columns = sorted(table.columns, key=lambda c: c.position)

        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([c.name for c in columns])
        for rec in records:
            writer.writerow([str(rec.data.get(str(c.id), "")) for c in columns])

        payload = output.getvalue().encode("utf-8-sig")
        try:
            EXPORTS_TOTAL.labels(format="csv").inc()
        except Exception:
            pass

        return payload, "text/csv; charset=utf-8", f"{table.name}.csv"

    async def export_xlsx(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> tuple[bytes, str, str]:
        """Экспорт таблицы в XLSX.

        Возвращает: (payload, media_type, filename)
        """
        table = await self.t_repo.get_by_id(table_id, with_columns=True)
        if not table or table.org_id != org_id:
            raise LookupError("NOT_FOUND")

        records = await self.r_repo.list_by_table(table_id, limit=5000, offset=0)
        columns = sorted(table.columns, key=lambda c: c.position)

        wb = Workbook()
        ws = wb.active
        ws.title = "Table"
        ws.append([c.name for c in columns])
        for rec in records:
            ws.append([str(rec.data.get(str(c.id), "")) for c in columns])

        output = BytesIO()
        wb.save(output)
        payload = output.getvalue()

        try:
            EXPORTS_TOTAL.labels(format="xlsx").inc()
        except Exception:
            pass

        return payload, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", f"{table.name}.xlsx"

    async def import_csv(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        raw_bytes: bytes,
    ) -> dict:
        """Импорт CSV в существующую таблицу (простая версия).

        Поведение:
        - сопоставляет колонки CSV с колонками таблицы по name (case-insensitive)
        - создает записи только по совпавшим колонкам
        """
        table = await self.t_repo.get_by_id(table_id, with_columns=True)
        if not table or table.org_id != org_id:
            raise LookupError("NOT_FOUND")

        text = raw_bytes.decode("utf-8", errors="replace")
        reader = csv.reader(io.StringIO(text))
        try:
            header = next(reader)
        except StopIteration as exc:
            raise ValueError("EMPTY_CSV") from exc

        by_name = {str(c.name).strip().lower(): c for c in table.columns}
        col_map: list[tuple[int, str]] = []
        for idx, name in enumerate(header):
            col = by_name.get(str(name).strip().lower())
            if col:
                col_map.append((idx, str(col.id)))

        if not col_map:
            raise ValueError("NO_MATCHING_COLUMNS")

        created = 0
        max_pos = await self.r_repo.get_max_position(table_id)
        to_create: list[Record] = []
        for row in reader:
            data: dict[str, str] = {}
            for idx, col_id in col_map:
                if idx < len(row):
                    v = row[idx]
                    if v is not None and str(v).strip() != "":
                        data[col_id] = str(v)
            if not data:
                continue
            to_create.append(
                Record(
                    table_id=table_id,
                    org_id=org_id,
                    created_by=user_id,
                    data=data,
                    position=max_pos + created + 1,
                )
            )
            created += 1

        if to_create:
            await self.r_repo.bulk_create(to_create)

        try:
            IMPORTS_TOTAL.labels(format="csv").inc()
        except Exception:
            pass

        return {"created": created}

