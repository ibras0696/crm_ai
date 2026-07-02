import logging

from fastapi import APIRouter, Depends, Query, Request

from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.auth.dependencies import CurrentUser, require_org
from src.modules.calls.models import CallRoomStatus
from src.modules.calls.schemas import (
    CallHistoryOut,
    CreateRoomRequest,
    InviteToCallRequest,
    JoinRoomResponse,
    MuteParticipantRequest,
    RecordingStatusOut,
    RoomOut,
)
from src.modules.calls.service import CallsService

router = APIRouter(prefix="/calls", tags=["calls"])
logger = logging.getLogger(__name__)


@router.post("/rooms", response_model=ApiResponse[RoomOut])
async def create_room(
    body: CreateRoomRequest,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        room = await service.create_room(user=current_user, req=body)
        await uow.commit()
        await uow.session.refresh(room)
        item = RoomOut.model_validate(room)
    return ApiResponse(data=item)


@router.get("/rooms", response_model=ApiResponse[list[RoomOut]])
async def list_rooms(
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        rooms = await service.list_rooms(user=current_user, status=CallRoomStatus.active)
        items = [RoomOut.model_validate(r) for r in rooms]
    return ApiResponse(data=items)


@router.get("/rooms/{slug}", response_model=ApiResponse[RoomOut])
async def get_room(
    slug: str,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        room = await service.get_room(user=current_user, slug=slug)
        item = RoomOut.model_validate(room)
    return ApiResponse(data=item)


@router.delete("/rooms/{slug}", response_model=ApiResponse[None])
async def delete_room(
    slug: str,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        await service.delete_room(user=current_user, slug=slug)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/rooms/{slug}/join", response_model=ApiResponse[JoinRoomResponse])
async def join_room(
    slug: str,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        room, token = await service.join_room(user=current_user, slug=slug)
        await uow.commit()
        await uow.session.refresh(room)
        room_out = RoomOut.model_validate(room)
    response = JoinRoomResponse(
        livekit_token=token,
        livekit_url=settings.LIVEKIT_PUBLIC_URL,
        room=room_out,
    )
    return ApiResponse(data=response)


@router.post("/rooms/{slug}/leave", response_model=ApiResponse[None])
async def leave_room(
    slug: str,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        await service.leave_room(user=current_user, slug=slug)
        await uow.commit()
    return ApiResponse(data=None)


@router.post("/webhook", response_model=ApiResponse[None])
async def livekit_webhook(request: Request):
    body = await request.body()
    auth_header = request.headers.get("Authorization", "")
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        await service.handle_webhook(body=body, auth_header=auth_header)
        await uow.commit()
    return ApiResponse(data=None)


@router.get("/history", response_model=ApiResponse[list[CallHistoryOut]])
async def get_history(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        items = await service.get_history(user=current_user, limit=limit, offset=offset)
    return ApiResponse(data=items)


@router.post("/rooms/{slug}/participants/{identity}/mute", response_model=ApiResponse[None])
async def mute_participant(
    slug: str,
    identity: str,
    body: MuteParticipantRequest,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        await service.mute_participant(
            user=current_user, slug=slug, identity=identity, source=body.source
        )
    return ApiResponse(data=None)


@router.post("/rooms/{slug}/invite", response_model=ApiResponse[None])
async def invite_to_room(
    slug: str,
    body: InviteToCallRequest,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        await service.invite_users(user=current_user, slug=slug, user_ids=body.user_ids)
    return ApiResponse(data=None)


@router.post("/rooms/{slug}/recording/start", response_model=ApiResponse[RecordingStatusOut])
async def start_recording(
    slug: str,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        result = await service.start_recording(user=current_user, slug=slug)
        await uow.commit()
    return ApiResponse(data=result)


@router.post("/rooms/{slug}/recording/stop", response_model=ApiResponse[RecordingStatusOut])
async def stop_recording(
    slug: str,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        result = await service.stop_recording(user=current_user, slug=slug)
        await uow.commit()
    return ApiResponse(data=result)


@router.get("/rooms/{slug}/recording", response_model=ApiResponse[RecordingStatusOut])
async def get_recording(
    slug: str,
    current_user: CurrentUser = Depends(require_org),
):
    async with UnitOfWork() as uow:
        service = CallsService(uow.session)
        result = await service.get_recording_status(user=current_user, slug=slug)
    return ApiResponse(data=result)
