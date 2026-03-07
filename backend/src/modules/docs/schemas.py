"""Pydantic-схемы модуля Docs."""
# ruff: noqa: TC003

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class FolderOut(BaseModel):
    """DTO папки документов."""

    id: uuid.UUID
    org_id: uuid.UUID
    parent_id: uuid.UUID | None
    name: str
    position: int
    created_at: datetime

    model_config = {"from_attributes": True}


class FileOut(BaseModel):
    """DTO файла модуля Docs."""

    id: uuid.UUID
    org_id: uuid.UUID
    folder_id: uuid.UUID | None
    title: str | None
    type: str | None
    status: str | None
    original_name: str
    content_type: str
    size: int
    current_version_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocsTreeOut(BaseModel):
    """DTO дерева документов."""

    folders: list[FolderOut]
    files: list[FileOut]


class CreateFolderRequest(BaseModel):
    """Запрос на создание папки."""

    name: str = Field(min_length=1, max_length=120)
    parent_id: uuid.UUID | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Название не может быть пустым")
        return normalized


class UpdateFolderRequest(BaseModel):
    """Запрос на обновление папки."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    parent_id: uuid.UUID | None = None
    position: int | None = None

    @field_validator("name", mode="before")
    @classmethod
    def _normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Название не может быть пустым")
        return normalized


class InitUploadRequest(BaseModel):
    """Запрос инициализации загрузки."""

    filename: str = Field(min_length=1, max_length=500)
    size_bytes: int = Field(gt=0)
    content_type: str = Field(min_length=1, max_length=255)
    folder_id: uuid.UUID | None = None
    title: str | None = Field(default=None, max_length=500)

    @field_validator("filename", "content_type", mode="before")
    @classmethod
    def _strip_required(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Поле не может быть пустым")
        return normalized

    @field_validator("title", mode="before")
    @classmethod
    def _strip_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


class InitUploadOut(BaseModel):
    """Ответ инициализации загрузки."""

    file_id: uuid.UUID
    upload_url: str
    upload_headers: dict[str, str]
    expires_in: int


class FinishUploadRequest(BaseModel):
    """Запрос завершения загрузки."""

    file_id: uuid.UUID
    size_bytes: int = Field(gt=0)
    sha256: str | None = Field(default=None, max_length=128)


class CreateEmptyFileRequest(BaseModel):
    """Запрос на создание пустого документа."""

    type: str = Field(min_length=2, max_length=20)
    title: str | None = Field(default=None, max_length=500)
    folder_id: uuid.UUID | None = None

    @field_validator("type", mode="before")
    @classmethod
    def _normalize_type(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if not normalized:
            raise ValueError("Тип документа обязателен")
        return normalized

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


class MoveFileRequest(BaseModel):
    """Запрос на перемещение файла в папку или в корень."""

    folder_id: uuid.UUID | None = None


class DownloadOut(BaseModel):
    """Ответ для скачивания файла."""

    url: str
    expires_in: int


class SaveTextRequest(BaseModel):
    """Запрос на сохранение текстового содержимого TXT-файла."""

    content: str = Field(default="")
    title: str | None = Field(default=None, max_length=500)

    @field_validator("title", mode="before")
    @classmethod
    def _normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None


class FileTextOut(BaseModel):
    """Текстовое содержимое текущей версии файла."""

    content: str




class FileVersionOut(BaseModel):
    """DTO версии файла для истории версий."""

    id: uuid.UUID
    file_id: uuid.UUID
    size_bytes: int
    mime: str
    meta_json: dict | None = None
    created_by: uuid.UUID | None
    created_at: datetime

    model_config = {"from_attributes": True}


class PdfSignRequest(BaseModel):
    """Запрос на наложение подписи на PDF."""

    page: int = Field(ge=1)
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(gt=0)
    height: float = Field(gt=0)
    image: str = Field(min_length=10, max_length=2_000_000)
    author: str | None = Field(default=None, max_length=120)

    @field_validator("author", mode="before")
    @classmethod
    def _normalize_author(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("image", mode="before")
    @classmethod
    def _normalize_image(cls, value: str) -> str:
        normalized = str(value).strip()
        if not normalized:
            raise ValueError("Поле image не может быть пустым")
        return normalized


class OpenDocxOut(BaseModel):
    """Ответ открытия DOCX редактора OnlyOffice."""

    file: FileOut
    document_server_url: str
    config: dict
    token: str | None = None


class AIGenerateRequest(BaseModel):
    """Запрос на AI-генерацию документа."""

    type: str = Field(min_length=2, max_length=20)
    prompt: str = Field(min_length=3, max_length=12000)
    template: str | None = Field(default=None, max_length=120)
    folder_id: uuid.UUID | None = None
    title: str | None = Field(default=None, max_length=500)
    language: str | None = Field(default="ru", max_length=12)

    @field_validator("type", mode="before")
    @classmethod
    def _normalize_type(cls, value: str) -> str:
        normalized = str(value or "").strip().lower()
        if not normalized:
            raise ValueError("Тип документа обязателен")
        return normalized

    @field_validator("template", "title", "language", mode="before")
    @classmethod
    def _normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = str(value).strip()
        return normalized or None

    @field_validator("prompt", mode="before")
    @classmethod
    def _normalize_prompt(cls, value: str) -> str:
        normalized = str(value or "").strip()
        if not normalized:
            raise ValueError("Поле prompt не может быть пустым")
        return normalized


class AIGenerateOut(BaseModel):
    """Ответ создания AI-job на генерацию документа."""

    job_id: uuid.UUID
    file_id: uuid.UUID
    status: str
    estimated_request_tokens: int


class AIGenerationJobOut(BaseModel):
    """DTO статуса AI-job генерации документа."""

    id: uuid.UUID
    org_id: uuid.UUID
    user_id: uuid.UUID | None
    file_id: uuid.UUID | None
    file_type: str
    status: str
    template: str | None
    title: str | None
    language: str | None
    provider_model: str | None
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    error_message: str | None
    task_id: str | None
    meta_json: dict | None = None
    started_at: datetime | None
    finished_at: datetime | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UsageOut(BaseModel):
    """DTO использования хранилища организации."""

    used_bytes: int
    reserved_bytes: int
    limit_bytes: int
    available_bytes: int
    percent_used: float


class DocsUsageInfoOut(BaseModel):
    """DTO информации об использовании хранилища."""

    used_bytes: int
    reserved_bytes: int
    limit_bytes: int
    percent_used: float

    model_config = {"from_attributes": True}


class PDFAnnotationRequest(BaseModel):
    """PDF annotation data."""

    annotation_type: str = Field(pattern="^(text|shape|signature|highlight|stamp|comment)$")
    page: int = Field(ge=0)
    x: float = Field(ge=0)
    y: float = Field(ge=0)
    width: float = Field(ge=0)
    height: float = Field(ge=0)
    content: str | None = None
    color: str | None = None
    image_data: str | None = None
    metadata: dict | None = None


class SavePDFAnnotationsRequest(BaseModel):
    """Request to save PDF with annotations."""

    annotations: list[PDFAnnotationRequest]


class SavePDFAnnotationsResult(BaseModel):
    """Result of saving PDF with annotations."""

    file: FileOut
    annotations_applied: int


class ConvertDocxToHtmlRequest(BaseModel):
    """Request to convert DOCX to HTML."""

    pass  # File ID is in URL


class ConvertDocxToHtmlResult(BaseModel):
    """Result of DOCX to HTML conversion."""

    html_content: str
    word_count: int
    paragraphs_count: int


class SaveDocxFromHtmlRequest(BaseModel):
    """Request to save DOCX from HTML content."""

    html_content: str = Field(min_length=1)
    title: str | None = Field(default=None, max_length=500)


class SaveDocxFromHtmlResult(BaseModel):
    """Result of saving DOCX from HTML."""

    file: FileOut
    word_count: int
    paragraphs_count: int
