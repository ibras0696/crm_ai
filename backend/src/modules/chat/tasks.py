"""Celery tasks for chat background operations."""

import io
import json
import math
import subprocess
import tempfile
import uuid
from array import array
from pathlib import Path

from botocore.exceptions import BotoCoreError, ClientError
from PIL import Image, ImageOps
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from src.config import settings
from src.infrastructure.celery_app import celery
from src.infrastructure.celery_base import BaseTaskWithRetry
from src.infrastructure.database_sync import sync_session_factory
from src.modules.files import storage as files_storage
from src.modules.files.models import File

CHAT_PREVIEW_MAX_IMAGE_SIDE = 1024
CHAT_AUDIO_WAVEFORM_BARS = 64


def _preview_key_for(db_file: File, suffix: str) -> str:
    base_path = str(db_file.s3_key).rsplit("/", 1)[0]
    return f"{base_path}/previews/{db_file.id.hex}{suffix}"


def _build_image_preview(data: bytes) -> tuple[bytes, dict]:
    with Image.open(io.BytesIO(data)) as image:
        image = ImageOps.exif_transpose(image)
        if image.mode not in {"RGB", "RGBA"}:
            image = image.convert("RGB")
        image.thumbnail((CHAT_PREVIEW_MAX_IMAGE_SIDE, CHAT_PREVIEW_MAX_IMAGE_SIDE), Image.Resampling.LANCZOS)
        output = io.BytesIO()
        image.save(output, format="WEBP", quality=78, method=4)
        return output.getvalue(), {"width": image.width, "height": image.height}


def _run_subprocess(args: list[str], *, input_bytes: bytes | None = None) -> bytes:
    completed = subprocess.run(
        args,
        input=input_bytes,
        capture_output=True,
        check=True,
        timeout=45,
    )
    return completed.stdout


def _build_video_poster(data: bytes, suffix: str) -> tuple[bytes, dict]:
    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = Path(temp_dir) / f"input{suffix or '.bin'}"
        output_path = Path(temp_dir) / "poster.webp"
        input_path.write_bytes(data)
        _run_subprocess(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                "1",
                "-i",
                str(input_path),
                "-frames:v",
                "1",
                "-vf",
                f"scale='min({CHAT_PREVIEW_MAX_IMAGE_SIDE},iw)':-2",
                "-quality",
                "78",
                "-y",
                str(output_path),
            ]
        )
        poster = output_path.read_bytes()
    with Image.open(io.BytesIO(poster)) as image:
        return poster, {"width": image.width, "height": image.height}


def _probe_duration_ms(input_path: Path) -> int | None:
    try:
        raw = _run_subprocess(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(input_path),
            ]
        )
    except (subprocess.SubprocessError, OSError, ValueError):
        return None
    try:
        seconds = float(raw.decode("utf-8").strip())
    except ValueError:
        return None
    if not math.isfinite(seconds) or seconds <= 0:
        return None
    return int(seconds * 1000)


def _build_audio_waveform(data: bytes, suffix: str) -> tuple[bytes, dict]:
    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = Path(temp_dir) / f"input{suffix or '.bin'}"
        input_path.write_bytes(data)
        duration_ms = _probe_duration_ms(input_path)
        pcm = _run_subprocess(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(input_path),
                "-f",
                "s16le",
                "-ac",
                "1",
                "-ar",
                "8000",
                "pipe:1",
            ]
        )

    samples = array("h")
    samples.frombytes(pcm)
    if not samples:
        waveform = [0.0 for _ in range(CHAT_AUDIO_WAVEFORM_BARS)]
    else:
        chunk_size = max(1, math.ceil(len(samples) / CHAT_AUDIO_WAVEFORM_BARS))
        peaks: list[float] = []
        for index in range(0, len(samples), chunk_size):
            chunk = samples[index : index + chunk_size]
            peak = max((abs(value) for value in chunk), default=0) / 32768
            peaks.append(round(min(1.0, peak), 3))
        waveform = peaks[:CHAT_AUDIO_WAVEFORM_BARS]
        if len(waveform) < CHAT_AUDIO_WAVEFORM_BARS:
            waveform.extend([0.0] * (CHAT_AUDIO_WAVEFORM_BARS - len(waveform)))

    payload = {
        "duration_ms": duration_ms,
        "waveform": waveform,
        "sample_rate": 8000,
        "bars": CHAT_AUDIO_WAVEFORM_BARS,
    }
    encoded = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return encoded, payload


def _delete_preview_if_present(db_file: File) -> None:
    if db_file.preview_s3_key:
        files_storage.delete_file(db_file.preview_s3_key, db_file.preview_s3_bucket or settings.S3_BUCKET)


def _build_image_preview_payload(data: bytes, _suffix: str) -> tuple[bytes, dict]:
    return _build_image_preview(data)


def _build_video_preview_payload(data: bytes, suffix: str) -> tuple[bytes, dict]:
    return _build_video_poster(data, suffix)


def _build_audio_preview_payload(data: bytes, suffix: str) -> tuple[bytes, dict]:
    return _build_audio_waveform(data, suffix)


def _count_attachment_references_sync(*, session: Session, org_id: uuid.UUID, file_id: uuid.UUID) -> int:
    sql = """
        SELECT COUNT(*)
        FROM chat_messages
        WHERE org_id = :org_id
          AND (
            COALESCE(meta->'attachment_ids', '[]'::jsonb) ? :file_id_text
            OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(meta->'attachments', '[]'::jsonb)) AS elem
                WHERE elem->>'file_id' = :file_id_text
            )
          )
    """
    params: dict[str, object] = {"org_id": org_id, "file_id_text": str(file_id)}
    result = session.execute(text(sql), params)
    return int(result.scalar_one() or 0)


@celery.task(name="chat_cleanup_attachments", bind=True, base=BaseTaskWithRetry)
def chat_cleanup_attachments(self, *, org_id: str, file_ids: list[str]) -> dict[str, int]:
    """Delete orphan chat attachments from storage and metadata table."""
    _ = self
    unique_ids = list(dict.fromkeys(str(item) for item in (file_ids or []) if str(item).strip()))
    if not unique_ids:
        return {"received": 0, "deleted": 0, "skipped": 0}

    org_uuid = uuid.UUID(org_id)
    deleted = 0
    skipped = 0

    with sync_session_factory() as session:
        for file_id_str in unique_ids:
            file_uuid = uuid.UUID(file_id_str)

            if _count_attachment_references_sync(session=session, org_id=org_uuid, file_id=file_uuid) > 0:
                skipped += 1
                continue

            db_file = (
                session.execute(
                    select(File).where(
                        File.id == file_uuid,
                        File.org_id == org_uuid,
                    )
                )
                .scalars()
                .one_or_none()
            )
            if db_file is None:
                skipped += 1
                continue
            if str(db_file.type or "") != "chat_attachment":
                skipped += 1
                continue

            try:
                _delete_preview_if_present(db_file)
                files_storage.delete_file(db_file.s3_key, db_file.s3_bucket)
            except ClientError as exc:
                code = str((exc.response or {}).get("Error", {}).get("Code", ""))
                # Idempotency: if object is already absent, continue and remove stale DB row.
                if code not in {"404", "NoSuchKey", "NotFound"}:
                    raise
            except (BotoCoreError, KeyError, OSError, ValueError):
                raise

            session.delete(db_file)
            deleted += 1

        session.commit()

    return {"received": len(unique_ids), "deleted": deleted, "skipped": skipped}


@celery.task(name="chat_generate_attachment_preview", bind=True, base=BaseTaskWithRetry)
def chat_generate_attachment_preview(self, *, org_id: str, file_id: str) -> dict[str, str | int]:
    """Generate lightweight chat preview object outside the API request path."""
    _ = self
    org_uuid = uuid.UUID(org_id)
    file_uuid = uuid.UUID(file_id)

    with sync_session_factory() as session:
        db_file = (
            session.execute(
                select(File).where(
                    File.id == file_uuid,
                    File.org_id == org_uuid,
                )
            )
            .scalars()
            .one_or_none()
        )
        if db_file is None or str(db_file.type or "") != "chat_attachment":
            return {"status": "skipped", "reason": "not_found"}
        if str(db_file.status or "") != "ready":
            return {"status": "skipped", "reason": "not_ready"}

        content_type = str(db_file.content_type or "").lower()
        original_name = str(db_file.original_name or "")
        suffix = f".{original_name.rsplit('.', 1)[-1].lower()}" if "." in original_name else ""

        if content_type.startswith("image/"):
            preview_suffix = ".webp"
            preview_content_type = "image/webp"
            builder = _build_image_preview_payload
        elif content_type.startswith("video/"):
            preview_suffix = ".webp"
            preview_content_type = "image/webp"
            builder = _build_video_preview_payload
        elif content_type.startswith("audio/"):
            preview_suffix = ".waveform.json"
            preview_content_type = "application/json"
            builder = _build_audio_preview_payload
        else:
            db_file.preview_status = "unsupported"
            db_file.preview_meta = {"reason": "unsupported_content_type"}
            session.commit()
            return {"status": "unsupported", "file_id": str(file_uuid)}

        db_file.preview_status = "processing"
        session.commit()

        try:
            data, _ = files_storage.download_file(db_file.s3_key, db_file.s3_bucket)
            preview_data, preview_meta = builder(data, suffix)
            preview_key = _preview_key_for(db_file, preview_suffix)
            files_storage.upload_bytes_to_key(
                data=preview_data,
                s3_key=preview_key,
                bucket=settings.S3_BUCKET,
                content_type=preview_content_type,
            )
        except (BotoCoreError, ClientError, KeyError, OSError, ValueError, subprocess.SubprocessError) as exc:
            db_file.preview_status = "failed"
            db_file.preview_meta = {"error": exc.__class__.__name__}
            session.commit()
            raise

        db_file.preview_s3_key = preview_key
        db_file.preview_s3_bucket = settings.S3_BUCKET
        db_file.preview_content_type = preview_content_type
        db_file.preview_size = len(preview_data)
        db_file.preview_status = "ready"
        db_file.preview_meta = preview_meta
        session.commit()

    return {"status": "ready", "file_id": str(file_uuid), "size": len(preview_data)}
