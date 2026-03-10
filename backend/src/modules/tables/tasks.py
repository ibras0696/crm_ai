"""Celery tasks for tables module."""

import logging
from datetime import datetime, timedelta

from celery import shared_task
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from src.infrastructure.celery_base import BaseTaskWithRetry
from src.infrastructure.database_sync import get_sync_session

logger = logging.getLogger(__name__)


@shared_task(base=BaseTaskWithRetry, name="create_monthly_partition")
def create_monthly_partition():
    """Create next month's partition for table_records."""
    try:
        with get_sync_session() as session:
            session.execute(text("SELECT create_monthly_partition()"))
            session.commit()
            logger.info("Successfully created monthly partition")
    except SQLAlchemyError as e:
        logger.error(f"Failed to create monthly partition: {e}")
        raise


@shared_task(base=BaseTaskWithRetry, name="archive_old_records")
def archive_old_records(months_old: int = 24):
    """Archive table_records older than specified months."""
    try:
        with get_sync_session() as session:
            session.execute(text("SELECT archive_old_partition(:months)"), {"months": months_old})
            session.commit()
            logger.info(f"Successfully archived records older than {months_old} months")
    except SQLAlchemyError as e:
        logger.error(f"Failed to archive old records: {e}")
        raise


@shared_task(base=BaseTaskWithRetry, name="cleanup_soft_deleted_records")
def cleanup_soft_deleted_records(days_old: int = 90):
    """Permanently delete soft-deleted records older than specified days."""
    try:
        cutoff_date = datetime.now() - timedelta(days=days_old)

        with get_sync_session() as session:
            # Delete from table_records
            result = session.execute(
                text("""
                    DELETE FROM table_records
                    WHERE deleted_at IS NOT NULL
                    AND deleted_at < :cutoff_date
                """),
                {"cutoff_date": cutoff_date},
            )
            deleted_count = result.rowcount
            session.commit()

            logger.info(f"Cleaned up {deleted_count} soft-deleted records older than {days_old} days")
            return deleted_count
    except SQLAlchemyError as e:
        logger.error(f"Failed to cleanup soft-deleted records: {e}")
        raise
