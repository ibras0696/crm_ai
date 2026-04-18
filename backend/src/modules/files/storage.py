"""S3/MinIO storage service."""

import uuid
from contextlib import suppress
from typing import BinaryIO

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from src.common.http_headers import content_disposition_attachment, content_disposition_inline
from src.config import settings

_TEXT_RESPONSE_MIME_BY_EXT: dict[str, str] = {
    "csv": "text/csv",
    "htm": "text/html",
    "html": "text/html",
    "json": "application/json",
    "md": "text/markdown",
    "markdown": "text/markdown",
    "txt": "text/plain",
    "xml": "application/xml",
    "yaml": "application/yaml",
    "yml": "application/yaml",
}
_TEXT_RESPONSE_MIME_TYPES = set(_TEXT_RESPONSE_MIME_BY_EXT.values()) | {
    "application/javascript",
    "text/javascript",
    "text/plain",
    "text/xml",
}


def _build_s3_client(*, endpoint_url: str):
    addressing_style = "path" if settings.S3_FORCE_PATH_STYLE else "auto"
    return boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        use_ssl=bool(settings.S3_USE_SSL),
        verify=bool(settings.S3_VERIFY_SSL),
        config=Config(signature_version="s3v4", s3={"addressing_style": addressing_style}),
    )


def get_s3_client():
    return _build_s3_client(endpoint_url=settings.S3_ENDPOINT)


def get_s3_presign_client():
    public_endpoint = str(settings.S3_PUBLIC_ENDPOINT or "").strip()
    return _build_s3_client(endpoint_url=public_endpoint or settings.S3_ENDPOINT)


def _normalize_content_type(content_type: str | None) -> str:
    raw = str(content_type or "").strip().lower()
    if not raw:
        return ""
    return raw.split(";", 1)[0].strip()


def _guess_text_response_content_type(*, content_type: str | None, filename: str | None) -> str | None:
    normalized = _normalize_content_type(content_type)
    if normalized in _TEXT_RESPONSE_MIME_TYPES:
        return f"{normalized}; charset=utf-8"

    name = str(filename or "").strip().lower()
    if "." not in name or name.endswith("."):
        return None
    ext = name.rsplit(".", 1)[-1]
    guessed = _TEXT_RESPONSE_MIME_BY_EXT.get(ext)
    if guessed:
        return f"{guessed}; charset=utf-8"
    return None


def _build_bucket_cors_rules() -> list[dict]:
    origins = [str(item).strip() for item in (settings.CORS_ORIGINS or []) if str(item).strip()]
    if not origins:
        return []
    return [
        {
            "AllowedOrigins": origins,
            "AllowedMethods": ["GET", "PUT", "HEAD"],
            "AllowedHeaders": ["*"],
            "ExposeHeaders": ["ETag", "x-amz-request-id", "x-amz-id-2"],
            "MaxAgeSeconds": 3600,
        },
    ]


def ensure_bucket():
    s3 = get_s3_client()
    try:
        s3.head_bucket(Bucket=settings.S3_BUCKET)
    except ClientError:
        s3.create_bucket(Bucket=settings.S3_BUCKET)
    cors_rules = _build_bucket_cors_rules()
    if cors_rules:
        with suppress(ClientError):
            s3.put_bucket_cors(
                Bucket=settings.S3_BUCKET,
                CORSConfiguration={"CORSRules": cors_rules},
            )


def upload_file(data: bytes, content_type: str, org_id: uuid.UUID, original_name: str) -> tuple[str, str]:
    """Upload file to S3. Returns (s3_key, bucket)."""
    s3 = get_s3_client()
    ensure_bucket()
    ext = original_name.rsplit(".", 1)[-1] if "." in original_name else "bin"
    s3_key = f"{org_id}/{uuid.uuid4().hex}.{ext}"
    s3.put_object(
        Bucket=settings.S3_BUCKET,
        Key=s3_key,
        Body=data,
        ContentType=content_type,
    )
    return s3_key, settings.S3_BUCKET


def upload_fileobj(fileobj: BinaryIO, content_type: str, org_id: uuid.UUID, original_name: str) -> tuple[str, str]:
    """Upload file-like stream to S3. Returns (s3_key, bucket)."""
    s3 = get_s3_client()
    ensure_bucket()
    ext = original_name.rsplit(".", 1)[-1] if "." in original_name else "bin"
    s3_key = f"{org_id}/{uuid.uuid4().hex}.{ext}"
    s3.upload_fileobj(fileobj, settings.S3_BUCKET, s3_key, ExtraArgs={"ContentType": content_type})
    return s3_key, settings.S3_BUCKET


def download_file(s3_key: str, bucket: str) -> tuple[bytes, str]:
    """Download file from S3. Returns (data, content_type)."""
    s3 = get_s3_client()
    resp = s3.get_object(Bucket=bucket, Key=s3_key)
    return resp["Body"].read(), resp["ContentType"]


def delete_file(s3_key: str, bucket: str):
    s3 = get_s3_client()
    s3.delete_object(Bucket=bucket, Key=s3_key)


def head_object(s3_key: str, bucket: str) -> dict:
    """Read object metadata from S3."""
    s3 = get_s3_client()
    return s3.head_object(Bucket=bucket, Key=s3_key)


def generate_presigned_put_url(
    *,
    s3_key: str,
    bucket: str,
    content_type: str,
    expires_in: int = 900,
) -> tuple[str, dict[str, str]]:
    """Generate presigned URL for direct object upload."""
    ensure_bucket()
    s3 = get_s3_presign_client()
    url = s3.generate_presigned_url(
        "put_object",
        Params={"Bucket": bucket, "Key": s3_key, "ContentType": content_type},
        ExpiresIn=expires_in,
    )
    return url, {"Content-Type": content_type}


def generate_presigned_url(s3_key: str, bucket: str, expires_in: int = 3600) -> str:
    return generate_presigned_get_url(s3_key=s3_key, bucket=bucket, expires_in=expires_in)


def generate_presigned_get_url(
    *,
    s3_key: str,
    bucket: str,
    expires_in: int = 3600,
    filename: str | None = None,
    content_type: str | None = None,
    inline: bool = False,
) -> str:
    ensure_bucket()
    s3 = get_s3_presign_client()
    params = {"Bucket": bucket, "Key": s3_key}
    if filename:
        params["ResponseContentDisposition"] = (
            content_disposition_inline(filename) if inline else content_disposition_attachment(filename)
        )
    response_content_type = _guess_text_response_content_type(content_type=content_type, filename=filename)
    if response_content_type:
        params["ResponseContentType"] = response_content_type
    return s3.generate_presigned_url(
        "get_object",
        Params=params,
        ExpiresIn=expires_in,
    )
