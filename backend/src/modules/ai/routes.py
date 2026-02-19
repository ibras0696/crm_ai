"""AI Agent — Grok/OpenAI chat endpoint with token tracking."""
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select, func

from src.common.schemas import ApiResponse
from src.common.enums import UserRole
from src.config import settings
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.common.base_model import BaseDBModel
from sqlalchemy import ForeignKey, String, Text, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import Mapped, mapped_column
from src.infrastructure.uow import UnitOfWork
from src.modules.knowledge.models import KBPage
from src.modules.tables.models import Table, Column
from src.modules.tables.records import Record
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/ai", tags=["ai"])


# --- Token usage model ---
class AIUsageLog(BaseDBModel):
    __tablename__ = "ai_usage_logs"

    org_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("organizations.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    message_preview: Mapped[str | None] = mapped_column(Text, nullable=True)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: list[ChatMessage] = []
    system_prompt: str | None = None
    include_context: bool = True  # auto-inject org knowledge & tables


class ChatResponse(BaseModel):
    reply: str
    model: str
    usage: dict | None = None


@router.post("/chat", response_model=ApiResponse[ChatResponse])
async def ai_chat(
    body: ChatRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Send message to xAI Grok (or OpenAI-compatible API)."""
    api_key = settings.OPENAI_API_KEY
    if not api_key:
        return ApiResponse(ok=False, data=None, error={"code": "AI_NOT_CONFIGURED", "message": "AI API ключ не настроен. Добавьте OPENAI_API_KEY в .env"})

    import httpx

    system_prompt = body.system_prompt or settings.AI_SYSTEM_PROMPT

    # --- Build organization context ---
    org_context = ""
    if body.include_context:
        org_context = await _build_org_context(current_user.org_id)

    messages = [{"role": "system", "content": system_prompt}]
    if org_context:
        messages.append({"role": "system", "content": f"Контекст организации пользователя (используй для ответов):\n\n{org_context}"})
    for m in body.history[-10:]:
        messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": body.message})

    base_url = settings.AI_BASE_URL
    model = settings.OPENAI_MODEL

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={"model": model, "messages": messages, "max_tokens": 2000, "temperature": 0.7},
            )
            resp.raise_for_status()
            data = resp.json()
            reply = data["choices"][0]["message"]["content"]
            usage = data.get("usage", {})

            # Log token usage
            async with UnitOfWork() as uow:
                log = AIUsageLog(
                    org_id=current_user.org_id,
                    user_id=current_user.user_id,
                    model=model,
                    prompt_tokens=usage.get("prompt_tokens", 0),
                    completion_tokens=usage.get("completion_tokens", 0),
                    total_tokens=usage.get("total_tokens", 0),
                    message_preview=body.message[:200],
                )
                uow.session.add(log)
                await uow.commit()

            return ApiResponse(data=ChatResponse(reply=reply, model=model, usage=usage))
    except httpx.HTTPStatusError as e:
        body_text = ""
        try:
            body_text = e.response.text[:300]
        except Exception:
            pass
        return ApiResponse(ok=False, data=None, error={"code": "AI_ERROR", "message": f"AI API ошибка {e.response.status_code}: {body_text}"})
    except Exception as e:
        return ApiResponse(ok=False, data=None, error={"code": "AI_ERROR", "message": f"Ошибка AI: {str(e)}"})


async def _build_org_context(org_id: uuid.UUID) -> str:
    """Fetch KB pages + table schemas + sample records for the org."""
    parts: list[str] = []
    try:
        async with UnitOfWork() as uow:
            # Knowledge base
            kb_stmt = select(KBPage).where(KBPage.org_id == org_id, KBPage.is_published == True).order_by(KBPage.position).limit(30)
            kb_rows = (await uow.session.execute(kb_stmt)).scalars().all()
            if kb_rows:
                parts.append("=== БАЗА ЗНАНИЙ ===")
                for p in kb_rows:
                    content_preview = (p.content or "")[:500]
                    parts.append(f"--- {p.title} ---\n{content_preview}")

            # Tables structure + sample data
            tbl_stmt = (
                select(Table)
                .where(Table.org_id == org_id, Table.is_archived == False)
                .options(selectinload(Table.columns))
                .limit(20)
            )
            tbl_rows = (await uow.session.execute(tbl_stmt)).scalars().all()
            if tbl_rows:
                parts.append("\n=== ТАБЛИЦЫ ===")
                for t in tbl_rows:
                    col_names = [c.name for c in sorted(t.columns, key=lambda c: c.position)]
                    parts.append(f"Таблица: {t.name} | Колонки: {', '.join(col_names)}")
                    # Sample records (up to 5)
                    rec_stmt = select(Record).where(Record.table_id == t.id).limit(5)
                    recs = (await uow.session.execute(rec_stmt)).scalars().all()
                    if recs:
                        col_map = {str(c.id): c.name for c in t.columns}
                        for rec in recs:
                            row_parts = []
                            for cid, val in (rec.data or {}).items():
                                cname = col_map.get(cid, cid[:8])
                                row_parts.append(f"{cname}={val}")
                            parts.append(f"  Запись: {', '.join(row_parts[:10])}")
    except Exception:
        pass  # Don't break chat if context fails
    return "\n".join(parts)[:4000]  # Cap at 4000 chars to save tokens


@router.get("/status", response_model=ApiResponse[dict])
async def ai_status(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    """Check if AI is configured + token stats for org."""
    configured = bool(settings.OPENAI_API_KEY)
    async with UnitOfWork() as uow:
        stmt = select(
            func.count(AIUsageLog.id),
            func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
            func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
        ).where(AIUsageLog.org_id == current_user.org_id)
        row = (await uow.session.execute(stmt)).one()
    return ApiResponse(data={
        "configured": configured,
        "model": settings.OPENAI_MODEL,
        "base_url": settings.AI_BASE_URL,
        "system_prompt": settings.AI_SYSTEM_PROMPT,
        "stats": {
            "total_requests": row[0],
            "total_tokens": row[1],
            "prompt_tokens": row[2],
            "completion_tokens": row[3],
        },
    })


@router.get("/usage", response_model=ApiResponse[list[dict]])
async def ai_usage_detail(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    """Detailed per-user token usage for org."""
    async with UnitOfWork() as uow:
        stmt = (
            select(
                AIUsageLog.user_id,
                func.count(AIUsageLog.id).label("requests"),
                func.sum(AIUsageLog.total_tokens).label("tokens"),
            )
            .where(AIUsageLog.org_id == current_user.org_id)
            .group_by(AIUsageLog.user_id)
            .order_by(func.sum(AIUsageLog.total_tokens).desc())
        )
        rows = (await uow.session.execute(stmt)).all()
        result = [{"user_id": str(r.user_id), "requests": r.requests, "tokens": int(r.tokens or 0)} for r in rows]
    return ApiResponse(data=result)
