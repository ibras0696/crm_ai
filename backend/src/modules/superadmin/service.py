"""Facade service for superadmin module."""

from src.modules.superadmin.services import (
    SuperadminAuthService,
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
    ):
        self.auth = auth_service or SuperadminAuthService()
        self.overview = overview_service or SuperadminOverviewService()
        self.orgs = orgs_service or SuperadminOrgsService()
        self.tables = tables_service or SuperadminTablesService()
