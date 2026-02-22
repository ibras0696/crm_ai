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


class SetOrgAIEnabledRequest(BaseModel):
    enabled: bool


class SuperadminPlanChangeResponse(BaseModel):
    org_id: str
    plan: str


class SuperadminOrgAIEnabledResponse(BaseModel):
    org_id: str
    ai_enabled: bool


class SuperadminAIUsageResetResponse(BaseModel):
    org_id: str
    scope: str
    removed_requests: int
    removed_tokens: int


class SuperadminDashboardTotals(BaseModel):
    orgs: int
    users: int
    tables: int
    records: int
    files: int
    storage_bytes: int
    ai_requests: int
    ai_tokens: int


class SuperadminRegistrationPoint(BaseModel):
    date: str
    count: int


class SuperadminOrgsByPlanPoint(BaseModel):
    plan: str
    count: int


class SuperadminDashboardResponse(BaseModel):
    totals: SuperadminDashboardTotals
    registrations_timeline: list[SuperadminRegistrationPoint]
    orgs_by_plan: list[SuperadminOrgsByPlanPoint]


class SuperadminOrgOption(BaseModel):
    id: str
    name: str
    slug: str
    plan: str
    created_at: str | None = None


class SuperadminOverviewResponse(BaseModel):
    dashboard: SuperadminDashboardResponse
    orgs: list[SuperadminOrgOption]
    generated_at: str


class SuperadminSubscriptionInfo(BaseModel):
    plan: str
    status: str
    current_period_start: str | None = None
    current_period_end: str | None = None
    external_id: str | None = None


class SuperadminOrgListItem(BaseModel):
    id: str
    name: str
    slug: str
    plan: str
    created_at: str | None = None
    members: int
    tables: int
    records: int
    subscription: SuperadminSubscriptionInfo | None = None


class SuperadminOrgListPage(BaseModel):
    items: list[SuperadminOrgListItem]
    total: int
    limit: int
    offset: int


class SuperadminPlanLimits(BaseModel):
    name: str
    display_name: str
    price_monthly: int
    price_yearly: int
    max_members: int
    max_tables: int
    max_records: int
    max_storage_mb: int
    has_ai: bool
    ai_max_tokens_per_request: int
    ai_tokens_per_day: int
    ai_rpm_per_user: int


class SuperadminOrgUsage(BaseModel):
    members: int
    tables: int
    records: int
    files: int
    storage_bytes: int


class SuperadminOrgInfo(BaseModel):
    id: str
    name: str
    slug: str
    plan: str
    ai_enabled: bool
    created_at: str | None = None


class SuperadminAIUsageToday(BaseModel):
    tokens_used: int


class SuperadminOrgDetail(BaseModel):
    org: SuperadminOrgInfo
    subscription: SuperadminSubscriptionInfo | None = None
    plan_limits: SuperadminPlanLimits | None = None
    usage: SuperadminOrgUsage
    ai_usage_today: SuperadminAIUsageToday


class SuperadminOrgMemberUser(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    is_active: bool
    created_at: str | None = None


class SuperadminOrgMemberMembership(BaseModel):
    id: str
    role: str
    created_at: str | None = None


class SuperadminOrgMemberItem(BaseModel):
    user: SuperadminOrgMemberUser
    membership: SuperadminOrgMemberMembership


class SuperadminOrgMembersPage(BaseModel):
    items: list[SuperadminOrgMemberItem]
    total: int
    limit: int
    offset: int


class SuperadminUserListItem(BaseModel):
    id: str
    email: str
    first_name: str
    last_name: str
    is_active: bool
    created_at: str | None = None
    orgs: list[dict]


class SuperadminUserListPage(BaseModel):
    items: list[SuperadminUserListItem]
    total: int
    limit: int
    offset: int


class SuperadminAuditItem(BaseModel):
    id: str
    org_id: str
    org_name: str
    actor_id: str | None = None
    action: str
    entity_type: str
    entity_id: str | None = None
    meta: dict | None = None
    ip_address: str | None = None
    correlation_id: str | None = None
    created_at: str | None = None


class SuperadminAuditPage(BaseModel):
    items: list[SuperadminAuditItem]
    total: int
    limit: int
    offset: int


class SuperadminTableListItem(BaseModel):
    id: str
    org_id: str
    folder_id: str | None = None
    name: str
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    is_archived: bool
    created_at: str | None = None
    columns: int
    records: int


class SuperadminTableListPage(BaseModel):
    items: list[SuperadminTableListItem]
    total: int
    limit: int
    offset: int


class SuperadminTableDetail(BaseModel):
    id: str
    org_id: str
    folder_id: str | None = None
    name: str
    description: str | None = None
    icon: str | None = None
    color: str | None = None
    is_archived: bool
    created_at: str | None = None
    columns: list[dict]


class SuperadminRecordItem(BaseModel):
    id: str
    table_id: str
    data: dict
    created_by: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
    position: int


class SuperadminRecordListPage(BaseModel):
    items: list[SuperadminRecordItem]
    total: int
    limit: int
    offset: int
