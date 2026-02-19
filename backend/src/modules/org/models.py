import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, Text, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from src.common.base_model import BaseDBModel
from src.common.enums import InviteStatus, PlanTier, SubscriptionStatus, UserRole


class Organization(BaseDBModel):
    __tablename__ = "organizations"

    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False, index=True)
    plan: Mapped[PlanTier] = mapped_column(Enum(PlanTier, values_callable=lambda x: [e.value for e in x]), default=PlanTier.FREE, server_default=text("'free'"))

    memberships: Mapped[list["Membership"]] = relationship(back_populates="organization", lazy="selectin")
    invites: Mapped[list["Invite"]] = relationship(back_populates="organization", lazy="noload")
    subscription: Mapped["Subscription | None"] = relationship(back_populates="organization", uselist=False, lazy="selectin")


class Membership(BaseDBModel):
    __tablename__ = "memberships"

    user_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, values_callable=lambda x: [e.value for e in x]), default=UserRole.EMPLOYEE, nullable=False)

    user: Mapped["User"] = relationship(back_populates="memberships")
    organization: Mapped["Organization"] = relationship(back_populates="memberships")

    __table_args__ = (
        {"comment": "User membership in an organization with role"},
    )


class Invite(BaseDBModel):
    __tablename__ = "invites"

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, values_callable=lambda x: [e.value for e in x]), default=UserRole.EMPLOYEE, nullable=False)
    status: Mapped[InviteStatus] = mapped_column(Enum(InviteStatus, values_callable=lambda x: [e.value for e in x]), default=InviteStatus.PENDING, server_default=text("'pending'"))
    token: Mapped[str] = mapped_column(String(512), unique=True, nullable=False)
    invited_by: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)

    organization: Mapped["Organization"] = relationship(back_populates="invites")


class Subscription(BaseDBModel):
    __tablename__ = "subscriptions"

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), unique=True, nullable=False)
    plan: Mapped[PlanTier] = mapped_column(Enum(PlanTier, values_callable=lambda x: [e.value for e in x]), default=PlanTier.FREE, nullable=False)
    status: Mapped[SubscriptionStatus] = mapped_column(Enum(SubscriptionStatus, values_callable=lambda x: [e.value for e in x]), default=SubscriptionStatus.ACTIVE, nullable=False)
    current_period_start: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    current_period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)

    organization: Mapped["Organization"] = relationship(back_populates="subscription")


# Import for relationship resolution
from src.modules.auth.models import User  # noqa: E402
