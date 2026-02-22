import uuid

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.modules.tables.models import Column, Table, TableFolder, TableView


class TableFolderRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, folder: TableFolder) -> TableFolder:
        self.session.add(folder)
        await self.session.flush()
        return folder

    async def get_by_id(self, folder_id: uuid.UUID) -> TableFolder | None:
        return await self.session.get(TableFolder, folder_id)

    async def list_by_org(self, org_id: uuid.UUID) -> list[TableFolder]:
        stmt = (
            select(TableFolder)
            .where(TableFolder.org_id == org_id)
            .order_by(TableFolder.position, TableFolder.created_at)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_max_position(self, org_id: uuid.UUID) -> int:
        from sqlalchemy import func
        stmt = select(func.coalesce(func.max(TableFolder.position), -1)).where(TableFolder.org_id == org_id)
        result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def update(self, folder: TableFolder) -> TableFolder:
        await self.session.flush()
        return folder

    async def delete(self, folder: TableFolder):
        await self.session.delete(folder)
        await self.session.flush()


class TableRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, table: Table) -> Table:
        self.session.add(table)
        await self.session.flush()
        return table

    async def get_by_id(self, table_id: uuid.UUID, with_columns: bool = True) -> Table | None:
        stmt = select(Table).where(Table.id == table_id)
        if with_columns:
            stmt = stmt.options(selectinload(Table.columns))
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_org(self, org_id: uuid.UUID, include_archived: bool = False) -> list[Table]:
        stmt = (
            select(Table)
            .where(Table.org_id == org_id)
            .options(selectinload(Table.columns))
            .order_by(Table.created_at.desc())
        )
        if not include_archived:
            stmt = stmt.where(Table.is_archived.is_(False))
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id_for_org(
        self,
        *,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
        with_columns: bool = True,
    ) -> Table | None:
        stmt = select(Table).where(Table.id == table_id, Table.org_id == org_id)
        if with_columns:
            stmt = stmt.options(selectinload(Table.columns))
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def clear_folder(self, *, org_id: uuid.UUID, folder_id: uuid.UUID) -> None:
        stmt = (
            update(Table)
            .where(Table.org_id == org_id, Table.folder_id == folder_id)
            .values(folder_id=None)
        )
        await self.session.execute(stmt)
        await self.session.flush()

    async def update(self, table: Table) -> Table:
        await self.session.flush()
        return table

    async def delete(self, table: Table):
        await self.session.delete(table)
        await self.session.flush()


class ColumnRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, column: Column) -> Column:
        self.session.add(column)
        await self.session.flush()
        return column

    async def get_by_id(self, column_id: uuid.UUID) -> Column | None:
        return await self.session.get(Column, column_id)

    async def get_by_id_for_table(self, *, column_id: uuid.UUID, table_id: uuid.UUID) -> Column | None:
        stmt = select(Column).where(Column.id == column_id, Column.table_id == table_id).limit(1)
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def update(self, column: Column) -> Column:
        await self.session.flush()
        return column

    async def delete(self, column: Column):
        await self.session.delete(column)
        await self.session.flush()

    async def get_max_position(self, table_id: uuid.UUID) -> int:
        from sqlalchemy import func
        stmt = select(func.coalesce(func.max(Column.position), -1)).where(Column.table_id == table_id)
        result = await self.session.execute(stmt)
        return result.scalar() or 0


class TableViewRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, view: TableView) -> TableView:
        self.session.add(view)
        await self.session.flush()
        return view

    async def get_by_id(self, view_id: uuid.UUID) -> TableView | None:
        return await self.session.get(TableView, view_id)

    async def get_by_id_for_scope(
        self,
        *,
        view_id: uuid.UUID,
        table_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> TableView | None:
        stmt = select(TableView).where(
            TableView.id == view_id,
            TableView.table_id == table_id,
            TableView.org_id == org_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def list_by_table(self, *, table_id: uuid.UUID, org_id: uuid.UUID) -> list[TableView]:
        stmt = (
            select(TableView)
            .where(TableView.table_id == table_id, TableView.org_id == org_id)
            .order_by(TableView.created_at)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def delete(self, view: TableView) -> None:
        await self.session.delete(view)
        await self.session.flush()
