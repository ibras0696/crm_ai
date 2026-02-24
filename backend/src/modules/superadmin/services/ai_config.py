from __future__ import annotations

from sqlalchemy import select

from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.models import AIRuntimeSettings


class SuperadminAIConfigService:
    """Use-cases для runtime-настроек AI."""

    @staticmethod
    async def get_config() -> dict:
        async with UnitOfWork() as uow:
            row = (await uow.session.execute(select(AIRuntimeSettings).limit(1))).scalars().first()

        base_url = (settings.AI_BASE_URL or "").rstrip("/")
        provider = "timeweb-agent-openai-compatible" if "agent.timeweb.cloud" in base_url else "openai-compatible"
        key = settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY or ""
        return {
            "provider": provider,
            "base_url": base_url,
            "official_provider_docs_url": "https://agent.timeweb.cloud/docs",
            "model": settings.OPENAI_MODEL,
            "key_configured": bool(key),
            "key_prefix": f"{key[:4]}***" if key else "",
            "runtime": {
                "model": (row.model.strip() if row and row.model else settings.OPENAI_MODEL),
                "system_prompt": (row.system_prompt if row and row.system_prompt else settings.AI_SYSTEM_PROMPT),
                "temperature": float(row.temperature if row else 0.3),
                "max_tokens_per_request": int(row.max_tokens_per_request if row else settings.AI_MAX_TOKENS_PER_REQUEST),
                "strict_actions": bool(row.strict_actions if row else True),
            },
        }

    @staticmethod
    async def update_config(payload: dict) -> dict:
        allowed = {"model", "system_prompt", "temperature", "max_tokens_per_request", "strict_actions"}
        updates = {k: v for k, v in payload.items() if k in allowed and v is not None}
        async with UnitOfWork() as uow:
            row = (await uow.session.execute(select(AIRuntimeSettings).limit(1))).scalars().first()
            if row is None:
                row = AIRuntimeSettings()
                uow.session.add(row)
                await uow.session.flush()

            if "model" in updates:
                row.model = str(updates["model"]).strip()
            if "system_prompt" in updates:
                row.system_prompt = str(updates["system_prompt"]).strip()
            if "temperature" in updates:
                row.temperature = float(updates["temperature"])
            if "max_tokens_per_request" in updates:
                row.max_tokens_per_request = int(updates["max_tokens_per_request"])
            if "strict_actions" in updates:
                row.strict_actions = bool(updates["strict_actions"])

            await uow.commit()

        return await SuperadminAIConfigService.get_config()
