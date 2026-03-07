import asyncio
import os
import sys
from datetime import datetime, timedelta, UTC

# Add src to path
sys.path.append("/app")

# CRITICAL: Import all models to register them with SQLAlchemy metadata
from src.modules.org.models import Organization, Membership, Subscription, Invite
from src.modules.auth.models import User, RefreshToken
from src.modules.files.models import File
from src.modules.docs.models import DocsAIGenerationJob, Folder, FileVersion, OrgStorageUsage
from src.modules.audit.models import AuditLog

from src.infrastructure.uow import UnitOfWork
from sqlalchemy import select

async def cleanup():
    async with UnitOfWork() as uow:
        # Find jobs stuck in 'queued' or 'running' status for more than 2 minutes
        time_threshold = datetime.now(UTC) - timedelta(minutes=2)
        
        stmt = (
            select(DocsAIGenerationJob)
            .where(
                DocsAIGenerationJob.status.in_(["queued", "running"]),
                DocsAIGenerationJob.created_at < time_threshold
            )
        )
        res = await uow.session.execute(stmt)
        stuck_jobs = res.scalars().all()
        
        if not stuck_jobs:
            print("No stuck jobs found.")
            return

        print(f"Found {len(stuck_jobs)} stuck jobs. Marking as failed...")
        
        for job in stuck_jobs:
            print(f"Cleaning up Job {job.id} (Status: {job.status}, Created: {job.created_at})")
            job.status = "failed"
            job.error_message = "[System Cleanup] Task was stuck in queue/running state for too long. Process was likely interrupted before the fix."
            job.finished_at = datetime.now(UTC)
            
            if job.file_id:
                file_stmt = select(File).where(File.id == job.file_id)
                file_res = await uow.session.execute(file_stmt)
                file_obj = file_res.scalar_one_or_none()
                if file_obj and file_obj.status in ["generating", "uploading", "draft"]:
                    file_obj.status = "blocked" 
                    print(f"  - Marked associated file {file_obj.id} as blocked")

        await uow.commit()
        print("Cleanup complete.")

if __name__ == "__main__":
    asyncio.run(cleanup())
