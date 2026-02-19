"""AI API routes."""

import uuid

import httpx
from fastapi import APIRouter, Depends
from sqlalchemy import func, select

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.models import AIChatMessage, AIChatSession, AIUsageLog
from src.modules.ai.schemas import (
    ChatMessageOut,
    ChatRequest,
    ChatResponse,
    ChatSessionOut,
    ContextEstimateRequest,
    CreateChatRequest,
)
from src.modules.ai.service import (
    build_messages,
    build_org_context,
    call_openai_compatible_api,
    extract_action_payload,
    get_or_create_session,
    handle_create_dashboard_action,
)
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.modules.knowledge.models import KBPage
from src.modules.tables.models import Table
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/chat", response_model=ApiResponse[ChatResponse])
async def ai_chat(
    body: ChatRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    bearer_token = settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY
    if not bearer_token:
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_NOT_CONFIGURED", "message": "AI API token is not configured. Set OPENAI_BEARER_TOKEN in .env"},
        )

    system_prompt = body.system_prompt or settings.AI_SYSTEM_PROMPT
    context_options = body.context_options or {}

    async with UnitOfWork() as uow:
        session = await get_or_create_session(uow, current_user.org_id, current_user.user_id, body.chat_id, body.message)
        db_messages = (
            await uow.session.execute(
                select(AIChatMessage)
                .where(
                    AIChatMessage.session_id == session.id,
                    AIChatMessage.org_id == current_user.org_id,
                    AIChatMessage.user_id == current_user.user_id,
                )
                .order_by(AIChatMessage.created_at.asc())
                .limit(60)
            )
        ).scalars().all()

    org_context = ""
    context_meta: dict | None = None
    if body.include_context:
        org_context, context_meta = await build_org_context(current_user.org_id, context_options)

    history_rows = [{"role": m.role, "content": m.content} for m in body.history]
    messages = build_messages(system_prompt, org_context, db_messages, history_rows, body.message)

    try:
        data = await call_openai_compatible_api(settings.AI_BASE_URL, bearer_token, settings.OPENAI_MODEL, messages)
        reply_raw = data["choices"][0]["message"]["content"]
        action_payload, reply = extract_action_payload(reply_raw)
        usage = data.get("usage", {})

        async with UnitOfWork() as uow:
            session = await get_or_create_session(uow, current_user.org_id, current_user.user_id, body.chat_id, body.message)
            user_msg = AIChatMessage(
                session_id=session.id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={"include_context": body.include_context, "context_options": context_options},
            )
            assistant_msg = AIChatMessage(
                session_id=session.id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="assistant",
                content=reply,
                token_count=int(usage.get("total_tokens", 0) or 0),
                meta={"action_requested": bool(action_payload)},
            )
            uow.session.add(user_msg)
            uow.session.add(assistant_msg)
            uow.session.add(
                AIUsageLog(
                    org_id=current_user.org_id,
                    user_id=current_user.user_id,
                    model=settings.OPENAI_MODEL,
                    prompt_tokens=int(usage.get("prompt_tokens", 0) or 0),
                    completion_tokens=int(usage.get("completion_tokens", 0) or 0),
                    total_tokens=int(usage.get("total_tokens", 0) or 0),
                    message_preview=body.message[:200],
                )
            )

            action_result = None
            if action_payload and action_payload.get("action") == "create_dashboard":
                action_result = await handle_create_dashboard_action(uow, current_user.org_id, current_user.user_id, action_payload)
                assistant_msg.meta = {"action_requested": True, "action_result": action_result}

            await uow.commit()

        return ApiResponse(
            data=ChatResponse(
                reply=reply,
                model=settings.OPENAI_MODEL,
                usage=usage,
                chat_id=str(session.id),
                context_estimate=context_meta,
                action_result=action_result,
            )
        )
    except httpx.HTTPStatusError as e:
        body_text = ""
        try:
            body_text = e.response.text[:300]
        except Exception:
            pass
        return ApiResponse(ok=False, data=None, error={"code": "AI_ERROR", "message": f"AI API error {e.response.status_code}: {body_text}"})
    except Exception as e:
        return ApiResponse(ok=False, data=None, error={"code": "AI_ERROR", "message": f"AI error: {str(e)}"})


@router.get("/status", response_model=ApiResponse[dict])
async def ai_status(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    configured = bool(settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY)
    async with UnitOfWork() as uow:
        row = (
            await uow.session.execute(
                select(
                    func.count(AIUsageLog.id),
                    func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
                    func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
                    func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
                ).where(AIUsageLog.org_id == current_user.org_id)
            )
        ).one()
    return ApiResponse(
        data={
            "configured": configured,
            "stats": {
                "total_requests": row[0],
                "total_tokens": row[1],
                "prompt_tokens": row[2],
                "completion_tokens": row[3],
            },
        }
    )


@router.get("/usage", response_model=ApiResponse[list[dict]])
async def ai_usage_detail(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN)),
):
    async with UnitOfWork() as uow:
        rows = (
            await uow.session.execute(
                select(
                    AIUsageLog.user_id,
                    func.count(AIUsageLog.id).label("requests"),
                    func.sum(AIUsageLog.total_tokens).label("tokens"),
                )
                .where(AIUsageLog.org_id == current_user.org_id)
                .group_by(AIUsageLog.user_id)
                .order_by(func.sum(AIUsageLog.total_tokens).desc())
            )
        ).all()
    return ApiResponse(data=[{"user_id": str(r.user_id), "requests": r.requests, "tokens": int(r.tokens or 0)} for r in rows])


@router.get("/chats", response_model=ApiResponse[list[ChatSessionOut]])
async def ai_chats(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        sessions = (
            await uow.session.execute(
                select(AIChatSession)
                .where(AIChatSession.org_id == current_user.org_id, AIChatSession.user_id == current_user.user_id)
                .order_by(AIChatSession.updated_at.desc())
            )
        ).scalars().all()
        out: list[ChatSessionOut] = []
        for session in sessions:
            last = (
                await uow.session.execute(
                    select(AIChatMessage).where(AIChatMessage.session_id == session.id).order_by(AIChatMessage.created_at.desc()).limit(1)
                )
            ).scalar_one_or_none()
            out.append(
                ChatSessionOut(
                    id=str(session.id),
                    title=session.title,
                    created_at=session.created_at,
                    updated_at=session.updated_at,
                    last_message_preview=(last.content[:80] if last else None),
                )
            )
    return ApiResponse(data=out)


@router.post("/chats", response_model=ApiResponse[ChatSessionOut])
async def ai_create_chat(
    body: CreateChatRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    title = (body.title or "\u041d\u043e\u0432\u044b\u0439 \u0447\u0430\u0442").strip()[:255] or "\u041d\u043e\u0432\u044b\u0439 \u0447\u0430\u0442"
    async with UnitOfWork() as uow:
        session = AIChatSession(org_id=current_user.org_id, user_id=current_user.user_id, title=title)
        uow.session.add(session)
        await uow.session.flush()
        await uow.commit()
        out = ChatSessionOut(
            id=str(session.id),
            title=session.title,
            created_at=session.created_at,
            updated_at=session.updated_at,
            last_message_preview=None,
        )
    return ApiResponse(data=out)


@router.delete("/chats/{chat_id}", response_model=ApiResponse[None])
async def ai_delete_chat(
    chat_id: str,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": "Invalid chat id"})

    async with UnitOfWork() as uow:
        session = (
            await uow.session.execute(
                select(AIChatSession).where(
                    AIChatSession.id == chat_uuid,
                    AIChatSession.org_id == current_user.org_id,
                    AIChatSession.user_id == current_user.user_id,
                )
            )
        ).scalar_one_or_none()
        if not session:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Chat not found"})
        await uow.session.delete(session)
        await uow.commit()
    return ApiResponse(data=None)


@router.get("/chats/{chat_id}/messages", response_model=ApiResponse[list[ChatMessageOut]])
async def ai_chat_messages(
    chat_id: str,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    try:
        chat_uuid = uuid.UUID(chat_id)
    except ValueError:
        return ApiResponse(ok=False, data=None, error={"code": "INVALID_ID", "message": "Invalid chat id"})

    async with UnitOfWork() as uow:
        session = (
            await uow.session.execute(
                select(AIChatSession).where(
                    AIChatSession.id == chat_uuid,
                    AIChatSession.org_id == current_user.org_id,
                    AIChatSession.user_id == current_user.user_id,
                )
            )
        ).scalar_one_or_none()
        if not session:
            return ApiResponse(ok=False, data=None, error={"code": "NOT_FOUND", "message": "Chat not found"})
        rows = (
            await uow.session.execute(
                select(AIChatMessage).where(AIChatMessage.session_id == chat_uuid).order_by(AIChatMessage.created_at.asc())
            )
        ).scalars().all()
    return ApiResponse(
        data=[
            ChatMessageOut(
                id=str(m.id),
                role=m.role,
                content=m.content,
                token_count=m.token_count,
                created_at=m.created_at,
                meta=m.meta,
            )
            for m in rows
        ]
    )


@router.post("/context-estimate", response_model=ApiResponse[dict])
async def ai_context_estimate(
    body: ContextEstimateRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    if not body.include_context:
        return ApiResponse(
            data={
                "enabled": False,
                "sources": {
                    "kb": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                    "table_schema": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                    "table_records": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                },
                "selected": {"kb_pages": [], "tables": []},
                "model_overhead_tokens": 0,
                "estimated_total_tokens": 0,
            }
        )
    _, meta = await build_org_context(current_user.org_id, body.context_options)
    return ApiResponse(data=meta)


@router.get("/context-sources", response_model=ApiResponse[dict])
async def ai_context_sources(
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    async with UnitOfWork() as uow:
        kb_rows = (
            await uow.session.execute(
                select(KBPage)
                .where(KBPage.org_id == current_user.org_id, KBPage.is_published.is_(True))
                .order_by(KBPage.position.asc())
                .limit(300)
            )
        ).scalars().all()
        tables = (
            await uow.session.execute(
                select(Table)
                .where(Table.org_id == current_user.org_id, Table.is_archived.is_(False))
                .options(selectinload(Table.columns))
                .order_by(Table.created_at.desc())
                .limit(200)
            )
        ).scalars().all()
    return ApiResponse(
        data={
            "kb_pages": [{"id": str(p.id), "title": p.title} for p in kb_rows],
            "tables": [
                {
                    "id": str(t.id),
                    "name": t.name,
                    "columns": [{"id": str(c.id), "name": c.name} for c in sorted(t.columns, key=lambda x: x.position)],
                }
                for t in tables
            ],
        }
    )
