"""Composable service facade for docs module."""

from __future__ import annotations

from src.modules.ai.limits import check_ai_limits
from src.modules.docs.ai_generator import DEFAULT_AI_DOCUMENT_GENERATOR
from src.modules.docs.doc_editor_provider import DEFAULT_DOC_EDITOR_PROVIDER
from src.modules.docs.service_parts.ai import DocsAIMixin
from src.modules.docs.service_parts.base import (
    AIGenerateRequestResult,
    DocsServiceBase,
    FinishUploadResult,
    OpenDocxResult,
    PdfSignRequestResult,
)
from src.modules.docs.service_parts.editing import DocsEditingMixin
from src.modules.docs.service_parts.files import DocsFilesMixin
from src.modules.docs.service_parts.folders import DocsFoldersMixin
from src.modules.docs.storage import DEFAULT_STORAGE_PROVIDER

__all__ = [
    "DEFAULT_AI_DOCUMENT_GENERATOR",
    "DEFAULT_DOC_EDITOR_PROVIDER",
    "DEFAULT_STORAGE_PROVIDER",
    "AIGenerateRequestResult",
    "DocsService",
    "FinishUploadResult",
    "OpenDocxResult",
    "PdfSignRequestResult",
    "check_ai_limits",
]


class DocsService(
    DocsAIMixin,
    DocsEditingMixin,
    DocsFilesMixin,
    DocsFoldersMixin,
    DocsServiceBase,
):
    """Application service facade composed from focused docs use-case mixins."""
