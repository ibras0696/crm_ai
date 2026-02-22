import uuid
from datetime import datetime

from pydantic import BaseModel


class PageOut(BaseModel):
    """Schema for knowledge base page response."""

    id: uuid.UUID
    parent_id: uuid.UUID | None
    title: str
    slug: str
    content: str | None
    icon: str | None
    position: int
    is_published: bool
    created_at: datetime

    model_config = {"from_attributes": True}


class CreatePageRequest(BaseModel):
    """Schema for creating knowledge base page."""

    title: str
    content: str | None = None
    parent_id: uuid.UUID | None = None
    icon: str | None = None

    model_config = {"extra": "forbid"}


class UpdatePageRequest(BaseModel):
    """Schema for partial update of knowledge base page."""

    title: str | None = None
    content: str | None = None
    parent_id: uuid.UUID | None = None
    icon: str | None = None
    position: int | None = None
    is_published: bool | None = None

    model_config = {"extra": "forbid"}
