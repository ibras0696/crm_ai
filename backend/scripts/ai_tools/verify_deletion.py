import asyncio
import os
import sys
import uuid
from datetime import datetime, UTC

# Add src to path
sys.path.append("/app")

from src.infrastructure.database import async_session_factory
from src.modules.docs.models import DocsAIGenerationJob
from src.modules.files.models import File
from src.modules.docs.domain import FileStatus, FileType
from sqlalchemy import select

async def verify():
    async with async_session_factory() as session:
        # 1. Choose an organization (use the first one found)
        from src.modules.org.models import Organization
        org = (await session.execute(select(Organization).limit(1))).scalar_one_or_none()
        if not org:
            print("No organization found")
            return
        
        org_id = org.id
        from src.modules.auth.models import User
        user = (await session.execute(select(User).limit(1))).scalar_one_or_none()
        user_id = user.id if user else uuid.uuid4()

        print(f"Using org_id: {org_id}, user_id: {user_id}")

        # 2. Create a "blocked" file
        file_id = uuid.uuid4()
        file_obj = File(
            id=file_id,
            org_id=org_id,
            uploaded_by=user_id,
            filename="test_blocked_file.docx",
            original_name="test_blocked_file.docx",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            size=0,
            s3_key=f"org/{org_id}/files/{file_id}/blocked_test",
            s3_bucket="crm-files",
            type=FileType.DOCX.value,
            status=FileStatus.SCANNING.value, # Simulating generation
            title="Blocked Test File",
        )
        session.add(file_obj)
        await session.flush()
        
        # 3. Create an associated AI generation job
        job = DocsAIGenerationJob(
            id=uuid.uuid4(),
            org_id=org_id,
            user_id=user_id,
            file_id=file_id,
            file_type=FileType.DOCX.value,
            status="running",
            prompt="Test prompt",
            title="Blocked Test File",
        )
        session.add(job)
        await session.flush()
        await session.commit()
        
        print(f"Created file {file_id} (SCANNING) and job {job.id} (running)")
        
        # 4. Use DocsService to delete the file
        from src.modules.docs.service import DocsService
        service = DocsService(session)
        await service.delete_file(org_id=org_id, file_id=file_id, user_id=user_id)
        await session.commit()
        
        print(f"Deleted file {file_id}")
        
        # 5. Verify status after deletion
        # Refresh session or use new one
        async with async_session_factory() as session2:
            # Check file status
            file_res = (await session2.execute(select(File).where(File.id == file_id))).scalar_one_or_none()
            print(f"File status after delete: {file_res.status if file_res else 'NOT FOUND'}")
            
            # Check AI job status
            job_res = (await session2.execute(select(DocsAIGenerationJob).where(DocsAIGenerationJob.file_id == file_id))).scalar_one_or_none()
            print(f"Job status after file delete: {job_res.status if job_res else 'NOT FOUND'}")
            print(f"Job error message: {job_res.error_message if job_res else 'N/A'}")

            if file_res and file_res.status == FileStatus.DELETED.value and job_res and job_res.status == "failed":
                print("\nVERIFICATION SUCCESSFUL")
            else:
                print("\nVERIFICATION FAILED")

if __name__ == "__main__":
    asyncio.run(verify())
