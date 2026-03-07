"""Pydantic schemas for superadmin module."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field, model_validator


class SuperadminLoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)


class SuperadminTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SuperadminProfileAuditItem(BaseModel):
    id: str
    created_at: str | None = None
    actor: str
    ip_address: str | None = None
    changed_fields: list[str]
    meta: dict | None = None


class SuperadminProfileResponse(BaseModel):
    email: str
    password_configured: bool
    runtime_email_overridden: bool
    runtime_password_overridden: bool
    audit: list[SuperadminProfileAuditItem] = Field(default_factory=list)


class SuperadminUpdateProfileRequest(BaseModel):
    email: EmailStr | None = None
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str | None = Field(default=None, min_length=8, max_length=128)

    @model_validator(mode="after")
    def _validate_update(self) -> "SuperadminUpdateProfileRequest":
        if self.email is None and self.new_password is None:
            raise ValueError("set at least one: email or new_password")
        return self


class SetPlanRequest(BaseModel):
    plan: str = "free"


class SetOrgAIEnabledRequest(BaseModel):
    enabled: bool


class SuperadminPlanChangeResponse(BaseModel):
    org_id: str
    plan: str


class SetSubscriptionPeriodRequest(BaseModel):
    plan: str = "free"
    period_days: int | None = Field(default=None, ge=1, le=3650)
    current_period_end: datetime | None = None

    @model_validator(mode="after")
    def _validate_period(self) -> "SetSubscriptionPeriodRequest":
        if (self.period_days is None) == (self.current_period_end is None):
            raise ValueError("set exactly one: period_days or current_period_end")
        return self


class SuperadminSubscriptionPeriodResponse(BaseModel):
    org_id: str
    plan: str
    status: str
    current_period_start: str | None = None
    current_period_end: str | None = None


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
    analytics: dict = Field(default_factory=dict)


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


class SuperadminBillingPlanItem(BaseModel):
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
    is_active: bool


class SuperadminTokenPackageItem(BaseModel):
    code: str
    display_name: str
    badge_text: str | None = None
    description: str | None = None
    button_text: str | None = None
    payment_note: str | None = None
    price_caption: str | None = None
    tokens: int
    price_rub_cents: int
    is_active: bool
    sort_order: int


class SuperadminTokenPurchaseItem(BaseModel):
    id: str
    org_id: str
    org_name: str
    package_code: str
    tokens_total: int
    tokens_remaining: int
    payment_id: str | None = None
    payment_status: str | None = None
    status: str
    is_active: bool
    created_at: str | None = None
    expires_at: str | None = None


class SuperadminYooKassaAuditItem(BaseModel):
    id: str
    created_at: str | None = None
    actor: str
    ip_address: str | None = None
    changed_fields: list[str]
    meta: dict | None = None


class SuperadminYooKassaConfig(BaseModel):
    shop_id: str
    return_url: str
    webhook_url: str
    secret_key_configured: bool
    secret_key_masked: str
    audit: list[SuperadminYooKassaAuditItem] = Field(default_factory=list)


class SuperadminBillingConfigResponse(BaseModel):
    plans: list[SuperadminBillingPlanItem]
    token_packages: list[SuperadminTokenPackageItem]
    recent_purchases: list[SuperadminTokenPurchaseItem]
    yookassa: SuperadminYooKassaConfig


class SuperadminUpdateBillingPlanRequest(BaseModel):
    display_name: str | None = None
    price_monthly: int | None = Field(default=None, ge=0)
    price_yearly: int | None = Field(default=None, ge=0)
    max_members: int | None = Field(default=None, ge=1)
    max_tables: int | None = Field(default=None, ge=1)
    max_records: int | None = Field(default=None, ge=1)
    max_storage_mb: int | None = Field(default=None, ge=1)
    has_ai: bool | None = None
    ai_max_tokens_per_request: int | None = Field(default=None, ge=0)
    ai_tokens_per_day: int | None = Field(default=None, ge=0)
    ai_rpm_per_user: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class SuperadminUpsertTokenPackageRequest(BaseModel):
    display_name: str | None = None
    badge_text: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=4000)
    button_text: str | None = Field(default=None, max_length=120)
    payment_note: str | None = Field(default=None, max_length=4000)
    price_caption: str | None = Field(default=None, max_length=255)
    tokens: int | None = Field(default=None, ge=1)
    price_rub_cents: int | None = Field(default=None, ge=0)
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0)


class SuperadminUpdateYooKassaRequest(BaseModel):
    yookassa_shop_id: str | None = Field(default=None, max_length=255)
    # Пустая строка = удалить runtime-secret и вернуться к fallback из env.
    yookassa_secret_key: str | None = Field(default=None, max_length=4000)
    yookassa_return_url: str | None = Field(default=None, max_length=2000)
    yookassa_webhook_url: str | None = Field(default=None, max_length=2000)


class SuperadminUpdateAIConfigRequest(BaseModel):
    model: str | None = Field(default=None, min_length=1, max_length=120)
    ai_base_url: str | None = Field(default=None, max_length=1000)
    ai_provider_mode: str | None = Field(default=None, pattern="^(openai_compatible|timeweb_native)$")
    # Пустая строка = очистить runtime-token и вернуться к fallback из env.
    ai_bearer_token: str | None = Field(default=None, max_length=4000)
    system_prompt: str | None = Field(default=None, min_length=1, max_length=12000)
    temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    max_tokens_per_request: int | None = Field(default=None, ge=64, le=12000)
    strict_actions: bool | None = None
