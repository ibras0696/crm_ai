from urllib.parse import quote

from src.common.http_headers import (
    content_disposition,
    content_disposition_attachment,
    content_disposition_inline,
)


def test_content_disposition_attachment_includes_ascii_and_utf8_filename():
    filename = "Договор №124-Б.pdf"

    header = content_disposition_attachment(filename)

    assert header.startswith("attachment; ")
    assert 'filename="' in header
    assert "filename*=UTF-8''" in header
    assert quote(filename, safe="") in header
    assert ".pdf" in header


def test_content_disposition_inline_uses_inline_disposition():
    header = content_disposition_inline("report.txt")

    assert header.startswith("inline; ")
    assert 'filename="report.txt"' in header
    assert "filename*=UTF-8''report.txt" in header


def test_content_disposition_defaults_to_attachment_for_unknown_disposition():
    header = content_disposition("file.bin", disposition="unexpected")

    assert header.startswith("attachment; ")
