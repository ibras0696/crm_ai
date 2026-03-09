import asyncio
import sys

# Add src to path
sys.path.append("/app")

from sqlalchemy import select

from src.infrastructure.uow import UnitOfWork
from src.modules.docs.models import DocsAIGenerationJob
from src.modules.docs.service import DocsService


async def test():
    async with UnitOfWork() as uow:
        from src.modules.org.models import Membership, Organization

        org = (await uow.session.execute(select(Organization).limit(1))).scalar_one_or_none()
        if not org:
            print("No org found.")
            return

        membership = (
            await uow.session.execute(select(Membership).where(Membership.org_id == org.id).limit(1))
        ).scalar_one_or_none()

        if not membership:
            print(f"No membership found for org {org.id}")
            return

        user_id = membership.user_id
        service = DocsService(uow.session)
        print(f"Testing with Org: {org.id}, User: {user_id}")

        try:
            result = await service.request_ai_generate(
                org_id=org.id,
                user_id=user_id,
                file_type="docx",
                prompt="Write a simple business letter.",
                template=None,
                folder_id=None,
                title="Test Doc",
                language="ru",
            )
            job_id = result.job.id
            print(f"Job created: {job_id}. Status: {result.job.status}")
            await uow.commit()  # Initial request commit

            # Now trigger the task manually (inline)
            from src.modules.docs.tasks import run_ai_generate_inline

            print("Running AI generate task inline...")
            # We run it in a separate task but we need to wait for it.
            # run_ai_generate_inline is async.
            task_result = await run_ai_generate_inline(job_id=str(job_id), task_id="test-inline")
            print(f"Task completion returned: {task_result}")

            # Start a new session to see the committed changes
            async with UnitOfWork() as uow2:
                job = (
                    await uow2.session.execute(select(DocsAIGenerationJob).where(DocsAIGenerationJob.id == job_id))
                ).scalar_one_or_none()
                print(f"Final Job Status in DB: {job.status}")
                print(f"Error Message: {job.error_message}")

        except Exception as e:
            print(f"Exception during test: {e}")
            import traceback

            traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test())
