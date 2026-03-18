"""OnlyOffice-провайдер для открытия/сохранения DOCX в Docs модуле."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from urllib.parse import quote
from xml.etree import ElementTree

import httpx
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
        except jwt.InvalidTokenError as exc:
            raise DocsModuleError(
                code="ONLYOFFICE_SIGNATURE_INVALID",
                message="Некорректная подпись callback от OnlyOffice",
                status_code=403,
            ) from exc

    async def convert_to_pdf(self, *, file_url: str, file_type: str) -> bytes:
        """Сконвертировать файл в PDF через ConvertService.ashx OnlyOffice."""
        return await self._convert_file_bytes(file_url=file_url, file_type=file_type, output_type="pdf")

    async def convert_to_docx(self, *, file_url: str, file_type: str) -> bytes:
        """Сконвертировать файл в DOCX через ConvertService.ashx OnlyOffice."""
        return await self._convert_file_bytes(file_url=file_url, file_type=file_type, output_type="docx")

    async def _convert_file_bytes(self, *, file_url: str, file_type: str, output_type: str) -> bytes:
        """Сконвертировать файл через ConvertService и вернуть bytes результата."""
        self.ensure_configured()

        convert_url = f"{self.document_server_url}/ConvertService.ashx"
        payload = {
            "async": False,
            "filetype": str(file_type).replace(".", "").lower(),
            "key": str(int(datetime.now(UTC).timestamp())),
            "outputtype": str(output_type).replace(".", "").lower(),
            "url": file_url,
        }

        if self.jwt_secret:
            token = jwt.encode(payload, self.jwt_secret, algorithm="HS256")
            payload["token"] = token

        timeout_s = float(getattr(settings, "DOCS_ONLYOFFICE_REQUEST_TIMEOUT_S", 60.0) or 60.0)
        async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_s), follow_redirects=True) as client:
            response = await client.post(convert_url, json=payload, headers={"Accept": "application/json"})
            response.raise_for_status()
            data: dict | None = None
            file_url_out: str | None = None
            error_code: str | int | None = None
            try:
                data = response.json()
            except ValueError:
                data = None

            if isinstance(data, dict):
                error_code = data.get("error")
                file_url_out = str(data.get("fileUrl") or "").strip() or None
            else:
                try:
                    root = ElementTree.fromstring(response.text or "")
                    error_code = (root.findtext("Error") or "").strip() or None
                    file_url_out = (root.findtext("FileUrl") or "").strip() or None
                except ElementTree.ParseError as exc:
                    raise DocsModuleError(
                        code="ONLYOFFICE_CONVERT_ERROR",
                        message="OnlyOffice вернул некорректный ответ конвертации",
                    ) from exc

            if error_code not in (None, "", 0, "0"):
                raise DocsModuleError(
                    code="ONLYOFFICE_CONVERT_ERROR", message=f"Ошибка конвертации OnlyOffice: {error_code}"
                )

            if not file_url_out:
                raise DocsModuleError(
                    code="ONLYOFFICE_CONVERT_ERROR", message="OnlyOffice не вернул ссылку на сконвертированный файл"
                )

            converted_resp = await client.get(file_url_out)
            converted_resp.raise_for_status()
            return bytes(converted_resp.content)

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
        except jwt.InvalidTokenError as exc:
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
