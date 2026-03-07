import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    org_name: str = Field(min_length=1, max_length=255)
    # If present, registration will attach the user to an existing organization
    # with the role from the invite. org_name is ignored in that case.
    invite_token: str | None = None
    # Legal requirement: explicit consent is mandatory.
    accepted_privacy_policy: Literal[True]


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str | None = None


class UpdateMeRequest(BaseModel):
    first_name: str | None = Field(default=None, min_length=1, max_length=100)
    last_name: str | None = Field(default=None, min_length=1, max_length=100)
    timezone: str | None = Field(default=None, min_length=1, max_length=50)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int


class UserResponse(BaseModel):
    id: uuid.UUID
    email: str
    first_name: str
    last_name: str
    is_active: bool
    timezone: str
    created_at: datetime

    model_config = {"from_attributes": True}


class UserWithOrgsResponse(UserResponse):
    memberships: list["MembershipInfo"] = []


class MembershipInfo(BaseModel):
    org_id: uuid.UUID
    org_name: str
    org_slug: str
    role: str

    model_config = {"from_attributes": True}
