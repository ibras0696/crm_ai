from __future__ import annotations

import sys
import uuid
from datetime import UTC, datetime, timedelta

from src.common.enums import AuditAction
from src.config import settings
from src.modules.ai.internal.repository import AIRepository
from src.modules.ai.public_api import check_ai_limits as _default_check_ai_limits
from src.modules.ai.public_api import is_org_ai_enabled
from src.modules.docs.ai_generator import DEFAULT_AI_DOCUMENT_GENERATOR, estimate_generation_budget
from src.modules.docs.domain import FileStatus
from src.modules.docs.errors import DocsModuleError, QuotaExceededError
from src.modules.docs.models import DocsAIGenerationJob
from src.modules.docs.service_parts.base import AIGenerateRequestResult, _inc_ai_generate_metric
from src.modules.docs.storage import DEFAULT_BUCKET
from src.modules.files.models import File


def _resolve_check_ai_limits():
    service_module = sys.modules.get("src.modules.docs.service")
    if service_module is not None:
        patched = getattr(service_module, "check_ai_limits", None)
        if patched is not None:
            return patched
    return _default_check_ai_limits


class DocsAIMixin:
    async def request_ai_generate(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_type: str,
        prompt: str,
        template: str | None,
        folder_id: uuid.UUID | None,
        title: str | None,
        language: str | None,
    ) -> AIGenerateRequestResult:
        if not bool(getattr(settings, "DOCS_AI_GENERATION_ENABLED", True)):
            raise DocsModuleError(code="DOCS_AI_DISABLED", message="AI-генерация документов отключена администратором")
        if not settings.ENABLE_AI:
            raise DocsModuleError(code="AI_DISABLED", message="AI отключен администратором")
        if not await is_org_ai_enabled(self.session, org_id=org_id):
            raise DocsModuleError(code="AI_DISABLED", message="AI отключен для вашей организации", status_code=403)

        normalized_prompt = str(prompt or "").strip()
        if not normalized_prompt:
            raise DocsModuleError(code="INVALID_PROMPT", message="Поле prompt не может быть пустым")
        max_prompt_chars = int(getattr(settings, "DOCS_AI_MAX_PROMPT_CHARS", 12_000) or 12_000)
        if len(normalized_prompt) > max_prompt_chars:
            raise DocsModuleError(code="PROMPT_TOO_LARGE", message="Слишком длинный prompt для генерации документа")

        normalized_type = self._resolve_generated_file_type(file_type)
        if normalized_type.value == "pdf":
            raise DocsModuleError(
                code="PDF_DISABLED",
                message="Генерация PDF отключена. Используйте DOCX.",
                status_code=422,
            )
        normalized_template = str(template).strip() if template else None
        normalized_language = str(language).strip() if language else "ru"
        doc_title = (str(title or "").strip() or f"AI {normalized_type.value.upper()} документ")[:500]
        if folder_id is not None:
            folder = await self.repo.get_folder(folder_id=folder_id, org_id=org_id)
            if folder is None:
                raise DocsModuleError(code="FOLDER_NOT_FOUND", message="Папка не найдена", status_code=404)

        duplicate = await self._find_recent_duplicate_ai_request(
            org_id=org_id,
            user_id=user_id,
            file_type=normalized_type,
            prompt=normalized_prompt,
            template=normalized_template,
            title=doc_title,
            language=normalized_language,
            folder_id=folder_id,
        )
        if duplicate is not None:
            return duplicate

        ai_repo = AIRepository(self.session)
        runtime = await DEFAULT_AI_DOCUMENT_GENERATOR.resolve_runtime(ai_repo)
        generation_budget = estimate_generation_budget(
            max_tokens_per_request=runtime.max_tokens,
            file_type=normalized_type,
            prompt=normalized_prompt,
            template=normalized_template,
            title=doc_title,
            language=normalized_language,
        )
        if generation_budget.completion_tokens < 256:
            raise DocsModuleError(
                code="PROMPT_TOO_LARGE_FOR_REQUEST_LIMIT",
                message=(
                    "Запрос слишком длинный для текущего лимита AI на один запрос. "
                    "Сократите описание или увеличьте лимит."
                ),
                status_code=422,
            )
        estimated_request_tokens = int(generation_budget.total_tokens)
        check_ai_limits = _resolve_check_ai_limits()
        ok, err = await check_ai_limits(
            self.session,
            org_id=org_id,
            user_id=user_id,
            estimated_request_tokens=estimated_request_tokens,
        )
        if not ok:
            raise DocsModuleError(
                code=str((err or {}).get("code") or "AI_LIMIT_EXCEEDED"),
                message=str((err or {}).get("message") or "Превышены лимиты AI"),
                status_code=429,
            )

        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        limit_bytes = await self._resolve_storage_limit_bytes(org_id=org_id)
        reserved_bytes = self._estimate_ai_reserved_bytes(normalized_prompt, normalized_type)
        projected = int(usage.used_bytes) + int(usage.reserved_bytes) + int(reserved_bytes)
        if limit_bytes > 0 and projected > limit_bytes:
            raise QuotaExceededError("Недостаточно свободного места для AI-генерации документа.")
        usage.reserved_bytes = int(usage.reserved_bytes) + int(reserved_bytes)
        await self.repo.update_storage_usage(usage)

        file_id = uuid.uuid4()
        placeholder_version = uuid.uuid4()
        pending_key = f"org/{org_id}/files/{file_id}/pending/{placeholder_version}"
        content_type, extension = self._resolve_mime_and_ext(normalized_type)
        filename = f"{doc_title[:200]}.{extension}"

        file_obj = File(
            id=file_id,
            org_id=org_id,
            uploaded_by=user_id,
            filename=filename,
            original_name=filename,
            content_type=content_type,
            size=0,
            s3_key=pending_key,
            s3_bucket=DEFAULT_BUCKET,
            folder_id=folder_id,
            type=normalized_type.value,
            status=FileStatus.DRAFT.value,
            title=doc_title,
            current_version_id=None,
        )
        await self.repo.create_file(file_obj)

        job = DocsAIGenerationJob(
            org_id=org_id,
            user_id=user_id,
            file_id=file_obj.id,
            file_type=normalized_type.value,
            status="queued",
            prompt=normalized_prompt,
            template=normalized_template,
            title=doc_title,
            language=normalized_language,
            provider_model=runtime.model,
            prompt_tokens=0,
            completion_tokens=0,
            total_tokens=0,
            error_message=None,
            task_id=None,
            meta_json={
                "reserved_bytes": int(reserved_bytes),
                "folder_id": str(folder_id) if folder_id else None,
                "provider_mode": runtime.provider_mode,
            },
        )
        await self.repo.create_ai_generation_job(job)
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=user_id,
            action=AuditAction.CREATE,
            entity_type="docs_ai_generation_job",
            entity_id=str(job.id),
            meta={
                "event": "ai_generate_requested",
                "file_id": str(file_obj.id),
                "file_type": normalized_type.value,
                "estimated_request_tokens": estimated_request_tokens,
            },
        )
        _inc_ai_generate_metric("queued", normalized_type.value)
        return AIGenerateRequestResult(job=job, file=file_obj, estimated_request_tokens=estimated_request_tokens)

    async def _find_recent_duplicate_ai_request(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        file_type,
        prompt: str,
        template: str | None,
        title: str,
        language: str,
        folder_id: uuid.UUID | None,
    ) -> AIGenerateRequestResult | None:
        dedupe_window_seconds = int(getattr(settings, "DOCS_AI_DEDUPE_WINDOW_SECONDS", 120) or 120)
        if dedupe_window_seconds <= 0:
            return None

        cutoff = datetime.now(UTC) - timedelta(seconds=dedupe_window_seconds)
        recent_jobs = await self.repo.list_recent_ai_generation_jobs(org_id=org_id, limit=50)

        for job in recent_jobs:
            if job.created_at < cutoff:
                break
            if job.user_id != user_id or job.file_type != file_type.value:
                continue
            if job.status not in {"queued", "running", "scanning", "ready"}:
                continue
            if (job.prompt or "").strip() != prompt:
                continue
            if ((job.template or "").strip() or None) != template:
                continue
            if ((job.title or "").strip() or "") != title:
                continue
            if ((job.language or "").strip() or "ru") != language:
                continue
            if job.file_id is None:
                continue

            existing_file = await self.repo.get_doc_file(file_id=job.file_id, org_id=org_id)
            if existing_file is None or existing_file.folder_id != folder_id:
                continue

            estimated_tokens = int(job.total_tokens or job.prompt_tokens or 0)
            return AIGenerateRequestResult(
                job=job,
                file=existing_file,
                estimated_request_tokens=estimated_tokens,
                should_enqueue_task=False,
            )
        return None

    async def get_ai_generation_job(self, *, org_id: uuid.UUID, job_id: uuid.UUID) -> DocsAIGenerationJob:
        job = await self.repo.get_ai_generation_job(job_id=job_id, org_id=org_id)
        if job is None:
            raise DocsModuleError(code="NOT_FOUND", message="AI job не найден", status_code=404)
        return job

    async def list_ai_generation_jobs(self, *, org_id: uuid.UUID, limit: int = 20) -> list[DocsAIGenerationJob]:
        return await self.repo.list_recent_ai_generation_jobs(org_id=org_id, limit=limit)

    async def stop_ai_generation_job(
        self,
        *,
        org_id: uuid.UUID,
        actor_id: uuid.UUID,
        job_id: uuid.UUID,
    ) -> DocsAIGenerationJob:
        job = await self.repo.get_ai_generation_job_for_update(job_id=job_id)
        if job is None or job.org_id != org_id:
            raise DocsModuleError(code="NOT_FOUND", message="AI job не найден", status_code=404)
        if job.status in {"ready", "blocked", "failed"}:
            return job
        if job.status == "scanning":
            raise DocsModuleError(
                code="JOB_CANNOT_BE_STOPPED",
                message="Задача уже передана на проверку файла и не может быть остановлена.",
                status_code=409,
            )

        usage = await self.repo.get_storage_usage_for_update(org_id=org_id)
        usage.reserved_bytes = max(0, int(usage.reserved_bytes) - self._extract_reserved_bytes(job.meta_json))
        await self.repo.update_storage_usage(usage)

        if job.file_id is not None:
            file_obj = await self.repo.get_doc_file(file_id=job.file_id, org_id=org_id)
            if file_obj is not None and file_obj.status in {FileStatus.DRAFT.value, FileStatus.UPLOADING.value}:
                file_obj.status = FileStatus.BLOCKED.value
                await self.repo.update_file(file_obj)

        stopped_at = datetime.now(UTC)
        meta_json = dict(job.meta_json or {})
        meta_json["stopped_by_user"] = True
        meta_json["stopped_at"] = stopped_at.isoformat()
        job.meta_json = meta_json
        job.status = "failed"
        job.error_message = "Остановлено пользователем"
        job.finished_at = stopped_at
        await self.repo.update_ai_generation_job(job)
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=actor_id,
            action=AuditAction.UPDATE,
            entity_type="docs_ai_generation_job",
            entity_id=str(job.id),
            meta={"event": "ai_generate_stopped", "file_id": str(job.file_id) if job.file_id else None},
        )
        return job

    async def delete_ai_generation_job(
        self,
        *,
        org_id: uuid.UUID,
        actor_id: uuid.UUID,
        job_id: uuid.UUID,
    ) -> None:
        job = await self.repo.get_ai_generation_job_for_update(job_id=job_id)
        if job is None or job.org_id != org_id:
            raise DocsModuleError(code="NOT_FOUND", message="AI job не найден", status_code=404)
        if job.status in {"queued", "running", "scanning"}:
            raise DocsModuleError(
                code="JOB_STILL_ACTIVE",
                message="Сначала остановите задачу или дождитесь завершения.",
                status_code=409,
            )
        await self.repo.delete_ai_generation_job(job)
        await self.audit_repo.log(
            org_id=org_id,
            actor_id=actor_id,
            action=AuditAction.DELETE,
            entity_type="docs_ai_generation_job",
            entity_id=str(job_id),
            meta={"event": "ai_generate_job_deleted"},
        )
