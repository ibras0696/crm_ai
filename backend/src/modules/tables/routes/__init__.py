"""Router aggregation for tables module."""

from fastapi import APIRouter

from src.modules.tables.routes.core import router as core_router
from src.modules.tables.routes.query import router as query_router
from src.modules.tables.routes.records import router as records_router
from src.modules.tables.routes.views import router as views_router

router = APIRouter()
router.include_router(core_router)
router.include_router(records_router)
router.include_router(views_router)
router.include_router(query_router)
