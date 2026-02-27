"""OnlyOffice-провайдер для открытия/сохранения DOCX в Docs модуле."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

import jwt

from src.config import settings
from src.modules.docs.errors import DocsModuleError


@dataclass(slots=True)
class OnlyOfficeOpenDocxResult:
    """Результат подготовки конфига открытия DOCX в OnlyOffice."""

    document_server_url: str
    config: dict
    token: str | None


class OnlyOfficeDocumentEditorProvider:
    """Интеграционный провайдер OnlyOffice."""

    def __init__(self) -> None:
        self.document_server_url = ""
        self.jwt_secret = ""
        self.callback_url = ""
        self.editor_lang = "ru"
        self.enabled = False
        self._refresh()

    def _refresh(self) -> None:
        """Перечитать runtime-настройки из `settings`."""
        self.document_server_url = str(getattr(settings, "DOCS_ONLYOFFICE_DOCUMENT_SERVER_URL", "") or "").rstrip("/")
        self.jwt_secret = str(getattr(settings, "DOCS_ONLYOFFICE_JWT_SECRET", "") or "").strip()
        self.callback_url = str(getattr(settings, "DOCS_ONLYOFFICE_CALLBACK_URL", "") or "").strip()
        self.editor_lang = str(getattr(settings, "DOCS_ONLYOFFICE_EDITOR_LANG", "ru") or "ru").strip()
        self.enabled = bool(getattr(settings, "DOCS_ONLYOFFICE_ENABLED", False))

    def ensure_configured(self) -> None:
        """Проверить обязательную конфигурацию OnlyOffice."""
        self._refresh()
        if not self.enabled:
            raise DocsModuleError(
                code="ONLYOFFICE_DISABLED",
                message="Интеграция OnlyOffice отключена",
                status_code=422,
            )
        if not self.document_server_url:
            raise DocsModuleError(
                code="ONLYOFFICE_NOT_CONFIGURED",
                message="Не настроен URL сервера OnlyOffice",
                status_code=422,
            )
        if not self.callback_url:
            raise DocsModuleError(
                code="ONLYOFFICE_NOT_CONFIGURED",
                message="Не настроен callback URL для OnlyOffice",
                status_code=422,
            )

    def build_state_token(
        self,
        *,
        org_id: str,
        file_id: str,
        source_version_id: str,
        user_id: str,
        ttl_seconds: int = 7200,
    ) -> str:
        """Создать подписанный state-token для callback URL."""
        self._refresh()
        payload = {
            "org_id": str(org_id),
            "file_id": str(file_id),
            "source_version_id": str(source_version_id),
            "user_id": str(user_id),
            "exp": datetime.now(UTC) + timedelta(seconds=max(60, int(ttl_seconds))),
        }
        return jwt.encode(payload, self._state_secret(), algorithm="HS256")

    def decode_state_token(self, token: str) -> dict:
        """Декодировать state-token callback URL."""
        self._refresh()
        try:
            return jwt.decode(str(token), self._state_secret(), algorithms=["HS256"])
        except Exception as exc:
            raise DocsModuleError(
                code="ONLYOFFICE_STATE_INVALID",
                message="Некорректный state callback",
                status_code=401,
            ) from exc

    def build_open_docx_payload(
        self,
        *,
        document_key: str,
        title: str,
        file_url: str,
        callback_state_token: str,
        user_id: str,
        user_name: str,
    ) -> OnlyOfficeOpenDocxResult:
        """Собрать конфиг открытия DOCX в редакторе OnlyOffice."""
        self._refresh()
        callback_url = f"{self.callback_url}?state={quote(callback_state_token, safe='')}"
        config = {
            "documentType": "word",
            "document": {
                "fileType": "docx",
                "key": str(document_key),
                "title": str(title)[:255],
                "url": file_url,
                "permissions": {
                    "edit": True,
                    "download": True,
                    "print": True,
                    "copy": True,
                },
            },
            "editorConfig": {
                "mode": "edit",
                "lang": self.editor_lang,
                "callbackUrl": callback_url,
                "user": {
                    "id": str(user_id),
                    "name": str(user_name)[:120] or "CRM User",
                },
                "customization": {
                    "autosave": True,
                    "forcesave": True,
                },
            },
        }
        token: str | None = None
        if self.jwt_secret:
            token = jwt.encode(config, self.jwt_secret, algorithm="HS256")
            config["token"] = token
        return OnlyOfficeOpenDocxResult(
            document_server_url=self.document_server_url,
            config=config,
            token=token,
        )

    def validate_callback_signature(self, *, body: dict, auth_header: str | None) -> None:
        """Проверить подпись callback от OnlyOffice.

        Если `DOCS_ONLYOFFICE_JWT_SECRET` не задан, проверка пропускается.
        """
        self._refresh()
        if not self.jwt_secret:
            return
        token = self._extract_callback_token(body=body, auth_header=auth_header)
        if not token:
            raise DocsModuleError(
                code="ONLYOFFICE_UNAUTHORIZED",
                message="Missing OnlyOffice signature token",
                status_code=401,
            )
        try:
            jwt.decode(token, self.jwt_secret, algorithms=["HS256"])
        except Exception as exc:
            raise DocsModuleError(
                code="ONLYOFFICE_UNAUTHORIZED",
                message="Invalid OnlyOffice callback signature",
                status_code=403,
            ) from exc

    @staticmethod
    def _extract_callback_token(*, body: dict, auth_header: str | None) -> str | None:
        token = str(body.get("token") or "").strip()
        if token:
            return token
        header = str(auth_header or "").strip()
        if header.lower().startswith("bearer "):
            return header[7:].strip() or None
        return None

    def _state_secret(self) -> str:
        return self.jwt_secret or str(settings.SECRET_KEY or "").strip()


DEFAULT_DOC_EDITOR_PROVIDER = OnlyOfficeDocumentEditorProvider()
