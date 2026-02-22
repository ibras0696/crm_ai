import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from src.common.enums import InviteStatus, PlanTier, SubscriptionStatus, UserRole


class OrgResponse(BaseModel):
    id: uuid.UUID
    name: str
    slug: str
    plan: PlanTier
    created_at: datetime

    model_config = {"from_attributes": True}


class MemberResponse(BaseModel):
    id: uuid.UUID
    user_id: uuid.UUID
    org_id: uuid.UUID
    role: UserRole
    user_email: str | None = None
    user_first_name: str | None = None
    user_last_name: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class InviteCreateRequest(BaseModel):
    email: EmailStr
    role: UserRole = UserRole.EMPLOYEE


class InviteResponse(BaseModel):
    id: uuid.UUID
    org_id: uuid.UUID
    email: str
    role: UserRole
    status: InviteStatus
    # Token is returned only to OWNER/ADMIN endpoints (invite creation/resend),
    # so they can copy/share an invite link if needed.
    token: str | None = None
    expires_at: datetime
    created_at: datetime

    model_config = {"from_attributes": True}


class AcceptInviteRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)


class UpdateMemberRoleRequest(BaseModel):
    role: UserRole


class SwitchOrgRequest(BaseModel):
    org_id: uuid.UUID


class OrgUpdateRequest(BaseModel):
    name: str | None = None
