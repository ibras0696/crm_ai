"""Celery tasks for chat background operations."""

import uuid

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from src.infrastructure.celery_app import celery
from src.infrastructure.celery_base import BaseTaskWithRetry
from src.infrastructure.database_sync import sync_session_factory
from src.modules.files import storage as files_storage
from src.modules.files.models import File


def _count_attachment_references_sync(*, session: Session, org_id: uuid.UUID, file_id: uuid.UUID) -> int:
    sql = """
        SELECT COUNT(*)
        FROM chat_messages
        WHERE org_id = :org_id
          AND (
            COALESCE(meta->'attachment_ids', '[]'::jsonb) ? :file_id_text
            OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(meta->'attachments', '[]'::jsonb)) AS elem
                WHERE elem->>'file_id' = :file_id_text
            )
          )
    """
    params: dict[str, object] = {"org_id": org_id, "file_id_text": str(file_id)}
    result = session.execute(text(sql), params)
    return int(result.scalar_one() or 0)


@celery.task(name="chat_cleanup_attachments", bind=True, base=BaseTaskWithRetry)
def chat_cleanup_attachments(self, *, org_id: str, file_ids: list[str]) -> dict[str, int]:
    """Delete orphan chat attachments from storage and metadata table."""
    _ = self
    unique_ids = list(dict.fromkeys(str(item) for item in (file_ids or []) if str(item).strip()))
    if not unique_ids:
        return {"received": 0, "deleted": 0, "skipped": 0}

    org_uuid = uuid.UUID(org_id)
    deleted = 0
    skipped = 0

    with sync_session_factory() as session:
        for file_id_str in unique_ids:
            file_uuid = uuid.UUID(file_id_str)

            if _count_attachment_references_sync(session=session, org_id=org_uuid, file_id=file_uuid) > 0:
                skipped += 1
                continue

            db_file = (
                session.execute(
                    select(File).where(
                        File.id == file_uuid,
                        File.org_id == org_uuid,
                    )
                )
                .scalars()
                .one_or_none()
            )
            if db_file is None:
                skipped += 1
                continue
            if str(db_file.type or "") != "chat_attachment":
                skipped += 1
                continue

            try:
                files_storage.delete_file(db_file.s3_key, db_file.s3_bucket)
            except ClientError as exc:
                code = str((exc.response or {}).get("Error", {}).get("Code", ""))
                # Idempotency: if object is already absent, continue and remove stale DB row.
                if code not in {"404", "NoSuchKey", "NotFound"}:
                    raise
            except (BotoCoreError, KeyError, OSError, ValueError):
                raise

            session.delete(db_file)
            deleted += 1

        session.commit()

    return {"received": len(unique_ids), "deleted": deleted, "skipped": skipped}
