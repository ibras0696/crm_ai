"""Pydantic schemas for schedule module."""

import uuid
from datetime import datetime

from pydantic import BaseModel


class EventOut(BaseModel):
    id: uuid.UUID
    title: str
    description: str | None
    start_at: datetime
    end_at: datetime | None
    all_day: bool
    color: str | None
    is_done: bool
    recurrence: str | None
    assigned_to: uuid.UUID | None
    participant_ids: list[uuid.UUID]
    reminder_offsets_minutes: list[int]
    created_at: datetime
    model_config = {"from_attributes": True}


class CreateEventRequest(BaseModel):
    title: str
    description: str | None = None
    start_at: datetime
    end_at: datetime | None = None
    all_day: bool = False
    color: str | None = None
    assigned_to: uuid.UUID | None = None
    participant_ids: list[uuid.UUID] | None = None
    reminder_offsets_minutes: list[int] | None = None
    # Can be a simple keyword (daily/weekly/...) or an RRULE string (e.g. "RRULE:FREQ=WEEKLY;BYDAY=TU").
    recurrence: str | None = None


class UpdateEventRequest(BaseModel):
    title: str | None = None
    description: str | None = None
    start_at: datetime | None = None
    end_at: datetime | None = None
    all_day: bool | None = None
    color: str | None = None
    is_done: bool | None = None
    assigned_to: uuid.UUID | None = None
    participant_ids: list[uuid.UUID] | None = None
    reminder_offsets_minutes: list[int] | None = None
    recurrence: str | None = None


class DispatchRemindersRequest(BaseModel):
    now: datetime | None = None


class DispatchRemindersOut(BaseModel):
    created_notifications: int
