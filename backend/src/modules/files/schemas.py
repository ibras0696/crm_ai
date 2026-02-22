import uuid
from datetime import datetime

from pydantic import BaseModel


class FileItem(BaseModel):
    """File DTO for API responses."""

    id: uuid.UUID
    org_id: uuid.UUID
    uploaded_by: uuid.UUID | None
    filename: str
    original_name: str
    content_type: str
    size: int
    created_at: datetime

    model_config = {"from_attributes": True}
