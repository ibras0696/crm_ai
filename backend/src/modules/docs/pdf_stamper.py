"""Инструменты для наложения "ручной подписи" на PDF."""

from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from pypdf import PdfReader, PdfWriter
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas


@dataclass(slots=True)
class PdfStampInput:
    """Входные параметры stamp-операции."""

    page: int
    x: float
    y: float
    width: float
    height: float
    author: str | None = None


def stamp_pdf_with_signature(
    *,
    source_pdf: bytes,
    signature_png: bytes,
    stamp: PdfStampInput,
) -> tuple[bytes, dict[str, object]]:
    """Наложить PNG-подпись на указанную страницу PDF.

    Координаты `x/y` ожидаются в системе top-left (UI), затем
    конвертируются в PDF-координаты (bottom-left).
    """
    if int(stamp.page) < 1:
        raise ValueError("page must be >= 1")
    if float(stamp.width) <= 0 or float(stamp.height) <= 0:
        raise ValueError("width/height must be > 0")

    reader = PdfReader(BytesIO(source_pdf))
    pages_total = len(reader.pages)
    if stamp.page > pages_total:
        raise ValueError("page index out of range")

    page_index = int(stamp.page) - 1
    writer = PdfWriter()

    for index, page in enumerate(reader.pages):
        if index != page_index:
            writer.add_page(page)
            continue

        page_width = float(page.mediabox.width)
        page_height = float(page.mediabox.height)
        place_x = max(0.0, min(float(stamp.x), max(0.0, page_width - float(stamp.width))))
        place_y_top = max(0.0, min(float(stamp.y), max(0.0, page_height - float(stamp.height))))
        place_y_pdf = max(0.0, page_height - place_y_top - float(stamp.height))

        overlay_stream = BytesIO()
        overlay_canvas = canvas.Canvas(overlay_stream, pagesize=(page_width, page_height))
        overlay_canvas.drawImage(
            ImageReader(BytesIO(signature_png)),
            place_x,
            place_y_pdf,
            width=float(stamp.width),
            height=float(stamp.height),
            mask="auto",
        )
        if stamp.author:
            overlay_canvas.setFont("Helvetica", 8)
            overlay_canvas.drawString(
                place_x,
                max(0.0, place_y_pdf - 10),
                str(stamp.author)[:80],
            )
        overlay_canvas.showPage()
        overlay_canvas.save()
        overlay_stream.seek(0)

        overlay_page = PdfReader(overlay_stream).pages[0]
        page.merge_page(overlay_page)
        writer.add_page(page)

    out = BytesIO()
    writer.write(out)
    stamped = out.getvalue()
    meta = {
        "page": int(stamp.page),
        "x": float(place_x),
        "y": float(place_y_top),
        "width": float(stamp.width),
        "height": float(stamp.height),
        "author": str(stamp.author or "").strip() or None,
    }
    return stamped, meta

