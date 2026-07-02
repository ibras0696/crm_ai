import logging
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.exceptions import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from src.config import settings
from src.modules.auth.dependencies import CurrentUser
from src.modules.calls.livekit_service import livekit_service
from src.modules.calls.models import CallRole, CallRoom, CallRoomStatus
from src.modules.calls.repository import CallsRepository
from src.modules.calls.schemas import CallHistoryOut, CreateRoomRequest, RecordingStatusOut

logger = logging.getLogger(__name__)


async def _get_user_display(session: AsyncSession, user_id: uuid.UUID) -> tuple[str | None, str | None]:
    """Return (display_name, avatar_url) for a user. Never raises."""
    try:
        from src.modules.auth.models import User

        result = await session.execute(select(User).where(User.id == user_id).limit(1))
        user = result.scalar_one_or_none()
        if user is None:
            return None, None
        name_parts = [p for p in (user.first_name, user.last_name) if p]
        display_name = " ".join(name_parts) if name_parts else None
        return display_name, user.avatar_url
    except Exception:
        return None, None


class CallsService:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.repo = CallsRepository(session)

    async def create_room(self, *, user: CurrentUser, req: CreateRoomRequest) -> CallRoom:
        if not user.org_id:
            raise ForbiddenError("No organization context")
        slug = secrets.token_urlsafe(8)
        return await self.repo.create_room(
            org_id=user.org_id,
            host_id=user.user_id,
            slug=slug,
            title=req.title,
            max_participants=req.max_participants,
        )

    async def join_room(self, *, user: CurrentUser, slug: str) -> tuple[CallRoom, str]:
        if not user.org_id:
            raise ForbiddenError("No organization context")
        room = await self.repo.get_room_by_slug(slug=slug, org_id=user.org_id)
        if room is None:
            raise NotFoundError("CallRoom")
        if room.status == CallRoomStatus.ended:
            raise BadRequestError("Call has already ended")

        is_host = room.host_id == user.user_id
        role = CallRole.host if is_host else CallRole.participant

        # Check if user is already an active participant
        existing = await self.repo.list_participants(room_id=room.id)
        already_in = any(p.user_id == user.user_id and p.left_at is None for p in existing)
        if already_in:
            display_name, avatar_url = await _get_user_display(self.session, user.user_id)
            token = livekit_service.create_join_token(
                slug=slug,
                org_id=str(user.org_id),
                user_id=str(user.user_id),
                is_host=is_host,
                display_name=display_name,
                avatar_url=avatar_url,
            )
            return room, token

        # Enforce max_participants limit
        active_count = sum(1 for p in existing if p.left_at is None)
        if active_count >= room.max_participants:
            raise BadRequestError(f"Room is full (max {room.max_participants} participants)")

        now = datetime.now(UTC)
        await self.repo.add_participant(
            room_id=room.id,
            user_id=user.user_id,
            org_id=user.org_id,
            role=role,
            joined_at=now,
        )

        # Activate room on first join
        if room.status == CallRoomStatus.waiting:
            await self.repo.update_room_status(
                room_id=room.id,
                status=CallRoomStatus.active,
                started_at=now,
            )

        display_name, avatar_url = await _get_user_display(self.session, user.user_id)
        token = livekit_service.create_join_token(
            slug=slug,
            org_id=str(user.org_id),
            user_id=str(user.user_id),
            is_host=is_host,
            display_name=display_name,
            avatar_url=avatar_url,
        )

        # Notify host that someone joined (if not the host themselves)
        if not is_host:
            from src.modules.notifications.ws import manager as ws_manager

            await ws_manager.send_personal_message(
                {
                    "type": "call.participant.joined",
                    "room_slug": slug,
                    "room_title": room.title,
                    "user_id": str(user.user_id),
                },
                room.host_id,
            )

        return room, token

    async def leave_room(self, *, user: CurrentUser, slug: str) -> None:
        if not user.org_id:
            raise ForbiddenError("No organization context")
        room = await self.repo.get_room_by_slug(slug=slug, org_id=user.org_id)
        if room is None:
            raise NotFoundError("CallRoom")

        left_at = datetime.now(UTC)
        participants = await self.repo.list_participants(room_id=room.id)
        joined_at = None
        for p in participants:
            if p.user_id == user.user_id and p.left_at is None:
                joined_at = p.joined_at
                break

        duration_seconds = 0
        if joined_at is not None:
            delta = left_at - joined_at
            duration_seconds = max(0, int(delta.total_seconds()))

        await self.repo.update_participant_left(
            room_id=room.id,
            user_id=user.user_id,
            left_at=left_at,
            duration_seconds=duration_seconds,
        )

        # Auto-end room when last participant leaves
        if room.status != CallRoomStatus.ended:
            remaining_active = sum(
                1 for p in participants
                if p.user_id != user.user_id and p.left_at is None
            )
            if remaining_active == 0:
                await self.repo.update_room_status(
                    room_id=room.id,
                    status=CallRoomStatus.ended,
                    ended_at=left_at,
                )

    async def get_room(self, *, user: CurrentUser, slug: str) -> CallRoom:
        if not user.org_id:
            raise ForbiddenError("No organization context")
        room = await self.repo.get_room_by_slug(slug=slug, org_id=user.org_id)
        if room is None:
            raise NotFoundError("CallRoom")
        return room

    async def delete_room(self, *, user: CurrentUser, slug: str) -> None:
        """Permanently remove a room (and its participants). Host only."""
        if not user.org_id:
            raise ForbiddenError("No organization context")
        room = await self.repo.get_room_by_slug(slug=slug, org_id=user.org_id)
        if room is None:
            raise NotFoundError("CallRoom")
        if room.host_id != user.user_id:
            raise ForbiddenError("Only the host can delete the call")
        await self.repo.delete_room(room_id=room.id)

    async def list_rooms(
        self,
        *,
        user: CurrentUser,
        status: CallRoomStatus | None = None,
    ) -> list[CallRoom]:
        if not user.org_id:
            raise ForbiddenError("No organization context")
        return await self.repo.list_rooms(org_id=user.org_id, status=status)

    async def handle_webhook(self, *, body: bytes, auth_header: str) -> None:
        try:
            event = livekit_service.verify_webhook(body, auth_header)
        except Exception as exc:
            logger.exception("livekit_webhook_verify_failed")
            raise BadRequestError("Invalid webhook signature") from exc

        # event is a livekit WebhookEvent protobuf object
        event_type = getattr(event, "event", None)
        lk_room = getattr(event, "room", None)
        lk_participant = getattr(event, "participant", None)

        if not event_type or lk_room is None:
            return

        livekit_room_name = getattr(lk_room, "name", None) or ""

        room = await self.repo.get_room_by_livekit_name(livekit_room_name=livekit_room_name)
        if room is None:
            logger.warning("livekit_webhook_room_not_found", extra={"livekit_room": livekit_room_name})
            return

        now = datetime.now(UTC)

        if event_type == "room_started":
            await self.repo.update_room_status(
                room_id=room.id,
                status=CallRoomStatus.active,
                started_at=now,
            )
        elif event_type == "room_finished":
            await self.repo.update_room_status(
                room_id=room.id,
                status=CallRoomStatus.ended,
                ended_at=now,
            )
        elif event_type == "participant_left" and lk_participant is not None:
            participant_identity = getattr(lk_participant, "identity", None) or ""
            try:
                participant_user_id = uuid.UUID(participant_identity)
            except ValueError:
                logger.warning(
                    "livekit_webhook_invalid_participant_identity",
                    extra={"identity": participant_identity},
                )
                return

            participants = await self.repo.list_participants(room_id=room.id)
            joined_at = None
            for p in participants:
                if p.user_id == participant_user_id and p.left_at is None:
                    joined_at = p.joined_at
                    break

            duration_seconds = 0
            if joined_at is not None:
                delta = now - joined_at
                duration_seconds = max(0, int(delta.total_seconds()))

            await self.repo.update_participant_left(
                room_id=room.id,
                user_id=participant_user_id,
                left_at=now,
                duration_seconds=duration_seconds,
            )

    async def get_history(
        self,
        *,
        user: CurrentUser,
        limit: int = 50,
        offset: int = 0,
    ) -> list[CallHistoryOut]:
        if not user.org_id:
            raise ForbiddenError("No organization context")
        pairs = await self.repo.get_user_history(
            org_id=user.org_id,
            user_id=user.user_id,
            limit=limit,
            offset=offset,
        )
        result = []
        for room, participant in pairs:
            # Compute room duration
            duration_seconds = None
            if room.started_at and room.ended_at:
                delta = room.ended_at - room.started_at
                duration_seconds = max(0, int(delta.total_seconds()))

            participant_count = await self.repo.count_participants(room_id=room.id)

            result.append(
                CallHistoryOut(
                    id=room.id,
                    slug=room.slug,
                    title=room.title,
                    status=room.status,
                    host_id=room.host_id,
                    started_at=room.started_at,
                    ended_at=room.ended_at,
                    duration_seconds=duration_seconds,
                    participant_count=participant_count,
                    my_role=participant.role,
                    my_duration_seconds=participant.duration_seconds,
                    created_at=room.created_at,
                )
            )
        return result

    async def invite_users(
        self,
        *,
        user: CurrentUser,
        slug: str,
        user_ids: list[uuid.UUID],
    ) -> None:
        """Send WS notifications to invited users."""
        if not user.org_id:
            raise ForbiddenError("No organization context")
        room = await self.repo.get_room_by_slug(slug=slug, org_id=user.org_id)
        if room is None:
            raise NotFoundError("CallRoom")
        if room.status == CallRoomStatus.ended:
            raise BadRequestError("Call has already ended")

        from src.modules.notifications.ws import manager as ws_manager

        event = {
            "type": "call.incoming",
            "room_slug": slug,
            "room_title": room.title,
            "host_id": str(user.user_id),
            "org_id": str(user.org_id),
        }
        for invited_user_id in user_ids:
            await ws_manager.send_personal_message(event, invited_user_id)

    async def start_recording(self, *, user: CurrentUser, slug: str) -> RecordingStatusOut:
        from src.modules.calls.recording.egress import egress_service

        if not user.org_id:
            raise ForbiddenError("No organization context")
        room = await self.repo.get_room_by_slug(slug=slug, org_id=user.org_id)
        if room is None:
            raise NotFoundError("CallRoom")
        if room.host_id != user.user_id:
            raise ForbiddenError("Only the host can start recording")
        if room.status != CallRoomStatus.active:
            raise BadRequestError("Room must be active to start recording")
        if room.recording_enabled:
            raise ConflictError("Recording is already active")

        egress_id, file_key = await egress_service.start_room_recording(
            room_slug=slug, org_id=str(user.org_id)
        )
        await self.repo.set_recording_started(
            room_id=room.id, egress_id=egress_id, recording_file_key=file_key
        )
        return RecordingStatusOut(
            room_slug=slug,
            recording_enabled=True,
            egress_id=egress_id,
            recording_file_key=file_key,
            presigned_url=None,
        )

    async def stop_recording(self, *, user: CurrentUser, slug: str) -> RecordingStatusOut:
        from src.modules.calls.recording.egress import egress_service

        if not user.org_id:
            raise ForbiddenError("No organization context")
        room = await self.repo.get_room_by_slug(slug=slug, org_id=user.org_id)
        if room is None:
            raise NotFoundError("CallRoom")
        if room.host_id != user.user_id:
            raise ForbiddenError("Only the host can stop recording")
        if not room.recording_enabled or not room.egress_id:
            raise BadRequestError("No active recording")

        await egress_service.stop_recording(egress_id=room.egress_id)
        await self.repo.set_recording_stopped(room_id=room.id)
        return RecordingStatusOut(
            room_slug=slug,
            recording_enabled=False,
            egress_id=room.egress_id,
            recording_file_key=room.recording_file_key,
            presigned_url=None,
        )

    async def mute_participant(
        self,
        *,
        user: CurrentUser,
        slug: str,
        identity: str,
        source: str,
    ) -> None:
        """Host-only: force-mute a remote participant's audio or screen-share track."""
        if not user.org_id:
            raise ForbiddenError("No organization context")
        room = await self.repo.get_room_by_slug(slug=slug, org_id=user.org_id)
        if room is None:
            raise NotFoundError("CallRoom")
        if room.host_id != user.user_id:
            raise ForbiddenError("Only the host can mute participants")
        if room.status != CallRoomStatus.active:
            raise BadRequestError("Room is not active")

        from livekit.api import LiveKitAPI
        from livekit.protocol.room import ListParticipantsRequest, MuteRoomTrackRequest

        lk_url = settings.LIVEKIT_URL.replace("ws://", "http://").replace("wss://", "https://")
        room_name = f"{user.org_id}:{slug}"

        # source values in LiveKit proto: 1=CAMERA, 2=MICROPHONE, 3=SCREEN_SHARE
        target_sources = {2} if source == "audio" else {3}

        async with LiveKitAPI(
            url=lk_url,
            api_key=settings.LIVEKIT_API_KEY,
            api_secret=settings.LIVEKIT_API_SECRET,
        ) as api:
            result = await api.room.list_participants(ListParticipantsRequest(room=room_name))
            for p in result.participants:
                if p.identity == identity:
                    for track in p.tracks:
                        if track.source in target_sources:
                            await api.room.mute_published_track(
                                MuteRoomTrackRequest(
                                    room=room_name,
                                    identity=identity,
                                    track_sid=track.sid,
                                    muted=True,
                                )
                            )

    async def get_recording_status(self, *, user: CurrentUser, slug: str) -> RecordingStatusOut:
        if not user.org_id:
            raise ForbiddenError("No organization context")
        room = await self.repo.get_room_by_slug(slug=slug, org_id=user.org_id)
        if room is None:
            raise NotFoundError("CallRoom")

        # Generate presigned URL for download if file exists and recording has stopped
        presigned_url = None
        if room.recording_file_key and not room.recording_enabled:
            try:
                import asyncio

                import boto3
                from botocore.config import Config

                def _generate_url() -> str:
                    s3 = boto3.client(
                        "s3",
                        endpoint_url=settings.S3_ENDPOINT,
                        aws_access_key_id=settings.S3_ACCESS_KEY,
                        aws_secret_access_key=settings.S3_SECRET_KEY,
                        region_name=settings.S3_REGION,
                        config=Config(signature_version="s3v4"),
                    )
                    return s3.generate_presigned_url(
                        "get_object",
                        Params={"Bucket": settings.S3_BUCKET, "Key": room.recording_file_key},
                        ExpiresIn=3600,
                    )

                loop = asyncio.get_event_loop()
                presigned_url = await loop.run_in_executor(None, _generate_url)
            except Exception:
                logger.exception("failed_to_generate_presigned_url")

        return RecordingStatusOut(
            room_slug=slug,
            recording_enabled=room.recording_enabled,
            egress_id=room.egress_id,
            recording_file_key=room.recording_file_key,
            presigned_url=presigned_url,
        )
