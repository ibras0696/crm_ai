"""Advanced PDF processing with annotations, signatures, and manipulation."""

from __future__ import annotations

import base64
import io
from dataclasses import dataclass
from typing import Any

from PIL import Image, UnidentifiedImageError
from pypdf import PdfReader, PdfWriter
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas as pdf_canvas


@dataclass
class PDFAnnotation:
    """PDF annotation data."""

    annotation_type: str  # text, shape, signature, highlight, stamp, comment
    page: int
    x: float
    y: float
    width: float
    height: float
    content: str | None = None
    color: str | None = None
    image_data: str | None = None
    metadata: dict[str, Any] | None = None


@dataclass
class PDFProcessorResult:
    """Result of PDF processing."""

    pdf_bytes: bytes
    annotations_applied: int
    pages_processed: int


class PDFProcessor:
    """Advanced PDF processor for annotations, signatures, and manipulation."""

    def add_annotations(
        self,
        pdf_bytes: bytes,
        annotations: list[PDFAnnotation],
    ) -> PDFProcessorResult:
        """Add multiple annotations to PDF."""
        reader = PdfReader(io.BytesIO(pdf_bytes))
        writer = PdfWriter()

        annotations_applied = 0

        for page_num in range(len(reader.pages)):
            page = reader.pages[page_num]
            page_annotations = [a for a in annotations if a.page == page_num]

            if page_annotations:
                overlay = self._create_annotation_overlay(
                    page_annotations,
                    float(page.mediabox.width),
                    float(page.mediabox.height),
                )
                page.merge_page(overlay)
                annotations_applied += len(page_annotations)

            writer.add_page(page)

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)

        return PDFProcessorResult(
            pdf_bytes=output.read(),
            annotations_applied=annotations_applied,
            pages_processed=len(reader.pages),
        )

    def _create_annotation_overlay(
        self,
        annotations: list[PDFAnnotation],
        page_width: float,
        page_height: float,
    ) -> Any:
        """Create overlay page with annotations."""
        packet = io.BytesIO()
        can = pdf_canvas.Canvas(packet, pagesize=(page_width, page_height))

        for annotation in annotations:
            if annotation.annotation_type == "text" and annotation.content:
                self._draw_text(can, annotation, page_height)
            elif annotation.annotation_type == "signature" and annotation.image_data:
                self._draw_signature(can, annotation, page_height)
            elif annotation.annotation_type == "highlight":
                self._draw_highlight(can, annotation, page_height)
            elif annotation.annotation_type in ("rectangle", "circle"):
                self._draw_shape(can, annotation, page_height)
            elif annotation.annotation_type == "stamp" and annotation.content:
                self._draw_stamp(can, annotation, page_height)

        can.save()
        packet.seek(0)
        return PdfReader(packet).pages[0]

    def _draw_text(
        self,
        canvas: pdf_canvas.Canvas,
        annotation: PDFAnnotation,
        page_height: float,
    ) -> None:
        """Draw text annotation."""
        y_coord = page_height - annotation.y - annotation.height

        if annotation.color:
            color = HexColor(annotation.color)
            canvas.setFillColor(color)

        canvas.setFont("Helvetica", 12)
        canvas.drawString(annotation.x, y_coord, annotation.content or "")

    def _draw_signature(
        self,
        canvas: pdf_canvas.Canvas,
        annotation: PDFAnnotation,
        page_height: float,
    ) -> None:
        """Draw signature image."""
        try:
            # Decode base64 image
            if annotation.image_data and annotation.image_data.startswith("data:image"):
                image_data = annotation.image_data.split(",")[1]
            else:
                image_data = annotation.image_data or ""

            image_bytes = base64.b64decode(image_data)
            image = Image.open(io.BytesIO(image_bytes))

            # Save to temporary buffer
            temp_buffer = io.BytesIO()
            image.save(temp_buffer, format="PNG")
            temp_buffer.seek(0)

            y_coord = page_height - annotation.y - annotation.height

            canvas.drawImage(
                temp_buffer,
                annotation.x,
                y_coord,
                width=annotation.width,
                height=annotation.height,
                preserveAspectRatio=True,
                mask="auto",
            )
        except (OSError, TypeError, ValueError, UnidentifiedImageError, base64.binascii.Error) as e:
            # Fallback: draw placeholder
            print(f"Failed to draw signature: {e}")
            self._draw_placeholder(canvas, annotation, page_height, "SIGNATURE")

    def _draw_highlight(
        self,
        canvas: pdf_canvas.Canvas,
        annotation: PDFAnnotation,
        page_height: float,
    ) -> None:
        """Draw highlight annotation."""
        y_coord = page_height - annotation.y - annotation.height

        color = HexColor(annotation.color) if annotation.color else HexColor("#FFFF00")
        canvas.setFillColor(color)
        canvas.setStrokeColor(color)
        canvas.setFillAlpha(0.3)

        canvas.rect(
            annotation.x,
            y_coord,
            annotation.width,
            annotation.height,
            fill=1,
            stroke=0,
        )

    def _draw_shape(
        self,
        canvas: pdf_canvas.Canvas,
        annotation: PDFAnnotation,
        page_height: float,
    ) -> None:
        """Draw shape annotation (rectangle or circle)."""
        y_coord = page_height - annotation.y - annotation.height

        color = HexColor(annotation.color) if annotation.color else HexColor("#000000")
        canvas.setStrokeColor(color)
        canvas.setLineWidth(2)

        if annotation.annotation_type == "rectangle":
            canvas.rect(
                annotation.x,
                y_coord,
                annotation.width,
                annotation.height,
                fill=0,
                stroke=1,
            )
        elif annotation.annotation_type == "circle":
            center_x = annotation.x + annotation.width / 2
            center_y = y_coord + annotation.height / 2
            radius = min(annotation.width, annotation.height) / 2
            canvas.circle(center_x, center_y, radius, fill=0, stroke=1)

    def _draw_stamp(
        self,
        canvas: pdf_canvas.Canvas,
        annotation: PDFAnnotation,
        page_height: float,
    ) -> None:
        """Draw stamp annotation."""
        y_coord = page_height - annotation.y - annotation.height

        canvas.setStrokeColor(HexColor("#FF0000"))
        canvas.setLineWidth(3)
        canvas.rect(
            annotation.x,
            y_coord,
            annotation.width,
            annotation.height,
            fill=0,
            stroke=1,
        )

        canvas.setFillColor(HexColor("#FF0000"))
        canvas.setFont("Helvetica-Bold", 14)

        text_x = annotation.x + annotation.width / 2
        text_y = y_coord + annotation.height / 2

        canvas.drawCentredString(text_x, text_y, annotation.content or "STAMP")

    def _draw_placeholder(
        self,
        canvas: pdf_canvas.Canvas,
        annotation: PDFAnnotation,
        page_height: float,
        text: str,
    ) -> None:
        """Draw placeholder for failed annotations."""
        y_coord = page_height - annotation.y - annotation.height

        canvas.setStrokeColor(HexColor("#CCCCCC"))
        canvas.setFillColor(HexColor("#F0F0F0"))
        canvas.rect(
            annotation.x,
            y_coord,
            annotation.width,
            annotation.height,
            fill=1,
            stroke=1,
        )

        canvas.setFillColor(HexColor("#666666"))
        canvas.setFont("Helvetica", 10)
        canvas.drawCentredString(
            annotation.x + annotation.width / 2,
            y_coord + annotation.height / 2,
            text,
        )

    def merge_pdfs(self, pdf_list: list[bytes]) -> bytes:
        """Merge multiple PDFs into one."""
        writer = PdfWriter()

        for pdf_bytes in pdf_list:
            reader = PdfReader(io.BytesIO(pdf_bytes))
            for page in reader.pages:
                writer.add_page(page)

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)
        return output.read()

    def split_pdf(self, pdf_bytes: bytes, page_ranges: list[tuple[int, int]]) -> list[bytes]:
        """Split PDF into multiple PDFs based on page ranges."""
        reader = PdfReader(io.BytesIO(pdf_bytes))
        result: list[bytes] = []

        for start, end in page_ranges:
            writer = PdfWriter()
            for page_num in range(start, min(end + 1, len(reader.pages))):
                writer.add_page(reader.pages[page_num])

            output = io.BytesIO()
            writer.write(output)
            output.seek(0)
            result.append(output.read())

        return result

    def rotate_pages(
        self,
        pdf_bytes: bytes,
        rotations: dict[int, int],
    ) -> bytes:
        """Rotate specific pages (rotations: {page_num: degrees})."""
        reader = PdfReader(io.BytesIO(pdf_bytes))
        writer = PdfWriter()

        for page_num in range(len(reader.pages)):
            page = reader.pages[page_num]
            if page_num in rotations:
                page.rotate(rotations[page_num])
            writer.add_page(page)

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)
        return output.read()

    def delete_pages(self, pdf_bytes: bytes, pages_to_delete: list[int]) -> bytes:
        """Delete specific pages from PDF."""
        reader = PdfReader(io.BytesIO(pdf_bytes))
        writer = PdfWriter()

        for page_num in range(len(reader.pages)):
            if page_num not in pages_to_delete:
                writer.add_page(reader.pages[page_num])

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)
        return output.read()

    def add_watermark(
        self,
        pdf_bytes: bytes,
        watermark_text: str,
        opacity: float = 0.3,
        rotation: int = 45,
    ) -> bytes:
        """Add watermark to all pages."""
        reader = PdfReader(io.BytesIO(pdf_bytes))
        writer = PdfWriter()

        for page in reader.pages:
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)

            # Create watermark overlay
            packet = io.BytesIO()
            can = pdf_canvas.Canvas(packet, pagesize=(page_width, page_height))

            can.saveState()
            can.setFillAlpha(opacity)
            can.setFillColor(HexColor("#CCCCCC"))
            can.setFont("Helvetica-Bold", 60)

            # Center and rotate
            can.translate(page_width / 2, page_height / 2)
            can.rotate(rotation)
            can.drawCentredString(0, 0, watermark_text)

            can.restoreState()
            can.save()

            packet.seek(0)
            watermark_page = PdfReader(packet).pages[0]
            page.merge_page(watermark_page)
            writer.add_page(page)

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)
        return output.read()

    def extract_metadata(self, pdf_bytes: bytes) -> dict[str, Any]:
        """Extract PDF metadata."""
        reader = PdfReader(io.BytesIO(pdf_bytes))

        metadata = {
            "pages": len(reader.pages),
            "info": {},
        }

        if reader.metadata:
            metadata["info"] = {
                "title": reader.metadata.get("/Title", ""),
                "author": reader.metadata.get("/Author", ""),
                "subject": reader.metadata.get("/Subject", ""),
                "creator": reader.metadata.get("/Creator", ""),
                "producer": reader.metadata.get("/Producer", ""),
                "creation_date": reader.metadata.get("/CreationDate", ""),
                "modification_date": reader.metadata.get("/ModDate", ""),
            }

        return metadata

    def update_metadata(
        self,
        pdf_bytes: bytes,
        metadata: dict[str, str],
    ) -> bytes:
        """Update PDF metadata."""
        reader = PdfReader(io.BytesIO(pdf_bytes))
        writer = PdfWriter()

        for page in reader.pages:
            writer.add_page(page)

        # Update metadata
        if "title" in metadata:
            writer.add_metadata({"/Title": metadata["title"]})
        if "author" in metadata:
            writer.add_metadata({"/Author": metadata["author"]})
        if "subject" in metadata:
            writer.add_metadata({"/Subject": metadata["subject"]})

        output = io.BytesIO()
        writer.write(output)
        output.seek(0)
        return output.read()
