import uuid
from datetime import datetime

from pydantic import BaseModel, EmailStr, Field

from src.common.enums import InviteStatus, PlanTier, UserRole


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
    user_avatar_url: str | None = None
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
    # True when invited email already belongs to registered user.
    invitee_exists: bool | None = None
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


class OrgAIOrgLimitsRequest(BaseModel):
    daily_tokens_limit: int = Field(ge=0, default=0)
    monthly_tokens_limit: int = Field(ge=0, default=0)


class OrgAIUserLimitRequest(BaseModel):
    daily_tokens_limit: int = Field(ge=0, default=0)
    rpm_limit: int = Field(ge=0, default=0)


class OrgAIUserLimitItem(BaseModel):
    user_id: uuid.UUID
    membership_id: uuid.UUID
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    role: UserRole
    daily_tokens_limit: int
    rpm_limit: int
    usage_today_tokens: int
    usage_month_tokens: int
    usage_last_min_requests: int


class OrgAILimitsResponse(BaseModel):
    org_limits: dict
    effective_defaults: dict
    users: list[OrgAIUserLimitItem]
