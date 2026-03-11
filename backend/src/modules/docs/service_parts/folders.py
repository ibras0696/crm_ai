from __future__ import annotations

from typing import TYPE_CHECKING

from src.modules.docs.errors import DocsModuleError
from src.modules.docs.models import Folder

if TYPE_CHECKING:
    import uuid

    from src.modules.files.models import File


class DocsFoldersMixin:
    async def list_tree(self, *, org_id: uuid.UUID) -> tuple[list[Folder], list[File]]:
        folders = await self.repo.list_folders(org_id=org_id)
        files = await self.repo.list_doc_files(org_id=org_id)
        return folders, files

    async def create_folder(
        self,
        *,
        org_id: uuid.UUID,
        user_id: uuid.UUID,
        name: str,
        parent_id: uuid.UUID | None,
    ) -> Folder:
        validated_parent_id = await self._validate_parent_folder(
            org_id=org_id,
            parent_id=parent_id,
            current_folder_id=None,
        )
        max_pos = await self.repo.get_max_folder_position(org_id=org_id)
        folder = Folder(
            org_id=org_id,
            created_by=user_id,
            parent_id=validated_parent_id,
            name=name,
            position=max_pos + 1,
        )
        return await self.repo.create_folder(folder)

    async def update_folder(
        self,
        *,
        org_id: uuid.UUID,
        folder_id: uuid.UUID,
        updates: dict,
    ) -> Folder:
        folder = await self.repo.get_folder(folder_id=folder_id, org_id=org_id)
        if folder is None:
            raise DocsModuleError(code="NOT_FOUND", message="Папка не найдена", status_code=404)

        if "name" in updates:
            folder.name = updates.get("name")
        if "position" in updates:
            folder.position = int(updates.get("position"))
        if "parent_id" in updates:
            folder.parent_id = await self._validate_parent_folder(
                org_id=org_id,
                parent_id=updates.get("parent_id"),
                current_folder_id=folder.id,
            )
        return await self.repo.update_folder(folder)

    async def delete_folder(self, *, org_id: uuid.UUID, folder_id: uuid.UUID) -> None:
        folder = await self.repo.get_folder(folder_id=folder_id, org_id=org_id)
        if folder is None:
            raise DocsModuleError(code="NOT_FOUND", message="Папка не найдена", status_code=404)

        child_folders = await self.repo.count_child_folders(folder_id=folder_id, org_id=org_id)
        if child_folders > 0:
            raise DocsModuleError(code="FOLDER_NOT_EMPTY", message="Сначала удалите вложенные папки")

        file_count = await self.repo.count_files_in_folder(folder_id=folder_id, org_id=org_id)
        if file_count > 0:
            raise DocsModuleError(code="FOLDER_NOT_EMPTY", message="Сначала удалите файлы из папки")

        await self.repo.delete_folder(folder)
