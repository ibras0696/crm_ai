import enum


class UserRole(str, enum.Enum):
    SUPERADMIN = "superadmin"
    OWNER = "owner"
    ADMIN = "admin"
    MANAGER = "manager"
    EMPLOYEE = "employee"
    READONLY = "readonly"


class InviteStatus(str, enum.Enum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    EXPIRED = "expired"
    CANCELLED = "cancelled"


class PlanTier(str, enum.Enum):
    FREE = "free"
    TEAM = "team"
    BUSINESS = "business"


class SubscriptionStatus(str, enum.Enum):
    ACTIVE = "active"
    PAST_DUE = "past_due"
    CANCELLED = "cancelled"
    TRIALING = "trialing"


class AuditAction(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    LOGIN = "login"
    LOGOUT = "logout"
    INVITE_SENT = "invite_sent"
    INVITE_ACCEPTED = "invite_accepted"
    ROLE_CHANGED = "role_changed"
    EXPORT = "export"
    AI_QUERY = "ai_query"


class NotificationType(str, enum.Enum):
    IN_APP = "in_app"
    EMAIL = "email"


class NotificationStatus(str, enum.Enum):
    PENDING = "pending"
    SENT = "sent"
    READ = "read"
    FAILED = "failed"
