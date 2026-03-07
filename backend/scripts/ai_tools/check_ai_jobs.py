import asyncio
import os
import sys

# Add src to path
sys.path.append("/app")

from src.infrastructure.database import async_session_factory
from src.modules.docs.models import DocsAIGenerationJob
from sqlalchemy import select

async def check():
    async with async_session_factory() as s:
        res = await s.execute(select(DocsAIGenerationJob).order_by(DocsAIGenerationJob.created_at.desc()).limit(20))
        jobs = res.scalars().all()
        if not jobs:
            print("No AI jobs found.")
            return
        for j in jobs:
            print(f"ID: {j.id} | Status: {j.status} | Type: {j.file_type} | Created: {j.created_at}")
            if j.error_message:
                print(f"  Error: {j.error_message}")
            if j.meta_json:
                print(f"  Meta: {j.meta_json}")

if __name__ == "__main__":
    asyncio.run(check())
