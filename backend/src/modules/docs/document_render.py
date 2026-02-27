"""Рендеринг сгенерированного текста в TXT/DOCX/PDF форматы."""

from __future__ import annotations

import html
from io import BytesIO
from textwrap import wrap
from zipfile import ZIP_DEFLATED, ZipFile

from reportlab.pdfgen import canvas

from src.modules.docs.domain import FileType


def render_document_bytes(*, file_type: FileType, text: str, title: str | None) -> tuple[bytes, str, str]:
    """Собрать bytes-документ для указанного типа.

    Returns:
        tuple[payload, mime, extension]
    """
    normalized_title = str(title or "").strip() or "Документ"
    if file_type == FileType.TXT:
        return text.encode("utf-8"), "text/plain", "txt"
    if file_type == FileType.DOCX:
        return _build_docx_bytes(text=text, title=normalized_title), (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ), "docx"
    if file_type == FileType.PDF:
        return _build_pdf_bytes(text=text, title=normalized_title), "application/pdf", "pdf"
    raise ValueError("unsupported_file_type")


def _build_docx_bytes(*, text: str, title: str) -> bytes:
    """Собрать минимальный валидный DOCX из plain-текста."""
    stream = BytesIO()
    paragraphs = []
    for line in (text or "").splitlines() or [""]:
        safe_line = html.escape(line)
        if not safe_line:
            paragraphs.append("<w:p/>")
            continue
        paragraphs.append(f"<w:p><w:r><w:t xml:space=\"preserve\">{safe_line}</w:t></w:r></w:p>")

    body_xml = "".join(paragraphs)
    document_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f"<w:body>{body_xml}<w:sectPr/></w:body>"
        "</w:document>"
    )
    core_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" '
        'xmlns:dc="http://purl.org/dc/elements/1.1/">'
        f"<dc:title>{html.escape(title)}</dc:title>"
        "</cp:coreProperties>"
    )

    with ZipFile(stream, mode="w", compression=ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/word/document.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                '<Override PartName="/docProps/core.xml" '
                'ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
                "</Types>"
            ),
        )
        archive.writestr(
            "_rels/.rels",
            (
                '<?xml version="1.0" encoding="UTF-8"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="word/document.xml"/>'
                '<Relationship Id="rId2" '
                'Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" '
                'Target="docProps/core.xml"/>'
                "</Relationships>"
            ),
        )
        archive.writestr("docProps/core.xml", core_xml)
        archive.writestr("word/document.xml", document_xml)
    return stream.getvalue()


def _build_pdf_bytes(*, text: str, title: str) -> bytes:
    """Собрать PDF из plain-текста (многостранично)."""
    stream = BytesIO()
    pdf = canvas.Canvas(stream, pagesize=(595, 842))
    pdf.setTitle(title)

    x = 56
    y = 800
    line_height = 16
    content_lines = []
    for raw in (text or "").splitlines() or [""]:
        wrapped = wrap(raw, width=90) or [""]
        content_lines.extend(wrapped)

    pdf.setFont("Helvetica", 11)
    for line in content_lines:
        if y < 60:
            pdf.showPage()
            pdf.setFont("Helvetica", 11)
            y = 800
        pdf.drawString(x, y, line)
        y -= line_height

    pdf.save()
    return stream.getvalue()
