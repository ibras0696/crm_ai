import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.modules.tables.models import Table, Column, TableFolder


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
            stmt = stmt.where(Table.is_archived == False)
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

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
