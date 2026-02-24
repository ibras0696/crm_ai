"""Facade service for superadmin module."""

from src.modules.superadmin.services import (
    SuperadminAIConfigService,
    SuperadminAuthService,
    SuperadminBillingService,
    SuperadminOrgsService,
    SuperadminOverviewService,
    SuperadminTablesService,
)


class SuperadminService:
    """High-level facade used by HTTP routes."""

    def __init__(
        self,
        *,
        auth_service: SuperadminAuthService | None = None,
        overview_service: SuperadminOverviewService | None = None,
        orgs_service: SuperadminOrgsService | None = None,
        tables_service: SuperadminTablesService | None = None,
        billing_service: SuperadminBillingService | None = None,
        ai_config_service: SuperadminAIConfigService | None = None,
    ):
        self.auth = auth_service or SuperadminAuthService()
        self.overview = overview_service or SuperadminOverviewService()
        self.orgs = orgs_service or SuperadminOrgsService()
        self.tables = tables_service or SuperadminTablesService()
        self.billing = billing_service or SuperadminBillingService()
        self.ai_config = ai_config_service or SuperadminAIConfigService()
