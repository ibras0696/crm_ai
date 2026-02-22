"""Record model and repository for JSONB-based records storage."""
import uuid

from sqlalchemy import ForeignKey, Integer, func, select, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from src.common.base_model import BaseDBModel


class Record(BaseDBModel):
    __tablename__ = "table_records"

    table_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("tables.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    created_by: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    data: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=text("0"))


class RecordRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create(self, record: Record) -> Record:
        self.session.add(record)
        await self.session.flush()
        return record

    async def get_by_id(self, record_id: uuid.UUID) -> Record | None:
        return await self.session.get(Record, record_id)

    async def list_by_table(
        self,
        table_id: uuid.UUID,
        limit: int = 100,
        offset: int = 0,
    ) -> list[Record]:
        stmt = (
            select(Record)
            .where(Record.table_id == table_id)
            .order_by(Record.position.asc(), Record.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def count_by_table(self, table_id: uuid.UUID) -> int:
        stmt = select(func.count()).select_from(Record).where(Record.table_id == table_id)
        result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def update(self, record: Record) -> Record:
        await self.session.flush()
        return record

    async def delete(self, record: Record):
        await self.session.delete(record)
        await self.session.flush()

    async def bulk_create(self, records: list[Record]) -> list[Record]:
        self.session.add_all(records)
        await self.session.flush()
        return records

    async def get_max_position(self, table_id: uuid.UUID) -> int:
        stmt = select(func.coalesce(func.max(Record.position), -1)).where(Record.table_id == table_id)
        result = await self.session.execute(stmt)
        return result.scalar() or 0

    async def get_prev_in_table(self, table_id: uuid.UUID, position: int) -> Record | None:
        stmt = (
            select(Record)
            .where(Record.table_id == table_id, Record.position < position)
            .order_by(Record.position.desc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def get_next_in_table(self, table_id: uuid.UUID, position: int) -> Record | None:
        stmt = (
            select(Record)
            .where(Record.table_id == table_id, Record.position > position)
            .order_by(Record.position.asc())
            .limit(1)
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none()

    async def normalize_positions(self, table_id: uuid.UUID) -> None:
        """Ensure deterministic contiguous positions per table."""
        stmt = (
            select(Record)
            .where(Record.table_id == table_id)
            .order_by(Record.position.asc(), Record.created_at.desc(), Record.id.asc())
        )
        rows = list((await self.session.execute(stmt)).scalars().all())
        changed = False
        for idx, rec in enumerate(rows):
            if rec.position != idx:
                rec.position = idx
                changed = True
        if changed:
            await self.session.flush()
