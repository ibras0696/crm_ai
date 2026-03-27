"""Central API router registration."""

from fastapi import APIRouter

from src.modules.access.routes import router as access_router
from src.modules.ai.routes import router as ai_router
from src.modules.audit.routes import router as audit_router
from src.modules.auth.routes import router as auth_router
from src.modules.billing.routes import router as billing_router
from src.modules.chat.routes import router as chat_router
from src.modules.docs.routes import router as docs_router
from src.modules.files.routes import router as files_router
from src.modules.knowledge.routes import router as kb_router
from src.modules.notifications.routes import router as notif_router
from src.modules.notifications.ws import router as ws_router
from src.modules.org.routes import router as org_router
from src.modules.reports.routes import router as reports_router
from src.modules.schedule.routes import router as schedule_router
from src.modules.superadmin.routes import router as superadmin_router
from src.modules.tables.routes import router as tables_router

router = APIRouter(prefix="/api/v1")
router.include_router(auth_router)
router.include_router(org_router)
router.include_router(audit_router)
router.include_router(files_router)
router.include_router(docs_router)
router.include_router(notif_router)
router.include_router(ws_router)
router.include_router(tables_router)
router.include_router(kb_router)
router.include_router(reports_router)
router.include_router(billing_router)
router.include_router(chat_router)
router.include_router(ai_router)
router.include_router(schedule_router)
router.include_router(access_router)
router.include_router(superadmin_router)
