import csv
import io
import uuid
from io import BytesIO

from openpyxl import Workbook

from src.common.enums import AuditAction
from src.infrastructure.uow import UnitOfWork
from src.modules.audit.repository import AuditRepository
from src.modules.superadmin.repository import SuperadminRepository
from src.modules.tables.records import RecordRepository
from src.modules.tables.repository import TableRepository


class SuperadminTablesService:
    """Table-focused read-only use-cases for superadmin."""

    @staticmethod
    def _parse_uuid(raw: str, *, field_name: str) -> uuid.UUID:
        try:
            return uuid.UUID(str(raw))
        except Exception as exc:
            raise ValueError(f"invalid_{field_name}") from exc

    async def org_tables_page(
        self,
        org_id: str,
        *,
        q: str | None,
        include_archived: bool,
        limit: int,
        offset: int,
    ) -> dict:
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            org_uuid = self._parse_uuid(org_id, field_name="org_id")
            items, total = await repo.list_tables_by_org_page(
                org_id=org_uuid,
                q=q,
                include_archived=include_archived,
                limit=limit,
                offset=offset,
            )
        return {"items": items, "total": total, "limit": int(limit), "offset": int(offset)}

    async def org_table_detail(self, org_id: str, table_id: str) -> dict:
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            org_uuid = self._parse_uuid(org_id, field_name="org_id")
            table_uuid = self._parse_uuid(table_id, field_name="table_id")
            table = await repo.get_table_in_org(org_id=org_uuid, table_id=table_uuid)
            if not table:
                raise LookupError("NOT_FOUND")
            columns = [
                {
                    "id": str(column.id),
                    "name": column.name,
                    "field_type": column.field_type,
                    "position": int(column.position),
                    "is_required": bool(column.is_required),
                    "is_primary": bool(column.is_primary),
                    "config": column.config,
                    "default_value": column.default_value,
                }
                for column in sorted(table.columns or [], key=lambda x: x.position)
            ]
            return {
                "id": str(table.id),
                "org_id": str(table.org_id),
                "folder_id": str(table.folder_id) if table.folder_id else None,
                "name": table.name,
                "description": table.description,
                "icon": table.icon,
                "color": table.color,
                "is_archived": bool(table.is_archived),
                "created_at": table.created_at.isoformat() if table.created_at else None,
                "columns": columns,
            }

    async def org_table_records_page(
        self,
        org_id: str,
        table_id: str,
        *,
        q: str | None,
        sort_col_id: str | None,
        sort_dir: str,
        limit: int,
        offset: int,
    ) -> dict:
        if sort_dir not in {"asc", "desc"}:
            sort_dir = "asc"
        async with UnitOfWork() as uow:
            repo = SuperadminRepository(uow.session)
            org_uuid = self._parse_uuid(org_id, field_name="org_id")
            table_uuid = self._parse_uuid(table_id, field_name="table_id")
            table = await repo.get_table_in_org(org_id=org_uuid, table_id=table_uuid)
            if not table:
                raise LookupError("NOT_FOUND")
            rows, total = await repo.list_table_records_page(
                org_id=org_uuid,
                table_id=table_uuid,
                q=q,
                sort_col_id=sort_col_id,
                sort_dir=sort_dir,
                limit=limit,
                offset=offset,
            )
            items = [
                {
                    "id": str(row.id),
                    "table_id": str(row.table_id),
                    "data": row.data,
                    "created_by": str(row.created_by) if row.created_by else None,
                    "created_at": row.created_at.isoformat() if row.created_at else None,
                    "updated_at": row.updated_at.isoformat() if row.updated_at else None,
                    "position": int(row.position),
                }
                for row in rows
            ]
        return {"items": items, "total": total, "limit": int(limit), "offset": int(offset)}

    async def export_table_csv(self, *, org_id: str, table_id: str) -> tuple[bytes, str]:
        async with UnitOfWork() as uow:
            t_repo = TableRepository(uow.session)
            table_uuid = self._parse_uuid(table_id, field_name="table_id")
            org_uuid = self._parse_uuid(org_id, field_name="org_id")

            table = await t_repo.get_by_id(table_uuid, with_columns=True)
            if not table or table.org_id != org_uuid:
                raise LookupError("NOT_FOUND")

            r_repo = RecordRepository(uow.session)
            records = await r_repo.list_by_table(table_uuid, limit=5000, offset=0)

            columns = sorted(table.columns, key=lambda c: c.position)
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow([c.name for c in columns])
            for rec in records:
                writer.writerow([str(rec.data.get(str(c.id), "")) for c in columns])
            payload = output.getvalue().encode("utf-8-sig")

            audit_repo = AuditRepository(uow.session)
            await audit_repo.log(
                org_id=org_uuid,
                actor_id=None,
                action=AuditAction.EXPORT,
                entity_type="table_export",
                entity_id=str(table_uuid),
                meta={"superadmin": True, "format": "csv"},
            )
            await uow.commit()

            return payload, f"{table.name}.csv"

    async def export_table_xlsx(self, *, org_id: str, table_id: str) -> tuple[bytes, str]:
        async with UnitOfWork() as uow:
            t_repo = TableRepository(uow.session)
            table_uuid = self._parse_uuid(table_id, field_name="table_id")
            org_uuid = self._parse_uuid(org_id, field_name="org_id")

            table = await t_repo.get_by_id(table_uuid, with_columns=True)
            if not table or table.org_id != org_uuid:
                raise LookupError("NOT_FOUND")

            r_repo = RecordRepository(uow.session)
            records = await r_repo.list_by_table(table_uuid, limit=5000, offset=0)

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

            audit_repo = AuditRepository(uow.session)
            await audit_repo.log(
                org_id=org_uuid,
                actor_id=None,
                action=AuditAction.EXPORT,
                entity_type="table_export",
                entity_id=str(table_uuid),
                meta={"superadmin": True, "format": "xlsx"},
            )
            await uow.commit()

            return payload, f"{table.name}.xlsx"
