"""Pydantic schemas for superadmin module."""

from pydantic import BaseModel


class SuperadminLoginRequest(BaseModel):
    email: str
    password: str


class SuperadminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SetPlanRequest(BaseModel):
    plan: str = "free"
