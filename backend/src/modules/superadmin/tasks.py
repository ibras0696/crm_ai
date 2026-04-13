"""Celery tasks for superadmin operations."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from typing import Any

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import SQLAlchemyError

from src.infrastructure.celery_app import celery
from src.infrastructure.celery_base import BaseTaskWithRetry
from src.infrastructure.database_sync import sync_session_factory
from src.modules.docs.models import FileVersion
from src.modules.files import storage
from src.modules.files.models import File
from src.modules.org.models import Organization
from src.modules.superadmin.models import SuperadminOrgDeletionJob

logger = logging.getLogger(__name__)


@celery.task(
    name="superadmin_delete_org_background",
    bind=True,
    base=BaseTaskWithRetry,
    soft_time_limit=1800,
    time_limit=2100,
)
def superadmin_delete_org_background(self, job_id: str) -> dict[str, Any]:
    """Delete organization and all related data in background."""
    _ = self
    job_uuid = _safe_uuid(job_id)
    if job_uuid is None:
        return {"status": "invalid_job_id"}

    try:
        return _run_org_deletion_job(job_uuid)
    except (SQLAlchemyError, BotoCoreError, ClientError, OSError, RuntimeError, ValueError, TypeError) as exc:
        _mark_job_failed(job_uuid=job_uuid, error_message=str(exc))
        raise


def _run_org_deletion_job(job_uuid: uuid.UUID) -> dict[str, Any]:
    with sync_session_factory() as session:
        job = session.get(SuperadminOrgDeletionJob, job_uuid)
        if job is None:
            return {"status": "job_not_found"}
        if job.status == "completed":
            return {"status": "completed", "org_id": str(job.org_id), "job_id": str(job.id)}

        job.status = "running"
        job.error_message = None
        job.finished_at = None
        job.started_at = datetime.now(UTC)
        session.commit()

        org_id = job.org_id
        file_objects_total = _count_file_objects(session=session, org_id=org_id)
        version_objects_total = _count_version_objects(session=session, org_id=org_id)
        progress_total = int(file_objects_total + version_objects_total)
        batch_size = _resolve_batch_size(progress_total)

        job.progress_total = progress_total
        job.progress_processed = 0
        job.storage_objects_deleted = 0
        job.meta_json = {
            "phase": "deleting_storage",
            "file_objects_total": int(file_objects_total),
            "version_objects_total": int(version_objects_total),
            "batch_size": int(batch_size),
        }
        session.commit()

        deleted_objects = 0
        processed_objects = 0
        deleted_objects, processed_objects = _delete_file_objects(
            session=session,
            org_id=org_id,
            batch_size=batch_size,
            deleted_objects=deleted_objects,
            processed_objects=processed_objects,
            job=job,
        )
        deleted_objects, processed_objects = _delete_version_objects(
            session=session,
            org_id=org_id,
            batch_size=batch_size,
            deleted_objects=deleted_objects,
            processed_objects=processed_objects,
            job=job,
        )

        org_deleted = _delete_organization(session=session, org_id=org_id)

        job.status = "completed"
        job.progress_processed = int(processed_objects)
        job.storage_objects_deleted = int(deleted_objects)
        job.finished_at = datetime.now(UTC)
        job.error_message = None
        job.meta_json = {
            "phase": "done",
            "file_objects_total": int(file_objects_total),
            "version_objects_total": int(version_objects_total),
            "batch_size": int(batch_size),
            "org_deleted": bool(org_deleted),
        }
        session.commit()

        return {
            "status": "completed",
            "org_id": str(org_id),
            "job_id": str(job.id),
            "progress_total": int(progress_total),
            "processed_objects": int(processed_objects),
            "deleted_objects": int(deleted_objects),
            "org_deleted": bool(org_deleted),
        }


def _count_file_objects(*, session, org_id: uuid.UUID) -> int:
    return int(session.execute(select(func.count(File.id)).where(File.org_id == org_id)).scalar() or 0)


def _count_version_objects(*, session, org_id: uuid.UUID) -> int:
    return int(
        session.execute(
            select(func.count(FileVersion.id))
            .join(File, File.id == FileVersion.file_id)
            .where(File.org_id == org_id)
        ).scalar()
        or 0
    )


def _delete_file_objects(
    *,
    session,
    org_id: uuid.UUID,
    batch_size: int,
    deleted_objects: int,
    processed_objects: int,
    job: SuperadminOrgDeletionJob,
) -> tuple[int, int]:
    cursor_created_at: datetime | None = None
    cursor_id: uuid.UUID | None = None

    while True:
        stmt = (
            select(File.id, File.created_at, File.s3_bucket, File.s3_key)
            .where(File.org_id == org_id)
            .order_by(File.created_at.asc(), File.id.asc())
            .limit(batch_size)
        )
        if cursor_created_at is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    File.created_at > cursor_created_at,
                    and_(File.created_at == cursor_created_at, File.id > cursor_id),
                )
            )

        rows = session.execute(stmt).all()
        if not rows:
            return deleted_objects, processed_objects

        for file_id, created_at, bucket, key in rows:
            processed_objects += 1
            if bucket and key and _try_delete_storage_object(bucket=bucket, key=key):
                deleted_objects += 1
            cursor_id = file_id
            cursor_created_at = created_at

        job.progress_processed = int(processed_objects)
        job.storage_objects_deleted = int(deleted_objects)
        job.meta_json = {**(job.meta_json or {}), "phase": "deleting_files"}
        session.commit()


def _delete_version_objects(
    *,
    session,
    org_id: uuid.UUID,
    batch_size: int,
    deleted_objects: int,
    processed_objects: int,
    job: SuperadminOrgDeletionJob,
) -> tuple[int, int]:
    cursor_created_at: datetime | None = None
    cursor_id: uuid.UUID | None = None

    while True:
        stmt = (
            select(FileVersion.id, FileVersion.created_at, FileVersion.s3_bucket, FileVersion.s3_key)
            .join(File, File.id == FileVersion.file_id)
            .where(File.org_id == org_id)
            .order_by(FileVersion.created_at.asc(), FileVersion.id.asc())
            .limit(batch_size)
        )
        if cursor_created_at is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    FileVersion.created_at > cursor_created_at,
                    and_(FileVersion.created_at == cursor_created_at, FileVersion.id > cursor_id),
                )
            )

        rows = session.execute(stmt).all()
        if not rows:
            return deleted_objects, processed_objects

        for version_id, created_at, bucket, key in rows:
            processed_objects += 1
            if bucket and key and _try_delete_storage_object(bucket=bucket, key=key):
                deleted_objects += 1
            cursor_id = version_id
            cursor_created_at = created_at

        job.progress_processed = int(processed_objects)
        job.storage_objects_deleted = int(deleted_objects)
        job.meta_json = {**(job.meta_json or {}), "phase": "deleting_versions"}
        session.commit()


def _delete_organization(*, session, org_id: uuid.UUID) -> bool:
    org = session.get(Organization, org_id)
    if org is None:
        return False
    session.delete(org)
    session.commit()
    return True


def _try_delete_storage_object(*, bucket: str, key: str) -> bool:
    try:
        storage.delete_file(key, bucket)
        return True
    except (BotoCoreError, ClientError, OSError, RuntimeError, ValueError, TypeError):
        logger.warning(
            "superadmin_org_delete_storage_object_failed",
            extra={"bucket": bucket, "key": key},
        )
        return False


def _mark_job_failed(*, job_uuid: uuid.UUID, error_message: str) -> None:
    with sync_session_factory() as session:
        job = session.get(SuperadminOrgDeletionJob, job_uuid)
        if job is None:
            return
        job.status = "failed"
        job.finished_at = datetime.now(UTC)
        job.error_message = (error_message or "Unknown error")[:1000]
        job.meta_json = {**(job.meta_json or {}), "phase": "failed"}
        session.commit()


def _resolve_batch_size(progress_total: int) -> int:
    if progress_total >= 20000:
        return 1000
    if progress_total >= 5000:
        return 500
    return 200


def _safe_uuid(value: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None
