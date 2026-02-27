"""AI-адаптер генерации документов для модуля Docs."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from src.config import settings
from src.modules.ai.internal.chat_controller_parts.provider import _extract_provider_reply, _extract_usage_dict
from src.modules.ai.internal.runtime_secrets import decrypt_runtime_secret
from src.modules.ai.service import (
    call_openai_compatible_api,
    call_timeweb_native_api,
    estimate_tokens,
    resolve_timeweb_agent_id,
)
from src.modules.docs.domain import FileType
from src.modules.docs.errors import DocsModuleError

if TYPE_CHECKING:
    from src.modules.ai.internal.repository import AIRepository


@dataclass(slots=True)
class AIGenerationRuntime:
    """Эффективные runtime-параметры провайдера AI."""

    base_url: str
    bearer_token: str
    provider_mode: str
    model: str
    temperature: float
    max_tokens: int


@dataclass(slots=True)
class AIGeneratedDocument:
    """Результат AI-генерации содержимого документа."""

    text: str
    usage: dict[str, int]
    model: str
    provider_mode: str


class AiDocumentGenerator:
    """Инфраструктурный адаптер генерации документа через AI-провайдер."""

    async def resolve_runtime(self, repo: AIRepository) -> AIGenerationRuntime:
        """Получить runtime-настройки AI с fallback на env."""
        runtime = await repo.get_runtime_settings()
        runtime_secret = await repo.get_runtime_secret()
        runtime_token = decrypt_runtime_secret(runtime_secret.bearer_token_encrypted) if runtime_secret else ""
        bearer_token = runtime_token.strip() or settings.OPENAI_BEARER_TOKEN or settings.OPENAI_API_KEY
        if not bearer_token:
            raise DocsModuleError(
                code="AI_NOT_CONFIGURED",
                message="AI API token is not configured. Set runtime bearer token or OPENAI_BEARER_TOKEN in .env",
                status_code=422,
            )

        provider_mode = (
            str(runtime.ai_provider_mode).strip().lower()
            if runtime and getattr(runtime, "ai_provider_mode", "")
            else str(settings.AI_PROVIDER_MODE).strip().lower()
        )
        if provider_mode not in {"openai_compatible", "timeweb_native"}:
            provider_mode = "openai_compatible"

        base_url = (
            str(runtime.ai_base_url).strip().rstrip("/")
            if runtime and getattr(runtime, "ai_base_url", "")
            else str(settings.AI_BASE_URL).strip().rstrip("/")
        )

        return AIGenerationRuntime(
            base_url=base_url,
            bearer_token=bearer_token,
            provider_mode=provider_mode,
            model=(runtime.model.strip() if runtime and runtime.model else settings.OPENAI_MODEL),
            temperature=float(runtime.temperature if runtime else 0.2),
            max_tokens=int(
                (
                    runtime.max_tokens_per_request
                    if runtime and runtime.max_tokens_per_request
                    else settings.AI_MAX_TOKENS_PER_REQUEST
                )
                or 2000
            ),
        )

    async def generate_text(
        self,
        *,
        runtime: AIGenerationRuntime,
        file_type: FileType,
        prompt: str,
        template: str | None,
        title: str | None,
        language: str | None,
    ) -> AIGeneratedDocument:
        """Сгенерировать контент документа заданного типа."""
        system_prompt = _build_generation_system_prompt(file_type=file_type, language=language)
        user_prompt = _build_generation_user_prompt(
            file_type=file_type,
            prompt=prompt,
            template=template,
            title=title,
        )

        if runtime.provider_mode == "timeweb_native" and resolve_timeweb_agent_id(runtime.base_url) is not None:
            provider_message = f"SYSTEM:\n{system_prompt}\n\nUSER:\n{user_prompt}"
            data = await call_timeweb_native_api(
                base_url=runtime.base_url,
                bearer_token=runtime.bearer_token,
                message=provider_message,
                parent_message_id=None,
            )
        else:
            data = await call_openai_compatible_api(
                runtime.base_url,
                runtime.bearer_token,
                runtime.model,
                [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=max(600, min(int(runtime.max_tokens), 3200)),
                temperature=float(max(0.0, min(1.0, runtime.temperature))),
            )

        raw = _extract_provider_reply(data)
        text = _sanitize_generated_text(raw)
        if not text:
            raise DocsModuleError(
                code="AI_EMPTY_RESPONSE",
                message="AI вернул пустой результат генерации",
                status_code=502,
            )

        usage = _extract_usage_dict(data)
        if int(usage.get("total_tokens", 0) or 0) <= 0:
            prompt_tokens = int(estimate_tokens(system_prompt) + estimate_tokens(user_prompt) + 12)
            completion_tokens = int(estimate_tokens(text))
            usage = {
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": prompt_tokens + completion_tokens,
                "estimated": True,
            }

        return AIGeneratedDocument(
            text=_clip_output_by_type(file_type=file_type, text=text),
            usage=usage,
            model=runtime.model,
            provider_mode=runtime.provider_mode,
        )


def _build_generation_system_prompt(*, file_type: FileType, language: str | None) -> str:
    """Сформировать system prompt для генерации документа."""
    lang = (str(language or "ru").strip() or "ru")[:12]
    return (
        "Ты генератор деловых документов CRM. "
        f"Язык ответа: {lang}. "
        "Верни только содержимое документа без markdown-обрамления и без пояснений вне документа. "
        f"Формат документа: {file_type.value.upper()}."
    )


def _build_generation_user_prompt(
    *,
    file_type: FileType,
    prompt: str,
    template: str | None,
    title: str | None,
) -> str:
    """Сформировать пользовательский prompt для AI генератора."""
    chunks = [
        f"Тип документа: {file_type.value.upper()}",
        f"Название: {str(title or '').strip() or 'Без названия'}",
        "Задача пользователя:",
        str(prompt or "").strip(),
    ]
    if template and str(template).strip():
        chunks.extend(["Шаблон/стиль:", str(template).strip()])
    chunks.append(
        "Требования: структура должна быть логичной, фактические данные не выдумывать; "
        "если данных не хватает — оставляй нейтральные placeholders."
    )
    return "\n\n".join(chunks)


def _sanitize_generated_text(text: str) -> str:
    """Убрать типичное markdown-обрамление из результата модели."""
    value = str(text or "").strip()
    if value.startswith("```"):
        lines = value.splitlines()
        if len(lines) >= 2:
            lines = lines[1:]
            if lines and lines[-1].strip().startswith("```"):
                lines = lines[:-1]
            value = "\n".join(lines).strip()
    return value


def _clip_output_by_type(*, file_type: FileType, text: str) -> str:
    """Ограничить объем generated-текста по типу документа."""
    limits = {
        FileType.TXT: int(getattr(settings, "DOCS_AI_MAX_CHARS_TXT", 60_000) or 60_000),
        FileType.DOCX: int(getattr(settings, "DOCS_AI_MAX_CHARS_DOCX", 80_000) or 80_000),
        FileType.PDF: int(getattr(settings, "DOCS_AI_MAX_CHARS_PDF", 70_000) or 70_000),
    }
    limit = max(1000, limits.get(file_type, 60_000))
    if len(text) <= limit:
        return text
    return text[: limit - 64].rstrip() + "\n\n[...сокращено по лимиту генерации...]"


DEFAULT_AI_DOCUMENT_GENERATOR = AiDocumentGenerator()
