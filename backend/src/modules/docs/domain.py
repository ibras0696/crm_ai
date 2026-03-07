"""Доменные сущности и инварианты модуля Docs."""

from __future__ import annotations

from enum import Enum


class FileType(str, Enum):
    """Поддерживаемые типы файлов для модуля Docs."""

    TXT = "txt"
    DOCX = "docx"
    PDF = "pdf"


class FileStatus(str, Enum):
    """Жизненный цикл файла в модуле Docs."""

    DRAFT = "draft"
    UPLOADING = "uploading"
    SCANNING = "scanning"
    READY = "ready"
    BLOCKED = "blocked"
    DELETED = "deleted"


MAX_FOLDER_DEPTH = 2
