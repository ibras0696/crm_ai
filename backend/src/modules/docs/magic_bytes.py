"""Проверка типа файла по magic bytes для модуля Docs."""

from __future__ import annotations

import io
import zipfile

from src.modules.docs.domain import FileType


def validate_magic_bytes(file_type: FileType, payload: bytes) -> tuple[bool, str]:
    """Проверить соответствие содержимого ожидаемому типу файла."""
    if not payload:
        return False, "empty_payload"

    if file_type == FileType.PDF:
        if payload.startswith(b"%PDF-"):
            return True, "pdf_magic_ok"
        return False, "pdf_magic_mismatch"

    if file_type == FileType.DOCX:
        if not payload.startswith(b"PK\x03\x04"):
            return False, "docx_zip_magic_mismatch"
        try:
            with zipfile.ZipFile(io.BytesIO(payload), "r") as archive:
                names = set(archive.namelist())
                if "[Content_Types].xml" not in names or "word/document.xml" not in names:
                    return False, "docx_structure_mismatch"
        except Exception:
            return False, "docx_parse_error"
        return True, "docx_magic_ok"

    if file_type == FileType.TXT:
        sample = payload[:4096]
        if b"\x00" in sample:
            return False, "txt_binary_null_byte"
        if not sample:
            return True, "txt_empty_ok"
        non_printable = 0
        for byte in sample:
            if byte in {9, 10, 13}:  # \t, \n, \r
                continue
            if 32 <= byte <= 126:
                continue
            if byte >= 128:
                continue
            non_printable += 1
        ratio = non_printable / max(1, len(sample))
        if ratio > 0.05:
            return False, "txt_non_printable_ratio"
        return True, "txt_magic_ok"

    return False, "unsupported_type"
