"""AI API routes."""

import uuid

import httpx
from fastapi import APIRouter, Depends
from datetime import datetime, timezone
from sqlalchemy import func, select

from src.common.enums import UserRole
from src.common.schemas import ApiResponse
from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.infrastructure.metrics_custom import AI_REQUESTS_TOTAL, AI_TOKENS_TOTAL
from src.modules.ai.limits import check_ai_limits, resolve_org_plan
from src.modules.ai.models import AIChatMessage, AIChatSession, AIUsageLog
from src.modules.billing.models import Plan
from src.modules.ai.schemas import (
    ChatMessageOut,
    ChatRequest,
    ChatResponse,
    ChatSessionOut,
    ContextEstimateRequest,
    CreateChatRequest,
)
from src.modules.ai.service import (
    estimate_tokens,
    build_messages,
    build_org_context_for_user,
    call_openai_compatible_api,
    extract_action_payload,
    handle_create_columns_action,
    handle_create_records_action,
    get_or_create_session,
    handle_create_dashboard_action,
    handle_create_table_action,
    handle_create_schedule_event_action,
    handle_create_kb_page_action,
)
from src.modules.ai.intent_overrides import apply_ui_intent_overrides
from src.modules.auth.dependencies import CurrentUser, require_roles
from src.common.enums import PlanTier
from src.modules.org.models import Organization
from src.modules.knowledge.models import KBPage
from src.modules.schedule.models import Event
from src.modules.tables.models import Table
from sqlalchemy.orm import selectinload

router = APIRouter(prefix="/ai", tags=["ai"])


async def _execute_action(
    uow: UnitOfWork,
    current_user: CurrentUser,
    action_payload: dict,
    user_message: str,
) -> dict | None:
    action_name = str(action_payload.get("action") or "").strip()
    if action_name == "create_dashboard":
        return await handle_create_dashboard_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_table":
        return await handle_create_table_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_columns":
        return await handle_create_columns_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_records":
        return await handle_create_records_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_schedule_event":
        return await handle_create_schedule_event_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    if action_name == "create_kb_page":
        return await handle_create_kb_page_action(
            uow,
            current_user.org_id,
            current_user.user_id,
            action_payload,
            user_message=user_message,
        )
    return None


@router.post("/chat", response_model=ApiResponse[ChatResponse])
async def ai_chat(
    body: ChatRequest,
    current_user: CurrentUser = Depends(require_roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.EMPLOYEE)),
):
    if not settings.ENABLE_AI:
        return ApiResponse(ok=False, data=None, error={"code": "AI_DISABLED", "message": "AI отключен администратором."})

    bearer_token = settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY
    if not bearer_token:
        return ApiResponse(
            ok=False,
            data=None,
            error={"code": "AI_NOT_CONFIGURED", "message": "AI API token is not configured. Set OPENAI_BEARER_TOKEN in .env"},
        )

    system_prompt = body.system_prompt or settings.AI_SYSTEM_PROMPT
    if body.ui_intent:
        intent = str(body.ui_intent).strip()
        params = body.ui_intent_params if isinstance(body.ui_intent_params, dict) else {}
        widget_type = str(params.get("widget_type") or "").strip()
        system_prompt = (
            system_prompt
            + "\n\n"
            + "UI_INTENT (подсказка от интерфейса):\n"
            + f"- intent: {intent}\n"
            + (f"- widget_type: {widget_type}\n" if widget_type else "")
            + "\nПравила:\n"
            + "- Это только подсказка. Выполняй действие ТОЛЬКО если текст пользователя реально просит это сделать.\n"
            + "- Если пользователь пишет привет/спасибо/вопрос не по теме выбранного действия, просто ответь и НЕ добавляй ```crm_action```.\n"
            + "- Если действие требует уточнений, задай 1-2 вопроса вместо выполнения.\n"
        )
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
        org_context, context_meta = await build_org_context_for_user(current_user.org_id, current_user.user_id, context_options)

    max_tokens_per_request = int(settings.AI_MAX_TOKENS_PER_REQUEST)
    estimated_prompt_tokens = estimate_tokens(body.message) + estimate_tokens(org_context) + 280
    estimated_request_tokens = int(estimated_prompt_tokens + max_tokens_per_request)
    async with UnitOfWork() as uow:
        ok, err = await check_ai_limits(
            uow.session,
            org_id=current_user.org_id,
            user_id=current_user.user_id,
            estimated_request_tokens=estimated_request_tokens,
        )
        if not ok:
            return ApiResponse(ok=False, data=None, error=err)

    history_rows = [{"role": m.role, "content": m.content} for m in body.history]
    messages = build_messages(system_prompt, org_context, db_messages, history_rows, body.message)

    direct_action_payload, cleaned_direct_reply = extract_action_payload(body.message)
    if direct_action_payload:
        async with UnitOfWork() as uow:
            session = await get_or_create_session(uow, current_user.org_id, current_user.user_id, body.chat_id, body.message)
            action_result = await _execute_action(uow, current_user, direct_action_payload, body.message)

            user_msg = AIChatMessage(
                session_id=session.id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="user",
                content=body.message,
                token_count=None,
                meta={"include_context": body.include_context, "context_options": context_options, "direct_action": True},
            )
            assistant_reply = cleaned_direct_reply or "Команда выполнена."
            assistant_msg = AIChatMessage(
                session_id=session.id,
                org_id=current_user.org_id,
                user_id=current_user.user_id,
                role="assistant",
                content=assistant_reply,
                token_count=0,
                meta={"action_requested": True, "action_result": action_result, "direct_action": True},
            )
            uow.session.add(user_msg)
            uow.session.add(assistant_msg)
            await uow.commit()

        return ApiResponse(
            data=ChatResponse(
                reply=assistant_reply,
                model=settings.OPENAI_MODEL,
                usage={"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0},
                chat_id=str(session.id),
                context_estimate=context_meta,
                action_result=action_result,
            )
        )

    try:
        data = await call_openai_compatible_api(
            settings.AI_BASE_URL,
            bearer_token,
            settings.OPENAI_MODEL,
            messages,
            max_tokens=max_tokens_per_request,
        )
        reply_raw = data["choices"][0]["message"]["content"]
        action_payload, reply = extract_action_payload(reply_raw)
        action_payload = apply_ui_intent_overrides(action_payload, body.ui_intent, body.ui_intent_params)
        usage = data.get("usage") if isinstance(data.get("usage"), dict) else {}
        # Some providers don't return usage. Use an estimate so stats/limits make sense.
        if not usage or not int(usage.get("total_tokens", 0) or 0):
            prompt_text = "\n".join([str(m.get("content") or "") for m in messages])
            prompt_tokens_est = int(estimate_tokens(prompt_text))
            completion_tokens_est = int(estimate_tokens(reply_raw))
            usage = {
                "prompt_tokens": prompt_tokens_est,
                "completion_tokens": completion_tokens_est,
                "total_tokens": prompt_tokens_est + completion_tokens_est,
                "estimated": True,
            }

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
            if action_payload:
                action_result = await _execute_action(uow, current_user, action_payload, body.message)
                if action_result is not None:
                    assistant_msg.meta = {"action_requested": True, "action_result": action_result}

            await uow.commit()

        try:
            AI_REQUESTS_TOTAL.labels(model=settings.OPENAI_MODEL, status="ok").inc()
            AI_TOKENS_TOTAL.labels(model=settings.OPENAI_MODEL).inc(float(int(usage.get("total_tokens", 0) or 0)))
        except Exception:
            pass

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
        if e.response.status_code in (401, 403):
            try:
                AI_REQUESTS_TOTAL.labels(model=settings.OPENAI_MODEL, status="unauthorized").inc()
            except Exception:
                pass
            return ApiResponse(
                ok=False,
                data=None,
                error={
                    "code": "AI_PROVIDER_UNAUTHORIZED",
                    "message": (
                        f"AI провайдер вернул {e.response.status_code} (Unauthorized). "
                        "Проверьте OPENAI_BEARER_TOKEN/OPENAI_API_KEY и AI_BASE_URL (secrets.yml), затем перезапустите backend. "
                        f"Ответ провайдера: {body_text}"
                    ),
                },
            )
        try:
            AI_REQUESTS_TOTAL.labels(model=settings.OPENAI_MODEL, status="error").inc()
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
    now = datetime.now(timezone.utc)
    day_start = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    async with UnitOfWork() as uow:
        plan_tier = await resolve_org_plan(uow.session, org_id=current_user.org_id)
        plan = plan_tier.value
        plan_db = (
            await uow.session.execute(select(Plan).where(Plan.name == plan, Plan.is_active.is_(True)))
        ).scalars().first()

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
        today = (
            await uow.session.execute(
                select(
                    func.count(AIUsageLog.id),
                    func.coalesce(func.sum(AIUsageLog.total_tokens), 0),
                    func.coalesce(func.sum(AIUsageLog.prompt_tokens), 0),
                    func.coalesce(func.sum(AIUsageLog.completion_tokens), 0),
                ).where(AIUsageLog.org_id == current_user.org_id, AIUsageLog.created_at >= day_start)
            )
        ).one()

    daily_limit_by_plan = {
        PlanTier.FREE.value: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_FREE", 0) or 0),
        PlanTier.TEAM.value: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_TEAM", 0) or 0),
        PlanTier.BUSINESS.value: int(getattr(settings, "AI_MAX_TOKENS_PER_DAY_BUSINESS", 0) or 0),
    }
    rpm_limit_by_plan = {
        PlanTier.FREE.value: int(getattr(settings, "AI_RPM_PER_USER_FREE", 0) or 0),
        PlanTier.TEAM.value: int(getattr(settings, "AI_RPM_PER_USER_TEAM", 0) or 0),
        PlanTier.BUSINESS.value: int(getattr(settings, "AI_RPM_PER_USER_BUSINESS", 0) or 0),
    }
    daily_limit = daily_limit_by_plan.get(plan) or int(settings.AI_MAX_TOKENS_PER_DAY_PER_ORG or 0)
    rpm_limit = rpm_limit_by_plan.get(plan) or int(settings.AI_RPM_PER_USER or 0)

    # Prefer DB plan settings (admin-editable).
    if plan_db:
        if int(getattr(plan_db, "ai_tokens_per_day", 0) or 0) > 0:
            daily_limit = int(plan_db.ai_tokens_per_day)
        if int(getattr(plan_db, "ai_rpm_per_user", 0) or 0) > 0:
            rpm_limit = int(plan_db.ai_rpm_per_user)
        max_tokens_per_req = int(getattr(plan_db, "ai_max_tokens_per_request", 0) or 0) or int(settings.AI_MAX_TOKENS_PER_REQUEST)
    else:
        max_tokens_per_req = int(settings.AI_MAX_TOKENS_PER_REQUEST)
    return ApiResponse(
        data={
            "enabled": bool(settings.ENABLE_AI),
            "configured": configured,
            "plan": plan,
            "stats": {
                "total_requests": row[0],
                "total_tokens": row[1],
                "prompt_tokens": row[2],
                "completion_tokens": row[3],
            },
            "today": {
                "requests": today[0],
                "total_tokens": today[1],
                "prompt_tokens": today[2],
                "completion_tokens": today[3],
            },
            "limits": {
                "daily_tokens": int(daily_limit),
                "rpm_per_user": int(rpm_limit),
                "max_tokens_per_request": int(max_tokens_per_req),
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
    title = (body.title or "Новый чат").strip()[:255] or "Новый чат"
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
                    "schedule": {"enabled": False, "chars": 0, "estimated_tokens": 0},
                },
                "selected": {"kb_pages": [], "tables": [], "schedule_events": []},
                "model_overhead_tokens": 0,
                "max_context_tokens": 0,
                "used_context_tokens": 0,
                "context_truncated": False,
                "estimated_prompt_tokens": 0,
                "prompt_message_overhead_tokens": 0,
                "estimated_total_tokens": 0,
            }
        )
    org_context, meta = await build_org_context_for_user(current_user.org_id, current_user.user_id, body.context_options)

    # Estimate prompt tokens for the next request (context + system + history + user message).
    system_prompt = body.system_prompt or settings.AI_SYSTEM_PROMPT
    user_message = body.user_message or ""
    history = [{"role": h.role, "content": h.content} for h in (body.history or [])][-10:]

    prompt_messages = build_messages(system_prompt, org_context, db_messages=[], history=history, user_message=user_message)
    # Approximate message framing overhead.
    message_overhead = 4 * len(prompt_messages) + 2
    content_joined = "\n".join((m.get("content") or "") for m in prompt_messages)
    estimated_prompt_tokens = estimate_tokens(content_joined) + message_overhead

    meta["prompt_message_overhead_tokens"] = int(message_overhead)
    meta["estimated_prompt_tokens"] = int(estimated_prompt_tokens)
    # Backwards-compat: keep estimated_total_tokens as "prompt estimate".
    meta["estimated_total_tokens"] = int(estimated_prompt_tokens)
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
        schedule_events = (
            await uow.session.execute(
                select(Event)
                .where(Event.org_id == current_user.org_id)
                .order_by(Event.start_at.desc())
                .limit(300)
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
            "schedule_events": [
                {
                    "id": str(ev.id),
                    "title": ev.title,
                    "start_at": ev.start_at.isoformat() if ev.start_at else None,
                    "recurrence": ev.recurrence,
                }
                for ev in schedule_events
            ],
        }
    )
