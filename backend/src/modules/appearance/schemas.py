from pydantic import BaseModel, Field


class AppearanceRead(BaseModel):
    mode: str
    accent: str
    custom_enabled: bool
    primary_h: float
    primary_s: float
    primary_l: float
    radius: float

    model_config = {"from_attributes": True}


class AppearanceUpdate(BaseModel):
    mode: str | None = Field(None, pattern="^(dark|light)$")
    accent: str | None = Field(None, max_length=32)
    custom_enabled: bool | None = None
    primary_h: float | None = Field(None, ge=0, le=360)
    primary_s: float | None = Field(None, ge=0, le=100)
    primary_l: float | None = Field(None, ge=0, le=100)
    radius: float | None = Field(None, ge=0, le=2)
