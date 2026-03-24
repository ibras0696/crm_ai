"""Celery tasks модуля Docs (AV-сканирование и статусный gating)."""
# ruff: noqa: TC003

from __future__ import annotations

import asyncio
import logging
import os
import threading
import uuid
from collections.abc import Awaitable, Callable, Iterable
from contextlib import suppress
from datetime import UTC, datetime, timedelta
from hashlib import sha256
from typing import Any

import httpx
import jwt
from botocore.exceptions import BotoCoreError, ClientError
from kombu.exceptions import OperationalError
from sqlalchemy import delete, func, select
from sqlalchemy.exc import SQLAlchemyError

from src.common.enums import AuditAction
from src.config import settings
from src.infrastructure.celery_app import celery
from src.infrastructure.celery_base import BaseTaskWithRetry
from src.infrastructure.database_sync import sync_session_factory
from src.infrastructure.metrics_custom import (
    DOCS_AI_GENERATE_ERRORS_TOTAL,
    DOCS_AI_GENERATE_TOTAL,
    DOCS_RETENTION_CLEANUP_TOTAL,
    FILE_SCAN_TOTAL,
    UPLOADS_TOTAL,
)
from src.infrastructure.task_logging import log_task_failure
from src.infrastructure.uow import UnitOfWork
from src.modules.ai.internal.repository import AIRepository
from src.modules.ai.models import AIUsageLog
from src.modules.ai.public_api import check_ai_limits
from src.modules.audit.models import AuditLog
from src.modules.billing.token_wallet import spend_tokens
from src.modules.docs.ai_generator import DEFAULT_AI_DOCUMENT_GENERATOR
from src.modules.docs.antivirus import AntivirusScanResult, build_antivirus_provider
from src.modules.docs.doc_editor_provider import DEFAULT_DOC_EDITOR_PROVIDER
from src.modules.docs.document_render import render_document_bytes
from src.modules.docs.domain import FileStatus, FileType
from src.modules.docs.errors import DocsModuleError
from src.modules.docs.magic_bytes import validate_magic_bytes
from src.modules.docs.models import DocsAIGenerationJob, FileVersion, OrgStorageUsage
from src.modules.docs.repository import DocsRepository
from src.modules.docs.storage import DEFAULT_STORAGE_PROVIDER
from src.modules.files.models import File
from src.modules.files.storage import get_s3_client

logger = logging.getLogger(__name__)
_WORKER_EVENT_LOOP: asyncio.AbstractEventLoop | None = None


def _run_async_in_isolated_thread(coro_factory: Callable[[], Awaitable[Any]]) -> Any:
    result: dict[str, Any] = {"value": None, "error": None}

    def _runner() -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result["value"] = loop.run_until_complete(coro_factory())
        except BaseException as exc:  # pragma: no cover - propagated to caller thread
            result["error"] = exc
        finally:
            loop.close()

    thread = threading.Thread(target=_runner, daemon=True)
    thread.start()
    thread.join()
    if result["error"] is not None:
        raise result["error"]
    return result["value"]


def _run_async_on_worker_loop(coro_factory: Callable[[], Awaitable[Any]]) -> Any:
    """Выполнить async-код на стабильном loop процесса Celery worker.

    ``asyncio.run`` создаёт новый event loop на каждый task. Для asyncpg это
    приводит к reuse соединений между разными loop и даёт ошибки вида
    ``Future attached to a different loop`` / ``another operation is in progress``.
    Держим один loop на процесс worker и выполняем все async docs-task'и на нём.
    """
    try:
        running_loop = asyncio.get_running_loop()
    except RuntimeError:
        running_loop = None

    if running_loop is not None and running_loop.is_running():
        # For tests (or any non-celery async caller), run on a separate thread loop
        # to avoid "Cannot run the event loop while another loop is running".
        return _run_async_in_isolated_thread(coro_factory)

    global _WORKER_EVENT_LOOP
    if _WORKER_EVENT_LOOP is None or _WORKER_EVENT_LOOP.is_closed():
        _WORKER_EVENT_LOOP = asyncio.new_event_loop()
    asyncio.set_event_loop(_WORKER_EVENT_LOOP)
    return _WORKER_EVENT_LOOP.run_until_complete(coro_factory())


@celery.task(name="scan_version")
def scan_version(version_id: str) -> dict[str, str]:
    """Проверить загруженную версию файла и выставить финальный статус."""
    try:
        version_uuid = uuid.UUID(str(version_id))
    except (TypeError, ValueError, AttributeError):
        _inc_scan_metric("invalid_version_id")
        return {"status": "error", "reason": "invalid_version_id"}

    with sync_session_factory() as session:
        row = session.execute(
            select(FileVersion, File)
            .join(File, File.id == FileVersion.file_id)
            .where(FileVersion.id == version_uuid)
            .limit(1)
        ).first()
        if row is None:
            _inc_scan_metric("version_not_found")
            return {"status": "skipped", "reason": "version_not_found"}

        version, file_obj = row
        if file_obj.status != FileStatus.SCANNING.value:
            _inc_scan_metric("status_not_scanning")
            return {"status": "skipped", "reason": "status_not_scanning"}

        initial_uploaded_size = int(file_obj.size or 0)
        scan_result = _scan_payload(file_obj=file_obj, version=version)
        if (
            scan_result.result == "clean"
            and file_obj.type == FileType.PDF.value
        ):
            try:
                token_payload = {
                    "sub": str(version.id),
                    "action": "internal_download_source",
                    "exp": datetime.now(UTC) + timedelta(minutes=15),
                }
                internal_token = jwt.encode(token_payload, settings.SECRET_KEY, algorithm="HS256")
                source_url = f"http://api:8000/api/v1/docs/files/internal-source-download/{version.id}?token={internal_token}"
                logger.info(
                    "docs_pdf_to_docx_convert_started",
                    extra={
                        "file_id": str(file_obj.id),
                        "version_id": str(version.id),
                        "source": "internal_source_download",
                        "source_url_path": f"/api/v1/docs/files/internal-source-download/{version.id}",
                    },
                )
                converted_docx = _run_async_on_worker_loop(
                    lambda: DEFAULT_DOC_EDITOR_PROVIDER.convert_to_docx(file_url=source_url, file_type="pdf")
                )
                converted_scan = _scan_payload_bytes(file_type=FileType.DOCX, payload=converted_docx)
                if converted_scan.result != "clean":
                    scan_result = AntivirusScanResult(
                        result=converted_scan.result,
                        details=f"pdf_to_docx_scan_failed: {converted_scan.details}",
                        threat_name=converted_scan.threat_name,
                    )
                else:
                    DEFAULT_STORAGE_PROVIDER.put_object_bytes(
                        bucket=version.s3_bucket,
                        key=version.s3_key,
                        payload=converted_docx,
                        content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    )
                    file_obj.type = FileType.DOCX.value
                    file_obj.content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    file_obj.size = len(converted_docx)
                    file_obj.filename = _to_docx_filename(file_obj.filename)
                    file_obj.original_name = _to_docx_filename(file_obj.original_name or file_obj.filename)
                    version.size_bytes = len(converted_docx)
                    version.mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                    version.sha256 = sha256(converted_docx).hexdigest()
                    version_meta = version.meta_json if isinstance(version.meta_json, dict) else {}
                    version_meta["conversion"] = {
                        "source_format": "pdf",
                        "target_format": "docx",
                        "converted_at": datetime.now(UTC).isoformat(),
                    }
                    version.meta_json = version_meta
                    logger.info(
                        "docs_pdf_to_docx_convert_ok",
                        extra={
                            "file_id": str(file_obj.id),
                            "version_id": str(version.id),
                            "size_bytes": len(converted_docx),
                        },
                    )
            except (DocsModuleError, httpx.HTTPError, RuntimeError, TypeError, ValueError) as exc:
                logger.error(
                    "docs_pdf_to_docx_convert_failed",
                    extra={
                        "file_id": str(file_obj.id),
                        "version_id": str(version.id),
                        "error": str(exc)[:300],
                    },
                )
                scan_result = AntivirusScanResult(result="error", details=f"pdf_to_docx_convert_failed: {exc}")

        final_status = FileStatus.READY.value if scan_result.result == "clean" else FileStatus.BLOCKED.value

        usage = (
            session.execute(
                select(OrgStorageUsage).where(OrgStorageUsage.org_id == file_obj.org_id).with_for_update().limit(1)
            )
            .scalars()
            .first()
        )
        if usage is None:
            used_bytes = int(
                session.execute(
                    select(func.coalesce(func.sum(File.size), 0)).where(
                        File.org_id == file_obj.org_id,
                        File.type.in_([FileType.TXT.value, FileType.PDF.value, FileType.DOCX.value]),
                        File.status == FileStatus.READY.value,
                        File.current_version_id.is_not(None),
                    )
                ).scalar_one()
                or 0
            )
            usage = OrgStorageUsage(org_id=file_obj.org_id, used_bytes=used_bytes, reserved_bytes=0)
            session.add(usage)
            session.flush()

        usage.reserved_bytes = max(0, int(usage.reserved_bytes) - int(initial_uploaded_size))
        version_meta = version.meta_json if isinstance(version.meta_json, dict) else {}
        replaced_ready_size = int(version_meta.get("replaced_ready_size") or 0)
        final_file_size = int(file_obj.size or 0)
        if final_status == FileStatus.READY.value:
            usage.used_bytes = max(0, int(usage.used_bytes) + final_file_size - replaced_ready_size)
        elif replaced_ready_size > 0:
            usage.used_bytes = max(0, int(usage.used_bytes) - replaced_ready_size)

        file_obj.status = final_status
        ai_job_id_raw = version_meta.get("ai_generation_job_id")
        ai_job_id = _safe_uuid(str(ai_job_id_raw)) if ai_job_id_raw else None
        if ai_job_id is not None:
            ai_job = (
                (session.execute(select(DocsAIGenerationJob).where(DocsAIGenerationJob.id == ai_job_id).limit(1)))
                .scalars()
                .first()
            )
            if ai_job is not None:
                ai_job.status = final_status if final_status in {"ready", "blocked"} else "failed"
                ai_job.finished_at = datetime.now(UTC)
                if final_status != FileStatus.READY.value and not ai_job.error_message:
                    ai_job.error_message = "Сканирование завершилось блокировкой файла"

        session.add(
            AuditLog(
                org_id=file_obj.org_id,
                actor_id=file_obj.uploaded_by,
                action=AuditAction.UPDATE,
                entity_type="docs_file",
                entity_id=str(file_obj.id),
                meta={
                    "event": "scan_result",
                    "version_id": str(version.id),
                    "status": final_status,
                    "scan_result": scan_result.result,
                    "threat_name": scan_result.threat_name,
                    "details": scan_result.details,
                },
            )
        )

        session.commit()

    _inc_scan_metric(scan_result.result)
    _inc_upload_metric(final_status)
    return {
        "status": final_status,
        "scan_result": scan_result.result,
        "version_id": str(version_uuid),
    }


@celery.task(name="docs_ai_generate", bind=True)
def ai_generate(self, job_id: str) -> dict[str, str]:
    """Сгенерировать документ через AI и запустить AV-пайплайн версии."""
    task_id = str(getattr(getattr(self, "request", None), "id", "") or "")
    try:
        return _run_async_on_worker_loop(lambda: run_ai_generate_inline(job_id=job_id, task_id=task_id)) or {
            "status": "failed",
            "reason": "empty_result",
        }
    except (
        BotoCoreError,
        ClientError,
        SQLAlchemyError,
        httpx.HTTPError,
        OSError,
        RuntimeError,
        TypeError,
        ValueError,
    ) as exc:
        log_task_failure(
            logger,
            task_name="docs_ai_generate",
            task_id=task_id,
            task_args=(job_id,),
            task_kwargs={},
            exc=exc,
            context={"job_id": job_id, "failure_mode": "caught_exception"},
            message="Docs AI generate task failed",
        )
        with suppress(Exception):
            _run_async_on_worker_loop(_mark_ai_job_failed_unexpected(job_id=job_id, reason=str(exc)))
        _inc_ai_generate_error_metric("unexpected_exception")
        return {"status": "failed", "reason": str(exc)[:240]}


async def run_ai_generate_inline(*, job_id: str, task_id: str = "inline") -> dict[str, str]:
    """Асинхронная реализация Celery task `docs_ai_generate`."""
    job_uuid = _safe_uuid(job_id)
    if job_uuid is None:
        _inc_ai_generate_error_metric("invalid_job_id")
        return {"status": "failed", "reason": "invalid_job_id"}

    # Этап 1: захват job и pre-check лимитов/конфига.
    async with UnitOfWork() as uow:
        repo = DocsRepository(uow.session)
        job = await repo.get_ai_generation_job_for_update(job_id=job_uuid)
        if job is None:
            _inc_ai_generate_error_metric("job_not_found")
            return {"status": "failed", "reason": "job_not_found"}
        if job.status not in {"queued", "running"}:
            return {"status": "skipped", "reason": f"invalid_status:{job.status}"}
        if job.file_id is None:
            await _mark_ai_job_failed(
                uow=uow,
                repo=repo,
                job=job,
                reason="Файл генерации не найден",
                code="file_not_found",
            )
            return {"status": "failed", "reason": "file_not_found"}

        file_obj = await repo.get_doc_file(file_id=job.file_id, org_id=job.org_id)
        if file_obj is None:
            await _mark_ai_job_failed(
                uow=uow,
                repo=repo,
                job=job,
                reason="Файл генерации не найден",
                code="file_not_found",
            )
            return {"status": "failed", "reason": "file_not_found"}

        normalized_type = _resolve_file_type(job.file_type)
        if normalized_type is None:
            await _mark_ai_job_failed(
                uow=uow,
                repo=repo,
                job=job,
                reason="Неподдерживаемый тип документа в AI-job",
                code="invalid_file_type",
            )
            return {"status": "failed", "reason": "invalid_file_type"}
        if job.user_id is None:
            await _mark_ai_job_failed(
                uow=uow,
                repo=repo,
                job=job,
                reason="Не найден пользователь, инициировавший AI-генерацию",
                code="user_not_found",
            )
            return {"status": "failed", "reason": "user_not_found"}

        estimated_tokens = int(max(200, len((job.prompt or "").split()) * 4 + 1000))
        ok, err = await check_ai_limits(
            uow.session,
            org_id=job.org_id,
            user_id=job.user_id,
            estimated_request_tokens=estimated_tokens,
        )
        if not ok:
            await _mark_ai_job_failed(
                uow=uow,
                repo=repo,
                job=job,
                reason=str((err or {}).get("message") or "AI лимит превышен"),
                code=str((err or {}).get("code") or "ai_limit"),
            )
            return {"status": "failed", "reason": str((err or {}).get("code") or "ai_limit")}

        ai_repo = AIRepository(uow.session)
        runtime = await DEFAULT_AI_DOCUMENT_GENERATOR.resolve_runtime(ai_repo)
        job.status = "running"
        job.started_at = job.started_at or datetime.now(UTC)
        if task_id:
            job.task_id = task_id
        await repo.update_ai_generation_job(job)
        await uow.commit()
        _inc_ai_generate_metric("running", normalized_type.value)
        snapshot = {
            "org_id": job.org_id,
            "user_id": job.user_id,
            "job_id": job.id,
            "file_id": file_obj.id,
            "file_type": normalized_type,
            "prompt": str(job.prompt or ""),
            "template": job.template,
            "title": job.title or file_obj.title or file_obj.original_name,
            "language": job.language or "ru",
            "runtime": runtime,
        }

    # Этап 2: вызов AI провайдера.
    generated = await DEFAULT_AI_DOCUMENT_GENERATOR.generate_text(
        runtime=snapshot["runtime"],
        file_type=snapshot["file_type"],
        prompt=snapshot["prompt"],
        template=snapshot["template"],
        title=snapshot["title"],
        language=snapshot["language"],
    )
    payload, mime, extension = render_document_bytes(
        file_type=snapshot["file_type"],
        text=generated.text,
        title=snapshot["title"],
    )
    payload_size = len(payload)
    max_upload_bytes = int(max(1, int(settings.FILE_MAX_UPLOAD_MB)) * 1024 * 1024)
    if payload_size > max_upload_bytes:
        async with UnitOfWork() as uow:
            repo = DocsRepository(uow.session)
            job = await repo.get_ai_generation_job_for_update(job_id=snapshot["job_id"])
            if job is not None:
                await _mark_ai_job_failed(
                    uow=uow,
                    repo=repo,
                    job=job,
                    reason="Сгенерированный документ превысил максимальный размер файла",
                    code="file_too_large",
                )
        _inc_ai_generate_error_metric("file_too_large")
        return {"status": "failed", "reason": "file_too_large"}

    # Этап 3: запись версии/usage/биллинга в одной транзакции.
    async with UnitOfWork() as uow:
        repo = DocsRepository(uow.session)
        job = await repo.get_ai_generation_job_for_update(job_id=snapshot["job_id"])
        if job is None:
            _inc_ai_generate_error_metric("job_not_found_after_generate")
            return {"status": "failed", "reason": "job_not_found_after_generate"}
        if job.status not in {"queued", "running"}:
            return {"status": "skipped", "reason": f"job_stopped:{job.status}"}
        file_obj = await repo.get_doc_file(file_id=snapshot["file_id"], org_id=snapshot["org_id"])
        if file_obj is None:
            await _mark_ai_job_failed(
                uow=uow,
                repo=repo,
                job=job,
                reason="Файл генерации не найден",
                code="file_not_found_after_generate",
            )
            return {"status": "failed", "reason": "file_not_found_after_generate"}

        usage_row = await repo.get_storage_usage_for_update(org_id=snapshot["org_id"])
        reserved_bytes = _extract_reserved_bytes(job.meta_json)
        usage_row.reserved_bytes = max(0, int(usage_row.reserved_bytes) - reserved_bytes)
        storage_limit = await _resolve_storage_limit_bytes(session=uow.session, org_id=snapshot["org_id"])
        projected = int(usage_row.used_bytes) + int(usage_row.reserved_bytes) + payload_size
        if storage_limit > 0 and projected > storage_limit:
            await _mark_ai_job_failed(
                uow=uow,
                repo=repo,
                job=job,
                reason="Недостаточно места для AI-документа",
                code="quota_exceeded",
                release_reserved=False,
            )
            return {"status": "failed", "reason": "quota_exceeded"}

        usage_total = int(generated.usage.get("total_tokens", 0) or 0)
        try:
            await spend_tokens(
                uow.session,
                org_id=snapshot["org_id"],
                user_id=snapshot["user_id"],
                tokens=usage_total,
                request_id=f"docs-ai-generate:{snapshot['job_id']}",
                meta={
                    "source": "docs_ai_generate",
                    "file_id": str(file_obj.id),
                    "job_id": str(job.id),
                    "file_type": snapshot["file_type"].value,
                },
            )
        except ValueError:
            await _mark_ai_job_failed(
                uow=uow,
                repo=repo,
                job=job,
                reason="Лимит токенов исчерпан.",
                code="ai_token_limit_exceeded",
                release_reserved=False,
            )
            return {"status": "failed", "reason": "ai_token_limit_exceeded"}

        new_version_id = uuid.uuid4()
        new_key = DEFAULT_STORAGE_PROVIDER.build_version_key(
            org_id=snapshot["org_id"],
            file_id=file_obj.id,
            version_id=new_version_id,
        )
        DEFAULT_STORAGE_PROVIDER.put_object_bytes(
            bucket=file_obj.s3_bucket or settings.S3_BUCKET,
            key=new_key,
            payload=payload,
            content_type=mime,
        )

        new_version = FileVersion(
            id=new_version_id,
            file_id=file_obj.id,
            s3_key=new_key,
            s3_bucket=file_obj.s3_bucket or settings.S3_BUCKET,
            size_bytes=payload_size,
            sha256=sha256(payload).hexdigest(),
            mime=mime,
            meta_json={
                "source": "ai_generate",
                "ai_generation_job_id": str(job.id),
                "provider_mode": generated.provider_mode,
                "extension": extension,
                "replaced_ready_size": 0,
            },
            created_by=snapshot["user_id"],
        )
        await repo.create_file_version(new_version)

        file_title = (str(snapshot["title"] or "").strip() or file_obj.title or file_obj.original_name)[:500]
        filename = f"{file_title[:220]}.{extension}"
        file_obj.current_version_id = new_version.id
        file_obj.s3_key = new_key
        file_obj.s3_bucket = file_obj.s3_bucket or settings.S3_BUCKET
        file_obj.content_type = mime
        file_obj.size = payload_size
        file_obj.type = snapshot["file_type"].value
        file_obj.status = FileStatus.SCANNING.value
        file_obj.title = file_title
        file_obj.filename = filename
        file_obj.original_name = filename
        await repo.update_file(file_obj)
        await repo.update_storage_usage(usage_row)

        job.status = "scanning"
        job.provider_model = generated.model
        job.prompt_tokens = int(generated.usage.get("prompt_tokens", 0) or 0)
        job.completion_tokens = int(generated.usage.get("completion_tokens", 0) or 0)
        job.total_tokens = usage_total
        job.error_message = None
        meta_json = dict(job.meta_json or {})
        meta_json["generated_size_bytes"] = payload_size
        meta_json["version_id"] = str(new_version.id)
        meta_json["content_type"] = mime
        job.meta_json = meta_json
        await repo.update_ai_generation_job(job)

        uow.session.add(
            AIUsageLog(
                org_id=snapshot["org_id"],
                user_id=snapshot["user_id"],
                model=generated.model,
                prompt_tokens=int(generated.usage.get("prompt_tokens", 0) or 0),
                completion_tokens=int(generated.usage.get("completion_tokens", 0) or 0),
                total_tokens=usage_total,
                message_preview=snapshot["prompt"][:200],
            )
        )
        uow.session.add(
            AuditLog(
                org_id=snapshot["org_id"],
                actor_id=snapshot["user_id"],
                action=AuditAction.CREATE,
                entity_type="docs_file_version",
                entity_id=str(new_version.id),
                meta={
                    "event": "version_created",
                    "source": "ai_generate",
                    "file_id": str(file_obj.id),
                    "size_bytes": payload_size,
                },
            )
        )
        uow.session.add(
            AuditLog(
                org_id=snapshot["org_id"],
                actor_id=snapshot["user_id"],
                action=AuditAction.UPDATE,
                entity_type="docs_file",
                entity_id=str(file_obj.id),
                meta={
                    "event": "ai_generate_ready_for_scan",
                    "job_id": str(job.id),
                    "version_id": str(new_version.id),
                    "status": "scanning",
                    "file_type": snapshot["file_type"].value,
                },
            )
        )
        await uow.commit()

    _inc_ai_generate_metric("scanning", snapshot["file_type"].value)
    _inc_upload_metric(FileStatus.SCANNING.value)
    try:
        scan_version.delay(str(new_version_id))
    except (OperationalError, OSError, RuntimeError):
        scan_version.run(str(new_version_id))
    return {"status": "scanning", "job_id": str(snapshot["job_id"]), "file_id": str(snapshot["file_id"])}


async def _mark_ai_job_failed_unexpected(*, job_id: str, reason: str) -> None:
    """Fail-safe перевод job в failed при необработанном исключении task."""
    job_uuid = _safe_uuid(job_id)
    if job_uuid is None:
        return
    logger.error("docs_ai_generate_unexpected_failure", extra={"job_id": job_id, "reason": reason})
    async with UnitOfWork() as uow:
        repo = DocsRepository(uow.session)
        job = await repo.get_ai_generation_job_for_update(job_id=job_uuid)
        if job is None:
            logger.warning("docs_ai_generate_unexpected_failure_job_not_found", extra={"job_id": job_id})
            return
        if job.status in {"ready", "blocked", "failed"}:
            return
        await _mark_ai_job_failed(
            uow=uow,
            repo=repo,
            job=job,
            reason=f"Внутренняя ошибка генерации: {reason[:300]}",
            code="unexpected_exception",
        )


@celery.task(name="docs_cleanup_old_versions", bind=True, base=BaseTaskWithRetry)
def cleanup_old_doc_versions(self) -> dict[str, int | str]:
    """Удалить старые неактуальные версии документов по retention-политике."""
    _ = self
    retention_days = int(getattr(settings, "DOCS_RETENTION_DAYS", 0) or 0)
    keep_latest = max(1, int(getattr(settings, "DOCS_RETENTION_KEEP_LATEST", 5) or 5))
    batch_size = max(1, int(getattr(settings, "DOCS_RETENTION_BATCH_SIZE", 200) or 200))
    if retention_days <= 0:
        _inc_retention_metric("disabled")
        return {"status": "disabled", "deleted": 0}

    threshold = datetime.now(UTC) - timedelta(days=retention_days)
    deleted_count = 0
    scanned_files = 0
    with sync_session_factory() as session:
        files = (
            session.execute(
                select(File.id, File.current_version_id)
                .where(
                    File.type.in_([FileType.TXT.value, FileType.PDF.value, FileType.DOCX.value]),
                    File.current_version_id.is_not(None),
                )
                .limit(max(100, batch_size))
            )
        ).all()
        for file_id, current_version_id in files:
            scanned_files += 1
            versions = (
                (
                    session.execute(
                        select(FileVersion)
                        .where(
                            FileVersion.file_id == file_id,
                            FileVersion.id != current_version_id,
                            FileVersion.created_at < threshold,
                        )
                        .order_by(FileVersion.created_at.desc())
                    )
                )
                .scalars()
                .all()
            )
            if len(versions) <= keep_latest:
                continue
            for version in versions[keep_latest:]:
                if deleted_count >= batch_size:
                    break
                with suppress(BotoCoreError, ClientError, OSError):
                    # У StorageProvider нет публичного delete, поэтому используем базовый клиент files-модуля.
                    get_s3_client().delete_object(Bucket=version.s3_bucket, Key=version.s3_key)
                session.execute(delete(FileVersion).where(FileVersion.id == version.id))
                deleted_count += 1
            if deleted_count >= batch_size:
                break
        session.commit()
    _inc_retention_metric("ok")
    return {"status": "ok", "deleted": int(deleted_count), "scanned_files": int(scanned_files)}


@celery.task(name="docs_repair_docx_storage_integrity")
def docs_repair_docx_storage_integrity(*, dry_run: bool = False, limit: int = 500) -> dict[str, int | str]:
    """Проверить целостность текущих DOCX-версий в S3 и восстановить `create_empty` объекты."""
    safe_limit = max(1, min(int(limit or 500), 5000))
    checked = 0
    issues = 0
    recovered = 0
    blocked = 0

    with sync_session_factory() as session:
        rows = (
            session.execute(
                select(File, FileVersion)
                .join(FileVersion, FileVersion.id == File.current_version_id)
                .where(
                    File.type == FileType.DOCX.value,
                    File.current_version_id.is_not(None),
                )
                .order_by(File.updated_at.desc())
                .limit(safe_limit)
            )
        ).all()

        for file_obj, version in rows:
            checked += 1
            payload: bytes | None = None
            integrity_reason: str | None = None
            try:
                payload = DEFAULT_STORAGE_PROVIDER.get_object_bytes(bucket=version.s3_bucket, key=version.s3_key)
            except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
                integrity_reason = f"storage_read_error:{type(exc).__name__}"

            if payload is not None:
                magic_ok, magic_reason = validate_magic_bytes(FileType.DOCX, payload)
                if magic_ok:
                    continue
                integrity_reason = f"magic_mismatch:{magic_reason}"

            issues += 1
            version_meta = version.meta_json if isinstance(version.meta_json, dict) else {}
            source = str(version_meta.get("source") or "").strip().lower()
            if source == "create_empty":
                if dry_run:
                    continue

                title = str(file_obj.title or file_obj.original_name or "Документ").strip() or "Документ"
                regenerated, content_type, _ = render_document_bytes(file_type=FileType.DOCX, text="", title=title)
                DEFAULT_STORAGE_PROVIDER.put_object_bytes(
                    bucket=version.s3_bucket,
                    key=version.s3_key,
                    payload=regenerated,
                    content_type=content_type,
                )
                file_obj.size = len(regenerated)
                file_obj.content_type = content_type
                version.size_bytes = len(regenerated)
                version.mime = content_type
                version.sha256 = sha256(regenerated).hexdigest()
                version_meta["storage_recovery"] = {
                    "strategy": "regenerate_empty_docx",
                    "recovered_at": datetime.now(UTC).isoformat(),
                    "reason": integrity_reason,
                }
                version.meta_json = version_meta
                session.add(
                    AuditLog(
                        org_id=file_obj.org_id,
                        actor_id=file_obj.uploaded_by,
                        action=AuditAction.UPDATE,
                        entity_type="docs_file",
                        entity_id=str(file_obj.id),
                        meta={
                            "event": "docx_storage_repair_recovered",
                            "version_id": str(version.id),
                            "reason": integrity_reason,
                        },
                    )
                )
                recovered += 1
                continue

            if dry_run:
                continue

            file_obj.status = FileStatus.BLOCKED.value
            version_meta["integrity_error"] = {
                "reason": integrity_reason,
                "detected_at": datetime.now(UTC).isoformat(),
            }
            version.meta_json = version_meta
            session.add(
                AuditLog(
                    org_id=file_obj.org_id,
                    actor_id=file_obj.uploaded_by,
                    action=AuditAction.UPDATE,
                    entity_type="docs_file",
                    entity_id=str(file_obj.id),
                    meta={
                        "event": "docx_storage_repair_blocked",
                        "version_id": str(version.id),
                        "reason": integrity_reason,
                    },
                )
            )
            blocked += 1

        session.commit()

    logger.info(
        "docs_repair_docx_storage_integrity_done",
        extra={
            "checked": checked,
            "issues": issues,
            "recovered": recovered,
            "blocked": blocked,
            "dry_run": bool(dry_run),
            "limit": safe_limit,
        },
    )
    return {
        "status": "ok",
        "checked": checked,
        "issues": issues,
        "recovered": recovered,
        "blocked": blocked,
    }


@celery.task(name="docs_cleanup_stale_files", bind=True, base=BaseTaskWithRetry)
def docs_cleanup_stale_files(self) -> dict[str, int | str]:
    """Удалить зависшие UPLOADING и DRAFT файлы и их временные S3 объекты."""
    _ = self
    threshold = datetime.now(UTC) - timedelta(hours=24)
    batch_size = max(1, int(getattr(settings, "DOCS_RETENTION_BATCH_SIZE", 200) or 200))
    deleted_count = 0

    with sync_session_factory() as session:
        files = (
            session.execute(
                select(File)
                .where(
                    File.status.in_([FileStatus.UPLOADING.value, FileStatus.DRAFT.value]),
                    File.created_at < threshold,
                )
                .limit(batch_size)
            )
            .scalars()
            .all()
        )

        s3_client = None
        with suppress(ImportError, RuntimeError, ValueError, BotoCoreError, ClientError):
            s3_client = get_s3_client()

        for file_obj in files:
            # Освобождаем reserved квоту
            with suppress(Exception):
                usage = session.execute(
                    select(OrgStorageUsage).where(OrgStorageUsage.org_id == file_obj.org_id).with_for_update()
                ).scalar_one_or_none()
                if usage:
                    usage.reserved_bytes = max(0, int(usage.reserved_bytes) - int(file_obj.size or 0))

            # Удаляем из S3
            if s3_client and getattr(file_obj, "s3_bucket", None) and getattr(file_obj, "s3_key", None):
                with suppress(Exception):
                    s3_client.delete_object(Bucket=file_obj.s3_bucket, Key=file_obj.s3_key)

            session.execute(delete(File).where(File.id == file_obj.id))
            deleted_count += 1

        session.commit()

    _inc_retention_metric("stale_files_ok")
    return {"status": "ok", "deleted": deleted_count}


async def _mark_ai_job_failed(
    *,
    uow: UnitOfWork,
    repo: DocsRepository,
    job: DocsAIGenerationJob,
    reason: str,
    code: str,
    release_reserved: bool = True,
) -> None:
    """Перевести AI job в failed и аккуратно снять резерв квоты."""
    if release_reserved:
        usage = await repo.get_storage_usage_for_update(org_id=job.org_id)
        usage.reserved_bytes = max(0, int(usage.reserved_bytes) - _extract_reserved_bytes(job.meta_json))
        await repo.update_storage_usage(usage)

    if job.file_id is not None:
        file_obj = await repo.get_doc_file(file_id=job.file_id, org_id=job.org_id)
        if file_obj is not None and file_obj.status in {FileStatus.DRAFT.value, FileStatus.UPLOADING.value}:
            file_obj.status = FileStatus.BLOCKED.value
            await repo.update_file(file_obj)

    job.status = "failed"
    job.error_message = reason[:1000]
    job.finished_at = datetime.now(UTC)
    await repo.update_ai_generation_job(job)

    try:
        uow.session.add(
            AuditLog(
                org_id=job.org_id,
                actor_id=job.user_id,
                action=AuditAction.UPDATE,
                entity_type="docs_ai_generation_job",
                entity_id=str(job.id),
                meta={"event": "ai_generate_failed", "reason": reason[:300], "code": code},
            )
        )
    except SQLAlchemyError:
        logger.exception("docs_ai_generate_audit_log_failed", extra={"job_id": str(job.id)})

    await uow.commit()
    logger.info("docs_ai_job_marked_failed", extra={"job_id": str(job.id), "code": code})
    file_type = str(job.file_type or "unknown")
    _inc_ai_generate_metric("failed", file_type)
    _inc_ai_generate_error_metric(code)


def _extract_reserved_bytes(meta_json: dict | None) -> int:
    """Извлечь reserved_bytes из meta_json job."""
    if not isinstance(meta_json, dict):
        return 0
    try:
        return max(0, int(meta_json.get("reserved_bytes") or 0))
    except (TypeError, ValueError):
        return 0


async def _resolve_storage_limit_bytes(*, session, org_id: uuid.UUID) -> int:
    """Получить лимит docs-хранилища по активному тарифу организации."""
    plan = await DocsRepository(session).resolve_effective_plan(org_id=org_id)
    max_storage_mb = int(getattr(plan, "max_storage_mb", 0) or 0)
    if max_storage_mb <= 0:
        return 0
    return int(max_storage_mb) * 1024 * 1024


def _scan_payload(*, file_obj: File, version: FileVersion) -> AntivirusScanResult:
    """Проверить magic bytes и выполнить AV-скан объекта."""
    declared_type = _resolve_file_type(file_obj.type)
    if declared_type is None:
        return AntivirusScanResult(result="magic_mismatch", details="invalid_declared_type")

    try:
        payload = DEFAULT_STORAGE_PROVIDER.get_object_bytes(bucket=version.s3_bucket, key=version.s3_key)
    except (BotoCoreError, ClientError, KeyError, OSError, ValueError) as exc:
        return AntivirusScanResult(result="error", details=f"storage_read_error: {exc}")

    return _scan_payload_bytes(file_type=declared_type, payload=payload)


def _scan_payload_bytes(*, file_type: FileType, payload: bytes) -> AntivirusScanResult:
    """Проверить magic bytes и выполнить AV-скан готового payload."""
    magic_ok, magic_reason = validate_magic_bytes(file_type, payload)
    if not magic_ok:
        return AntivirusScanResult(result="magic_mismatch", details=magic_reason)

    provider = build_antivirus_provider()
    chunk_size = max(8 * 1024, int(getattr(settings, "DOCS_SCAN_CHUNK_SIZE_KB", 256)) * 1024)
    av_result = provider.scan_stream(_iter_payload_chunks(payload, chunk_size=chunk_size))

    if av_result.result == "infected":
        return AntivirusScanResult(
            result="infected",
            threat_name=av_result.threat_name,
            details=av_result.details,
        )
    if av_result.result == "clean":
        return AntivirusScanResult(result="clean", details=magic_reason)
    return AntivirusScanResult(result="error", details=av_result.details or "scan_error")


def _safe_uuid(raw: str | None) -> uuid.UUID | None:
    """Безопасно распарсить UUID из строки."""
    try:
        return uuid.UUID(str(raw)) if raw else None
    except (TypeError, ValueError, AttributeError):
        return None


def _resolve_file_type(file_type: str | None) -> FileType | None:
    """Нормализовать строковый тип файла в enum."""
    raw = str(file_type or "").strip().lower()
    if raw == FileType.TXT.value:
        return FileType.TXT
    if raw == FileType.PDF.value:
        return FileType.PDF
    if raw == FileType.DOCX.value:
        return FileType.DOCX
    return None


def _iter_payload_chunks(payload: bytes, *, chunk_size: int) -> Iterable[bytes]:
    """Разбить payload на чанки для потоковой передачи в AV."""
    chunk_size = max(8 * 1024, int(chunk_size))
    offset = 0
    while offset < len(payload):
        yield payload[offset : offset + chunk_size]
        offset += chunk_size


def _to_docx_filename(raw_name: str | None) -> str:
    """Нормализовать имя файла к расширению .docx."""
    name = str(raw_name or "").strip()
    if not name:
        return "document.docx"
    stem, _ = os.path.splitext(name)
    safe_stem = (stem or name).strip() or "document"
    return f"{safe_stem}.docx"


def _inc_scan_metric(result: str) -> None:
    """Безопасно инкрементировать метрику scan."""
    with suppress(Exception):
        FILE_SCAN_TOTAL.labels(result=result).inc()


def _inc_upload_metric(status: str) -> None:
    """Безопасно инкрементировать метрику upload pipeline."""
    with suppress(Exception):
        UPLOADS_TOTAL.labels(status=status).inc()


def _inc_ai_generate_metric(status: str, file_type: str) -> None:
    """Безопасно инкрементировать метрику AI-генерации документов."""
    with suppress(Exception):
        DOCS_AI_GENERATE_TOTAL.labels(status=status, file_type=file_type).inc()


def _inc_ai_generate_error_metric(reason: str) -> None:
    """Безопасно инкрементировать метрику ошибок AI-генерации."""
    with suppress(Exception):
        DOCS_AI_GENERATE_ERRORS_TOTAL.labels(reason=reason).inc()


def _inc_retention_metric(status: str) -> None:
    DOCS_RETENTION_CLEANUP_TOTAL.labels(status=status).inc()


@celery.task(name="docs_delete_file_background")
def docs_delete_file_background(file_id: str) -> dict[str, int | str]:
    """Фоновое удаление файла и всех его версий из S3 и БД."""
    try:
        file_uuid = uuid.UUID(str(file_id))
    except (TypeError, ValueError, AttributeError):
        return {"status": "error", "reason": "invalid_file_id"}

    deleted_versions = 0
    with sync_session_factory() as session:
        file_obj = session.execute(select(File).where(File.id == file_uuid)).scalar_one_or_none()
        if not file_obj:
            return {"status": "skipped", "reason": "file_not_found"}

        s3_client = None
        with suppress(ImportError, RuntimeError, ValueError, BotoCoreError, ClientError):
            s3_client = get_s3_client()

        versions = session.execute(select(FileVersion).where(FileVersion.file_id == file_uuid)).scalars().all()

        # Удаляем каждую версию из S3 и БД
        for version in versions:
            if s3_client and version.s3_bucket and version.s3_key:
                with suppress(Exception):
                    s3_client.delete_object(Bucket=version.s3_bucket, Key=version.s3_key)
            session.execute(delete(FileVersion).where(FileVersion.id == version.id))
            deleted_versions += 1

        # Зачастую `file_obj.s3_key` есть, а `FileVersion` нет (незавершенная загрузка или упавшая AI генерация).
        # Пытаемся удалить из S3 и `file_obj.s3_key`.
        if s3_client and getattr(file_obj, "s3_bucket", None) and getattr(file_obj, "s3_key", None):
            with suppress(Exception):
                s3_client.delete_object(Bucket=file_obj.s3_bucket, Key=file_obj.s3_key)

        session.execute(delete(File).where(File.id == file_uuid))
        session.commit()
    return {"status": "ok", "deleted_versions": deleted_versions}
