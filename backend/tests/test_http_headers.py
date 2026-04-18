from urllib.parse import quote

from src.common.http_headers import (
    content_disposition,
    content_disposition_attachment,
    content_disposition_inline,
)
from src.modules.files import storage as files_storage


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


def test_presigned_get_url_adds_utf8_charset_for_markdown(monkeypatch):
    captured: dict[str, object] = {}

    class _S3Client:
        def generate_presigned_url(self, _operation_name: str, **kwargs: object) -> str:
            captured["params"] = kwargs["Params"]
            captured["expires_in"] = kwargs["ExpiresIn"]
            return "https://download.example.com/file"

    monkeypatch.setattr(files_storage, "ensure_bucket", lambda: None)
    monkeypatch.setattr(files_storage, "get_s3_presign_client", lambda: _S3Client())

    url = files_storage.generate_presigned_get_url(
        s3_key="org/demo/file.md",
        bucket="crm-files",
        expires_in=321,
        filename="Архитектура CRM.md",
        content_type="application/octet-stream",
        inline=True,
    )

    assert url == "https://download.example.com/file"
    params = captured["params"]
    assert params["ResponseContentDisposition"].startswith("inline; ")
    assert params["ResponseContentType"] == "text/markdown; charset=utf-8"
