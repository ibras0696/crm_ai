"""AI actions for Docs module."""

from __future__ import annotations

import uuid
from typing import Any

from src.infrastructure.uow import UnitOfWork
from src.modules.docs.errors import DocsModuleError


def _normalize_document_type(action_payload: dict[str, Any]) -> str:
    # AI-action for documents currently supports only DOCX creation.
    return "docx"


def _normalize_optional_text(value: Any, *, limit: int | None = None) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    if not normalized:
        return None
    if limit is not None:
        return normalized[:limit]
    return normalized


async def handle_create_document_action(
    uow: UnitOfWork,
    org_id: uuid.UUID,
    user_id: uuid.UUID,
    action_payload: dict[str, Any],
    user_message: str | None = None,
) -> dict[str, Any]:
    """Create a document through the existing Docs AI generation pipeline."""
    from src.modules.docs.service import DocsService

    prompt = _normalize_optional_text(
        action_payload.get("prompt")
        or action_payload.get("description")
        or action_payload.get("content")
        or user_message,
        limit=12_000,
    )
    if not prompt:
        return {
            "action": "create_document",
            "ok": False,
            "error": "prompt_required",
            "message": "Опишите, какой документ нужно создать.",
        }

    folder_id_raw = action_payload.get("folder_id")
    folder_id: uuid.UUID | None = None
    if folder_id_raw:
        try:
            folder_id = uuid.UUID(str(folder_id_raw))
        except Exception:
            return {
                "action": "create_document",
                "ok": False,
                "error": "invalid_folder_id",
                "message": "Указана неверная папка для документа.",
            }

    service = DocsService(uow.session)
    try:
        result = await service.request_ai_generate(
            org_id=org_id,
            user_id=user_id,
            file_type=_normalize_document_type(action_payload),
            prompt=prompt,
            template=_normalize_optional_text(action_payload.get("template") or action_payload.get("style"), limit=120),
            folder_id=folder_id,
            title=_normalize_optional_text(action_payload.get("title") or action_payload.get("name"), limit=500),
            language=_normalize_optional_text(action_payload.get("language"), limit=12) or "ru",
        )
        await uow.session.flush()
    except DocsModuleError as error:
        return {
            "action": "create_document",
            "ok": False,
            "error": error.code,
            "message": error.message,
            "status_code": error.status_code,
        }

    should_enqueue_task = bool(getattr(result, "should_enqueue_task", True))

    return {
        "action": "create_document",
        "ok": True,
        "message": "Документ поставлен в очередь на генерацию.",
        **({"_post_commit_docs_ai_job_id": str(result.job.id)} if should_enqueue_task else {}),
        "file": {
            "id": str(result.file.id),
            "title": result.file.title,
            "type": result.file.type,
            "status": result.file.status,
        },
        "job": {
            "id": str(result.job.id),
            "status": result.job.status,
            "file_type": result.job.file_type,
            "title": result.job.title,
            "estimated_request_tokens": int(result.estimated_request_tokens),
        },
    }
