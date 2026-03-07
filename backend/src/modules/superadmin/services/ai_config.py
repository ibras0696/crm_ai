from __future__ import annotations

from sqlalchemy import select

from src.config import settings
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.internal.runtime_secrets import decrypt_runtime_secret, encrypt_runtime_secret, mask_runtime_secret
from src.modules.ai.models import AIRuntimeAudit, AIRuntimeSecret, AIRuntimeSettings


class SuperadminAIConfigService:
    """Use-cases для runtime-настроек AI."""

    @staticmethod
    def _normalize_provider_mode(value: str | None) -> str:
        mode = (value or "").strip().lower()
        if mode not in {"openai_compatible", "timeweb_native"}:
            return "openai_compatible"
        return mode

    @staticmethod
    def _detect_provider_label(base_url: str, provider_mode: str) -> str:
        if provider_mode == "timeweb_native":
            return "timeweb-native"
        if "agent.timeweb.cloud" in base_url:
            return "timeweb-agent-openai-compatible"
        return "openai-compatible"

    @staticmethod
    async def get_config() -> dict:
        async with UnitOfWork() as uow:
            row = (await uow.session.execute(select(AIRuntimeSettings).limit(1))).scalars().first()
            secret_row = (await uow.session.execute(select(AIRuntimeSecret).limit(1))).scalars().first()
            audits = (
                await uow.session.execute(select(AIRuntimeAudit).order_by(AIRuntimeAudit.created_at.desc()).limit(20))
            ).scalars().all()

        env_base_url = (settings.AI_BASE_URL or "").rstrip("/")
        runtime_base_url = (row.ai_base_url if row and row.ai_base_url else env_base_url).rstrip("/")
        runtime_provider_mode = SuperadminAIConfigService._normalize_provider_mode(
            row.ai_provider_mode if row else settings.AI_PROVIDER_MODE
        )

        env_token = (settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY or "").strip()
        runtime_token = decrypt_runtime_secret(secret_row.bearer_token_encrypted) if secret_row else ""
        effective_token = (runtime_token or env_token).strip()

        return {
            "provider": SuperadminAIConfigService._detect_provider_label(runtime_base_url, runtime_provider_mode),
            "base_url": runtime_base_url,
            "official_provider_docs_url": "https://agent.timeweb.cloud/docs",
            "model": settings.OPENAI_MODEL,
            "key_configured": bool(effective_token),
            "key_prefix": mask_runtime_secret(effective_token),
            "runtime": {
                "model": (row.model.strip() if row and row.model else settings.OPENAI_MODEL),
                "ai_base_url": runtime_base_url,
                "ai_provider_mode": runtime_provider_mode,
                "ai_bearer_token_masked": mask_runtime_secret(runtime_token) if runtime_token else "",
                "ai_bearer_token_configured": bool(runtime_token),
                "system_prompt": (row.system_prompt if row and row.system_prompt else settings.AI_SYSTEM_PROMPT),
                "temperature": float(row.temperature if row else 0.3),
                "max_tokens_per_request": int(row.max_tokens_per_request if row else settings.AI_MAX_TOKENS_PER_REQUEST),
                "strict_actions": bool(row.strict_actions if row else True),
            },
            "audit": [
                {
                    "id": str(item.id),
                    "created_at": item.created_at.isoformat() if item.created_at else None,
                    "actor": item.actor,
                    "ip_address": item.ip_address,
                    "changed_fields": item.changed_fields or [],
                    "meta": item.meta or {},
                }
                for item in audits
            ],
        }

    @staticmethod
    async def update_config(payload: dict, *, changed_by: str, ip_address: str | None = None) -> dict:
        allowed = {
            "model",
            "ai_base_url",
            "ai_provider_mode",
            "ai_bearer_token",
            "system_prompt",
            "temperature",
            "max_tokens_per_request",
            "strict_actions",
        }
        updates = {k: v for k, v in payload.items() if k in allowed and v is not None}
        changed_fields: list[str] = []
        old_values: dict[str, object] = {}
        new_values: dict[str, object] = {}

        async with UnitOfWork() as uow:
            row = (await uow.session.execute(select(AIRuntimeSettings).limit(1))).scalars().first()
            if row is None:
                row = AIRuntimeSettings()
                uow.session.add(row)
                await uow.session.flush()

            secret_row = (await uow.session.execute(select(AIRuntimeSecret).limit(1))).scalars().first()
            if secret_row is None:
                secret_row = AIRuntimeSecret()
                uow.session.add(secret_row)
                await uow.session.flush()

            if "model" in updates:
                old_values["model"] = row.model
                row.model = str(updates["model"]).strip()
                new_values["model"] = row.model
                changed_fields.append("model")
            if "ai_base_url" in updates:
                old_values["ai_base_url"] = row.ai_base_url
                row.ai_base_url = str(updates["ai_base_url"]).strip().rstrip("/")
                new_values["ai_base_url"] = row.ai_base_url
                changed_fields.append("ai_base_url")
            if "ai_provider_mode" in updates:
                old_values["ai_provider_mode"] = row.ai_provider_mode
                row.ai_provider_mode = SuperadminAIConfigService._normalize_provider_mode(str(updates["ai_provider_mode"]))
                new_values["ai_provider_mode"] = row.ai_provider_mode
                changed_fields.append("ai_provider_mode")
            if "system_prompt" in updates:
                old_values["system_prompt"] = row.system_prompt
                row.system_prompt = str(updates["system_prompt"]).strip()
                new_values["system_prompt"] = row.system_prompt
                changed_fields.append("system_prompt")
            if "temperature" in updates:
                old_values["temperature"] = float(row.temperature)
                row.temperature = float(updates["temperature"])
                new_values["temperature"] = float(row.temperature)
                changed_fields.append("temperature")
            if "max_tokens_per_request" in updates:
                old_values["max_tokens_per_request"] = int(row.max_tokens_per_request)
                row.max_tokens_per_request = int(updates["max_tokens_per_request"])
                new_values["max_tokens_per_request"] = int(row.max_tokens_per_request)
                changed_fields.append("max_tokens_per_request")
            if "strict_actions" in updates:
                old_values["strict_actions"] = bool(row.strict_actions)
                row.strict_actions = bool(updates["strict_actions"])
                new_values["strict_actions"] = bool(row.strict_actions)
                changed_fields.append("strict_actions")

            if "ai_bearer_token" in updates:
                incoming = str(updates["ai_bearer_token"] or "").strip()
                old_plain = decrypt_runtime_secret(secret_row.bearer_token_encrypted)
                old_values["ai_bearer_token_masked"] = mask_runtime_secret(old_plain) if old_plain else ""
                if incoming:
                    secret_row.bearer_token_encrypted = encrypt_runtime_secret(incoming)
                    new_values["ai_bearer_token_masked"] = mask_runtime_secret(incoming)
                else:
                    secret_row.bearer_token_encrypted = ""
                    new_values["ai_bearer_token_masked"] = ""
                changed_fields.append("ai_bearer_token")

            if changed_fields:
                uow.session.add(
                    AIRuntimeAudit(
                        actor=(changed_by or "superadmin").strip() or "superadmin",
                        ip_address=(ip_address or "").strip() or None,
                        changed_fields=changed_fields,
                        meta={
                            "old": old_values,
                            "new": new_values,
                        },
                    )
                )

            await uow.commit()

        return await SuperadminAIConfigService.get_config()
