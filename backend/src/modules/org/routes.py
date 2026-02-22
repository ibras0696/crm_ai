import uuid

from fastapi import APIRouter, Depends, Request

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.modules.auth.dependencies import CurrentUser, get_current_user, require_org, require_roles
from src.modules.org.schemas import (
    AcceptInviteRequest,
    InviteCreateRequest,
    InviteResponse,
    MemberResponse,
    OrgResponse,
    SwitchOrgRequest,
    UpdateMemberRoleRequest,
)
from src.modules.org.service import OrgService

router = APIRouter(prefix="/orgs", tags=["organizations"])

_org_service = OrgService()


@router.get("/current", response_model=ApiResponse[OrgResponse])
async def get_current_org(current_user: CurrentUser = Depends(require_org)):
    org = await _org_service.get_org(current_user.org_id)
    return ApiResponse(data=OrgResponse.model_validate(org))


@router.delete("/current", response_model=ApiResponse)
async def delete_current_org(current_user: CurrentUser = Depends(require_roles(UserRole.OWNER))):
    await _org_service.delete_org(current_user.org_id)
    return ApiResponse(data=None)


@router.get("/my", response_model=ApiResponse[list[dict]])
async def get_my_orgs(current_user: CurrentUser = Depends(get_current_user)):
    orgs = await _org_service.get_user_orgs(current_user.user_id)
    return ApiResponse(data=orgs)


@router.post("/switch", response_model=ApiResponse[dict])
async def switch_org(body: SwitchOrgRequest, current_user: CurrentUser = Depends(get_current_user)):
    tokens = await _org_service.switch_org(current_user.user_id, body.org_id)
    return ApiResponse(data=tokens)


@router.get("/members", response_model=ApiResponse[list[MemberResponse]])
async def list_members(current_user: CurrentUser = Depends(require_org)):
    memberships = await _org_service.get_members(current_user.org_id)
    result = []
    for m in memberships:
        result.append(MemberResponse(
            id=m.id,
            user_id=m.user_id,
            org_id=m.org_id,
            role=m.role,
            user_email=m.user.email if m.user else None,
            user_first_name=m.user.first_name if m.user else None,
            user_last_name=m.user.last_name if m.user else None,
            created_at=m.created_at,
        ))
    return ApiResponse(data=result)


@router.post("/invites", response_model=ApiResponse[InviteResponse], status_code=201)
async def create_invite(
    body: InviteCreateRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    ip = request.client.host if request.client else None
    invite = await _org_service.create_invite(
        org_id=current_user.org_id,
        email=body.email,
        role=body.role,
        invited_by=current_user.user_id,
        ip_address=ip,
    )
    return ApiResponse(data=InviteResponse.model_validate(invite))


@router.post("/invites/accept", response_model=ApiResponse[dict])
async def accept_invite(body: AcceptInviteRequest, request: Request):
    ip = request.client.host if request.client else None
    user, tokens = await _org_service.accept_invite(
        token=body.token,
        password=body.password,
        first_name=body.first_name,
        last_name=body.last_name,
        ip_address=ip,
    )
    return ApiResponse(data=tokens)

@router.post("/invites/{invite_id}/resend", response_model=ApiResponse[InviteResponse])
async def resend_invite(
    invite_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    ip = request.client.host if request.client else None
    invite = await _org_service.resend_invite(
        org_id=current_user.org_id,
        invite_id=invite_id,
        actor_id=current_user.user_id,
        ip_address=ip,
    )
    return ApiResponse(data=InviteResponse.model_validate(invite))


@router.put("/members/{membership_id}/role", response_model=ApiResponse)
async def update_member_role(
    membership_id: uuid.UUID,
    body: UpdateMemberRoleRequest,
    request: Request,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    ip = request.client.host if request.client else None
    await _org_service.update_member_role(
        org_id=current_user.org_id,
        membership_id=membership_id,
        new_role=body.role,
        actor_id=current_user.user_id,
        ip_address=ip,
    )
    return ApiResponse(data=None)


@router.delete("/members/{membership_id}", response_model=ApiResponse)
async def remove_member(
    membership_id: uuid.UUID,
    request: Request,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    ip = request.client.host if request.client else None
    await _org_service.remove_member(
        org_id=current_user.org_id,
        membership_id=membership_id,
        actor_id=current_user.user_id,
        ip_address=ip,
    )
    return ApiResponse(data=None)
