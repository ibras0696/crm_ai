"""S3/MinIO storage service."""
import uuid

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from src.config import settings


def get_s3_client():
    addressing_style = "path" if settings.S3_FORCE_PATH_STYLE else "auto"
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        region_name=settings.S3_REGION,
        use_ssl=bool(settings.S3_USE_SSL),
        verify=bool(settings.S3_VERIFY_SSL),
        config=Config(signature_version="s3v4", s3={"addressing_style": addressing_style}),
    )


def ensure_bucket():
    s3 = get_s3_client()
    try:
        s3.head_bucket(Bucket=settings.S3_BUCKET)
    except ClientError:
        s3.create_bucket(Bucket=settings.S3_BUCKET)


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


def download_file(s3_key: str, bucket: str) -> tuple[bytes, str]:
    """Download file from S3. Returns (data, content_type)."""
    s3 = get_s3_client()
    resp = s3.get_object(Bucket=bucket, Key=s3_key)
    return resp["Body"].read(), resp["ContentType"]


def delete_file(s3_key: str, bucket: str):
    s3 = get_s3_client()
    s3.delete_object(Bucket=bucket, Key=s3_key)


def generate_presigned_url(s3_key: str, bucket: str, expires_in: int = 3600) -> str:
    s3 = get_s3_client()
    return s3.generate_presigned_url(
        "get_object",
        Params={"Bucket": bucket, "Key": s3_key},
        ExpiresIn=expires_in,
    )
