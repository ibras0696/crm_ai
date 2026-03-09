"""S3/MinIO провайдер для модуля Docs."""
# ruff: noqa: TC003

from __future__ import annotations

import uuid
from urllib.parse import quote

from src.config import settings
from src.modules.files.storage import ensure_bucket, get_s3_client, get_s3_presign_client


class StorageProvider:
    """Адаптер объектного хранилища для presigned upload/download."""

    def build_version_key(self, *, org_id: uuid.UUID, file_id: uuid.UUID, version_id: uuid.UUID) -> str:
        """Сформировать ключ версии файла по стандартному шаблону."""
        return f"org/{org_id}/files/{file_id}/v/{version_id}"

    def generate_presigned_put_url(
        self,
        *,
        bucket: str,
        key: str,
        content_type: str,
        expires_in: int = 900,
    ) -> tuple[str, dict[str, str]]:
        """Сформировать URL для прямой загрузки объекта в S3."""
        ensure_bucket()
        s3 = get_s3_presign_client()
        url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket, "Key": key, "ContentType": content_type},
            ExpiresIn=expires_in,
        )
        return url, {"Content-Type": content_type}

    def generate_presigned_get_url(
        self, *, bucket: str, key: str, expires_in: int = 900, filename: str | None = None
    ) -> str:
        """Сформировать URL для скачивания объекта из S3."""
        ensure_bucket()
        s3 = get_s3_presign_client()
        params = {"Bucket": bucket, "Key": key}
        if filename:
            safe_filename = quote(filename.encode("utf-8"))
            params["ResponseContentDisposition"] = f"attachment; filename*=UTF-8''{safe_filename}"

        return s3.generate_presigned_url(
            "get_object",
            Params=params,
            ExpiresIn=expires_in,
        )

    def generate_internal_presigned_get_url(self, *, bucket: str, key: str, expires_in: int = 900) -> str:
        """Сформировать внутренний URL (доступен только из Docker) для скачивания объекта OnlyOffice сервером."""
        ensure_bucket()
        s3 = get_s3_client()
        return s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires_in,
        )

    def put_object_bytes(self, *, bucket: str, key: str, payload: bytes, content_type: str) -> None:
        """Сохранить объект в S3 напрямую из bytes."""
        ensure_bucket()
        s3 = get_s3_client()
        s3.put_object(
            Bucket=bucket,
            Key=key,
            Body=payload,
            ContentType=content_type,
        )

    def get_object_bytes(self, *, bucket: str, key: str) -> bytes:
        """Скачать объект целиком."""
        ensure_bucket()
        s3 = get_s3_client()
        response = s3.get_object(Bucket=bucket, Key=key)
        return bytes(response["Body"].read())

    def get_object_head_bytes(self, *, bucket: str, key: str, length: int = 4096) -> bytes:
        """Скачать префикс объекта для lightweight-проверок."""
        ensure_bucket()
        s3 = get_s3_client()
        end_index = max(0, int(length) - 1)
        response = s3.get_object(Bucket=bucket, Key=key, Range=f"bytes=0-{end_index}")
        return bytes(response["Body"].read())

    def iter_object_chunks(self, *, bucket: str, key: str, chunk_size: int = 64 * 1024):
        """Итерировать содержимое объекта по чанкам."""
        ensure_bucket()
        s3 = get_s3_client()
        response = s3.get_object(Bucket=bucket, Key=key)
        body = response["Body"]
        chunk_size = max(8 * 1024, int(chunk_size))
        while True:
            chunk = body.read(chunk_size)
            if not chunk:
                break
            yield bytes(chunk)


DEFAULT_STORAGE_PROVIDER = StorageProvider()
DEFAULT_BUCKET = settings.S3_BUCKET
