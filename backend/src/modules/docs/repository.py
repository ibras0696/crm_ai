"""Репозитории модуля Docs: только SQL-операции, без commit."""
# ruff: noqa: TC002,TC003

from __future__ import annotations

import uuid

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.common.enums import SubscriptionStatus
from src.modules.billing.models import Plan
from src.modules.docs.domain import FileStatus, FileType
from src.modules.docs.models import DocsAIGenerationJob, FileVersion, Folder, OrgStorageUsage
from src.modules.files.models import File
from src.modules.org.models import Organization, Subscription


class DocsRepository:
    """Единый репозиторий Docs для CRUD и выборок по модулю."""

    def __init__(self, session: AsyncSession):
        self.session = session

    async def resolve_effective_plan(self, *, org_id: uuid.UUID) -> Plan | None:
        """Определить эффективный тариф организации."""
        sub = (
            await self.session.execute(select(Subscription).where(Subscription.org_id == org_id).limit(1))
        ).scalar_one_or_none()

        plan_name = None
        if sub and sub.status in {SubscriptionStatus.ACTIVE, SubscriptionStatus.PAST_DUE}:
            plan_name = str(getattr(sub.plan, "value", sub.plan))
        if not plan_name:
            org_plan = (
                await self.session.execute(select(Organization.plan).where(Organization.id == org_id).limit(1))
            ).scalar_one_or_none()
            plan_name = str(getattr(org_plan, "value", org_plan or "free"))

        return (
            await self.session.execute(select(Plan).where(Plan.name == plan_name.lower(), Plan.is_active.is_(True)))
        ).scalar_one_or_none()

    async def create_folder(self, folder: Folder) -> Folder:
        """Создать папку."""
        self.session.add(folder)
        await self.session.flush()
        return folder

    async def get_folder(self, *, folder_id: uuid.UUID, org_id: uuid.UUID) -> Folder | None:
        """Получить папку организации по id."""
        stmt = select(Folder).where(Folder.id == folder_id, Folder.org_id == org_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_folders(self, *, org_id: uuid.UUID) -> list[Folder]:
        """Список папок организации."""
        stmt = (
            select(Folder)
            .where(Folder.org_id == org_id)
            .order_by(Folder.position.asc(), Folder.created_at.asc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_max_folder_position(self, *, org_id: uuid.UUID) -> int:
        """Получить максимальную позицию папки в организации."""
        stmt = select(func.coalesce(func.max(Folder.position), -1)).where(Folder.org_id == org_id)
        return int((await self.session.execute(stmt)).scalar() or 0)

    async def update_folder(self, folder: Folder) -> Folder:
        """Обновить папку."""
        await self.session.flush()
        return folder

    async def delete_folder(self, folder: Folder) -> None:
        """Удалить папку."""
        await self.session.delete(folder)
        await self.session.flush()

    async def count_child_folders(self, *, folder_id: uuid.UUID, org_id: uuid.UUID) -> int:
        """Посчитать дочерние папки."""
        stmt = select(func.count(Folder.id)).where(Folder.org_id == org_id, Folder.parent_id == folder_id)
        return int((await self.session.execute(stmt)).scalar() or 0)

    async def count_files_in_folder(self, *, folder_id: uuid.UUID, org_id: uuid.UUID) -> int:
        """Посчитать файлы в папке."""
        stmt = select(func.count(File.id)).where(
            File.org_id == org_id,
            File.folder_id == folder_id,
            File.type.in_([FileType.TXT.value, FileType.PDF.value, FileType.DOCX.value]),
            File.status != FileStatus.DELETED.value,
        )
        return int((await self.session.execute(stmt)).scalar() or 0)

    async def create_file(self, file_obj: File) -> File:
        """Создать файл."""
        self.session.add(file_obj)
        await self.session.flush()
        return file_obj

    async def get_doc_file(self, *, file_id: uuid.UUID, org_id: uuid.UUID) -> File | None:
        """Получить файл Docs по id в рамках организации."""
        stmt = select(File).where(
            File.id == file_id,
            File.org_id == org_id,
            File.type.in_([FileType.TXT.value, FileType.PDF.value, FileType.DOCX.value]),
            File.status != FileStatus.DELETED.value,
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_doc_files(self, *, org_id: uuid.UUID) -> list[File]:
        """Список файлов Docs по организации."""
        stmt = (
            select(File)
            .where(
                File.org_id == org_id,
                File.type.in_([FileType.TXT.value, FileType.PDF.value, FileType.DOCX.value]),
                File.status != FileStatus.DELETED.value,
            )
            .order_by(File.created_at.desc())
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def update_file(self, file_obj: File) -> File:
        """Обновить файл."""
        await self.session.flush()
        return file_obj

    async def create_file_version(self, version: FileVersion) -> FileVersion:
        """Создать запись версии файла."""
        self.session.add(version)
        await self.session.flush()
        return version

    async def get_file_version(self, *, version_id: uuid.UUID, file_id: uuid.UUID) -> FileVersion | None:
        """Получить версию файла по id и file_id."""
        stmt = select(FileVersion).where(FileVersion.id == version_id, FileVersion.file_id == file_id)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_file_version_by_id(self, *, version_id: uuid.UUID) -> FileVersion | None:
        """Получить версию файла по id (для внутренних нужд)."""
        stmt = select(FileVersion).where(FileVersion.id == version_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_file_versions(self, *, file_id: uuid.UUID, limit: int = 50) -> list[FileVersion]:
        """Получить историю версий файла (сначала новые)."""
        stmt = (
            select(FileVersion)
            .where(FileVersion.file_id == file_id)
            .order_by(FileVersion.created_at.desc())
            .limit(max(1, int(limit)))
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def sum_ready_file_bytes(self, *, org_id: uuid.UUID) -> int:
        """Рассчитать занятый объем по актуальным версиям Docs-файлов."""
        stmt = select(func.coalesce(func.sum(File.size), 0)).where(
            File.org_id == org_id,
            File.type.in_([FileType.TXT.value, FileType.PDF.value, FileType.DOCX.value]),
            File.status == FileStatus.READY.value,
            File.current_version_id.is_not(None),
        )
        return int((await self.session.execute(stmt)).scalar() or 0)

    async def get_storage_usage_for_update(self, *, org_id: uuid.UUID) -> OrgStorageUsage:
        """Получить usage-строку с блокировкой `FOR UPDATE`, создать при отсутствии."""
        stmt = (
            select(OrgStorageUsage)
            .where(OrgStorageUsage.org_id == org_id)
            .with_for_update()
            .limit(1)
        )
        usage = (await self.session.execute(stmt)).scalar_one_or_none()
        if usage is not None:
            return usage

        usage = OrgStorageUsage(
            org_id=org_id,
            used_bytes=await self.sum_ready_file_bytes(org_id=org_id),
            reserved_bytes=0,
        )
        self.session.add(usage)
        await self.session.flush()
        return usage

    async def get_storage_usage(self, *, org_id: uuid.UUID) -> OrgStorageUsage | None:
        """Получить usage-строку без блокировки."""
        stmt = select(OrgStorageUsage).where(OrgStorageUsage.org_id == org_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def update_storage_usage(self, usage: OrgStorageUsage) -> OrgStorageUsage:
        """Сохранить usage."""
        await self.session.flush()
        return usage

    async def create_ai_generation_job(self, job: DocsAIGenerationJob) -> DocsAIGenerationJob:
        """Создать задачу AI-генерации документа."""
        self.session.add(job)
        await self.session.flush()
        return job

    async def get_ai_generation_job(
        self,
        *,
        job_id: uuid.UUID,
        org_id: uuid.UUID,
    ) -> DocsAIGenerationJob | None:
        """Получить AI job в рамках организации."""
        stmt = (
            select(DocsAIGenerationJob)
            .where(DocsAIGenerationJob.id == job_id, DocsAIGenerationJob.org_id == org_id)
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def get_ai_generation_job_by_id(self, *, job_id: uuid.UUID) -> DocsAIGenerationJob | None:
        """Получить AI job по id без фильтра организации."""
        stmt = select(DocsAIGenerationJob).where(DocsAIGenerationJob.id == job_id).limit(1)
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def list_ai_jobs_by_file(self, *, file_id: uuid.UUID) -> list[DocsAIGenerationJob]:
        """Получить список AI jobs, связанных с конкретным файлом."""
        stmt = select(DocsAIGenerationJob).where(DocsAIGenerationJob.file_id == file_id)
        return list((await self.session.execute(stmt)).scalars().all())

    async def list_recent_ai_generation_jobs(
        self,
        *,
        org_id: uuid.UUID,
        limit: int = 20,
    ) -> list[DocsAIGenerationJob]:
        """Получить последние AI jobs генерации документов по организации."""
        stmt = (
            select(DocsAIGenerationJob)
            .where(DocsAIGenerationJob.org_id == org_id)
            .order_by(DocsAIGenerationJob.created_at.desc())
            .limit(max(1, min(int(limit), 100)))
        )
        return list((await self.session.execute(stmt)).scalars().all())

    async def get_ai_generation_job_for_update(self, *, job_id: uuid.UUID) -> DocsAIGenerationJob | None:
        """Получить AI job с блокировкой строки FOR UPDATE."""
        stmt = (
            select(DocsAIGenerationJob)
            .where(DocsAIGenerationJob.id == job_id)
            .with_for_update()
            .limit(1)
        )
        return (await self.session.execute(stmt)).scalar_one_or_none()

    async def update_ai_generation_job(self, job: DocsAIGenerationJob) -> DocsAIGenerationJob:
        """Сохранить изменения AI job."""
        await self.session.flush()
        return job

    async def delete_ai_generation_job(self, job: DocsAIGenerationJob) -> None:
        """Удалить AI job."""
        await self.session.delete(job)
        await self.session.flush()
