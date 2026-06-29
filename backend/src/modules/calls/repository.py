import uuid
from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.calls.models import CallParticipant, CallRole, CallRoom, CallRoomStatus


class CallsRepository:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def create_room(
        self,
        *,
        org_id: uuid.UUID,
        host_id: uuid.UUID,
        slug: str,
        title: str | None,
        max_participants: int,
    ) -> CallRoom:
        room = CallRoom(
            org_id=org_id,
            host_id=host_id,
            slug=slug,
            title=title,
            max_participants=max_participants,
            status=CallRoomStatus.waiting,
        )
        self.session.add(room)
        await self.session.flush()
        return room

    async def get_room_by_slug(self, *, slug: str, org_id: uuid.UUID) -> CallRoom | None:
        stmt = select(CallRoom).where(CallRoom.slug == slug, CallRoom.org_id == org_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_room_by_livekit_name(self, *, livekit_room_name: str) -> CallRoom | None:
        """Parse '{org_id}:{slug}' and fetch the room."""
        parts = livekit_room_name.split(":", 1)
        if len(parts) != 2:
            return None
        org_id_str, slug = parts
        try:
            org_id = uuid.UUID(org_id_str)
        except ValueError:
            return None
        stmt = select(CallRoom).where(CallRoom.slug == slug, CallRoom.org_id == org_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_rooms(
        self,
        *,
        org_id: uuid.UUID,
        status: CallRoomStatus | None = None,
    ) -> list[CallRoom]:
        stmt = select(CallRoom).where(CallRoom.org_id == org_id)
        if status is not None:
            stmt = stmt.where(CallRoom.status == status)
        stmt = stmt.order_by(CallRoom.created_at.desc())
        return list((await self.session.execute(stmt)).scalars().all())

    async def update_room_status(
        self,
        *,
        room_id: uuid.UUID,
        status: CallRoomStatus,
        started_at: datetime | None = None,
        ended_at: datetime | None = None,
    ) -> None:
        values: dict = {"status": status}
        if started_at is not None:
            values["started_at"] = started_at
        if ended_at is not None:
            values["ended_at"] = ended_at
        stmt = update(CallRoom).where(CallRoom.id == room_id).values(**values)
        await self.session.execute(stmt, execution_options={"synchronize_session": False})

    async def add_participant(
        self,
        *,
        room_id: uuid.UUID,
        user_id: uuid.UUID,
        org_id: uuid.UUID,
        role: CallRole,
        joined_at: datetime,
    ) -> CallParticipant:
        participant = CallParticipant(
            room_id=room_id,
            user_id=user_id,
            org_id=org_id,
            role=role,
            joined_at=joined_at,
        )
        self.session.add(participant)
        await self.session.flush()
        return participant

    async def update_participant_left(
        self,
        *,
        room_id: uuid.UUID,
        user_id: uuid.UUID,
        left_at: datetime,
        duration_seconds: int,
    ) -> None:
        stmt = (
            update(CallParticipant)
            .where(
                CallParticipant.room_id == room_id,
                CallParticipant.user_id == user_id,
                CallParticipant.left_at.is_(None),
            )
            .values(left_at=left_at, duration_seconds=duration_seconds)
        )
        await self.session.execute(stmt, execution_options={"synchronize_session": False})

    async def list_participants(self, *, room_id: uuid.UUID) -> list[CallParticipant]:
        stmt = (
            select(CallParticipant)
            .where(CallParticipant.room_id == room_id)
            .order_by(CallParticipant.joined_at.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_user_history(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        limit: int = 50,
        offset: int = 0,
    ) -> list[tuple[CallRoom, CallParticipant]]:
        """Returns (room, participant) pairs for rooms this user participated in, newest first."""
        stmt = (
            select(CallRoom, CallParticipant)
            .join(CallParticipant, CallParticipant.room_id == CallRoom.id)
            .where(
                CallRoom.org_id == org_id,
                CallParticipant.user_id == user_id,
                # Show ended rooms + active rooms where user already left (tab close without leave)
                (CallRoom.status == CallRoomStatus.ended) | (CallParticipant.left_at.isnot(None)),
            )
            .order_by(CallRoom.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        rows = (await self.session.execute(stmt)).all()
        return [(row[0], row[1]) for row in rows]

    async def count_participants(self, *, room_id: uuid.UUID) -> int:
        from sqlalchemy import func

        stmt = select(func.count()).select_from(CallParticipant).where(CallParticipant.room_id == room_id)
        return (await self.session.execute(stmt)).scalar_one()

    async def set_recording_started(
        self, *, room_id: uuid.UUID, egress_id: str, recording_file_key: str
    ) -> None:
        stmt = (
            update(CallRoom)
            .where(CallRoom.id == room_id)
            .values(recording_enabled=True, egress_id=egress_id, recording_file_key=recording_file_key)
        )
        await self.session.execute(stmt, execution_options={"synchronize_session": False})

    async def set_recording_stopped(self, *, room_id: uuid.UUID) -> None:
        stmt = (
            update(CallRoom)
            .where(CallRoom.id == room_id)
            .values(recording_enabled=False)
        )
        await self.session.execute(stmt, execution_options={"synchronize_session": False})
