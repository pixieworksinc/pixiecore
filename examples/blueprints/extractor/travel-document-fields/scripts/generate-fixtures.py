#!/usr/bin/env python3
"""Generate deterministic document fixtures for the travel-field Extractor."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle


FIXTURE_DIRECTORY = Path(__file__).resolve().parent.parent / "fixtures"
PAGE_WIDTH, PAGE_HEIGHT = A4


def text_page(
    output: Path,
    title: str,
    rows: list[tuple[str, str]],
    *,
    footer: str | None = None,
) -> None:
    document = canvas.Canvas(str(output), pagesize=A4)
    draw_header(document, title)
    y = PAGE_HEIGHT - 58 * mm
    for label, value in rows:
        document.setFillColor(colors.HexColor("#475569"))
        document.setFont("Helvetica-Bold", 10)
        document.drawString(24 * mm, y, label.upper())
        document.setFillColor(colors.HexColor("#0f172a"))
        document.setFont("Helvetica", 13)
        document.drawString(74 * mm, y, value)
        document.setStrokeColor(colors.HexColor("#e2e8f0"))
        document.line(24 * mm, y - 4 * mm, 186 * mm, y - 4 * mm)
        y -= 20 * mm
    if footer:
        document.setFillColor(colors.HexColor("#64748b"))
        document.setFont("Helvetica", 9)
        document.drawString(24 * mm, 18 * mm, footer)
    document.save()


def draw_header(document: canvas.Canvas, title: str) -> None:
    document.setFillColor(colors.HexColor("#0f172a"))
    document.rect(0, PAGE_HEIGHT - 36 * mm, PAGE_WIDTH, 36 * mm, stroke=0, fill=1)
    document.setFillColor(colors.white)
    document.setFont("Helvetica-Bold", 19)
    document.drawString(24 * mm, PAGE_HEIGHT - 23 * mm, title)


def native_text_pdf() -> None:
    text_page(
        FIXTURE_DIRECTORY / "native-text.pdf",
        "Travel Request",
        [
            ("Traveler", "Morgan Ellis"),
            ("Trip dates", "2026-09-14 to 2026-09-18"),
            ("Destination", "Paris, France"),
            ("Purpose", "Customer architecture workshop"),
            ("Estimate", "USD 2,480.50"),
        ],
        footer="Request TR-1042 | Native text fixture",
    )


def scanned_pdf() -> None:
    image = form_image(
        title="SCANNED TRAVEL REQUEST",
        rows=[
            ("Traveler", "Riley Chen"),
            ("Destination", "Chicago, USA"),
            ("Trip start", "2026-10-05"),
            ("Trip end", "2026-10-07"),
            ("Purpose", "Partner enablement session"),
        ],
        width=1654,
        height=2339,
    )
    document = canvas.Canvas(str(FIXTURE_DIRECTORY / "scanned.pdf"), pagesize=A4)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    buffer.seek(0)
    from reportlab.lib.utils import ImageReader

    document.drawImage(ImageReader(buffer), 0, 0, width=PAGE_WIDTH, height=PAGE_HEIGHT)
    document.save()


def multipage_pdf() -> None:
    output = FIXTURE_DIRECTORY / "multi-page.pdf"
    document = canvas.Canvas(str(output), pagesize=A4)
    draw_header(document, "Travel Request - Cover")
    document.setFillColor(colors.HexColor("#334155"))
    document.setFont("Helvetica", 13)
    document.drawString(24 * mm, PAGE_HEIGHT - 60 * mm, "Supporting travel details continue on page 2.")
    document.setFont("Helvetica", 9)
    document.drawRightString(186 * mm, 18 * mm, "Page 1 of 2")
    document.showPage()
    draw_header(document, "Travel Request - Details")
    document.setFillColor(colors.HexColor("#0f172a"))
    document.setFont("Helvetica", 13)
    document.drawString(24 * mm, PAGE_HEIGHT - 62 * mm, "Traveler: Avery Patel")
    document.drawString(24 * mm, PAGE_HEIGHT - 82 * mm, "Destination: London, United Kingdom")
    document.drawString(24 * mm, PAGE_HEIGHT - 102 * mm, "Purpose: Security design review")
    document.setFont("Helvetica", 9)
    document.drawRightString(186 * mm, 18 * mm, "Page 2 of 2")
    document.save()


def rotated_pdf() -> None:
    source = BytesIO()
    document = canvas.Canvas(source, pagesize=landscape(A4))
    width, height = landscape(A4)
    document.setFillColor(colors.HexColor("#0f172a"))
    document.setFont("Helvetica-Bold", 20)
    document.drawString(24 * mm, height - 28 * mm, "Travel Request - Landscape Scan")
    document.setFont("Helvetica", 14)
    document.drawString(24 * mm, height - 58 * mm, "Traveler: Jordan Kim")
    document.drawString(24 * mm, height - 78 * mm, "Destination: San Francisco, USA")
    document.drawString(24 * mm, height - 98 * mm, "Purpose: Product planning workshop")
    document.save()
    source.seek(0)

    reader = PdfReader(source)
    writer = PdfWriter()
    page = reader.pages[0]
    page.rotate(90)
    writer.add_page(page)
    with (FIXTURE_DIRECTORY / "rotated.pdf").open("wb") as stream:
        writer.write(stream)


def blank_pdf() -> None:
    document = canvas.Canvas(str(FIXTURE_DIRECTORY / "blank-page.pdf"), pagesize=A4)
    document.showPage()
    document.save()


def table_pdf() -> None:
    output = FIXTURE_DIRECTORY / "table.pdf"
    styles = getSampleStyleSheet()
    document = SimpleDocTemplate(
        str(output),
        pagesize=A4,
        leftMargin=22 * mm,
        rightMargin=22 * mm,
        topMargin=24 * mm,
        bottomMargin=24 * mm,
        title="Travel Request Table",
    )
    table = Table(
        [
            ["Field", "Submitted value"],
            ["Traveler", "Taylor Brooks"],
            ["Destination", "New York, USA"],
            ["Trip start", "2026-11-02"],
            ["Trip end", "2026-11-05"],
            ["Estimated amount", "USD 3,120.00"],
        ],
        colWidths=[52 * mm, 105 * mm],
        rowHeights=[12 * mm] * 6,
    )
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f172a")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTNAME", (0, 1), (0, -1), "Helvetica-Bold"),
        ("TEXTCOLOR", (0, 1), (-1, -1), colors.HexColor("#0f172a")),
        ("BACKGROUND", (0, 1), (-1, -1), colors.HexColor("#f8fafc")),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#94a3b8")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    document.build([
        Paragraph("Travel Request - Expense Table", styles["Title"]),
        Spacer(1, 10 * mm),
        table,
    ])


def screenshot_png() -> None:
    image = form_image(
        title="TRAVEL REQUEST PORTAL",
        rows=[
            ("Employee", "Casey Rivera"),
            ("Destination", "Los Angeles, USA"),
            ("Start date", "2026-12-01"),
            ("End date", "2026-12-03"),
            ("Business purpose", "Annual account review"),
        ],
        width=1440,
        height=900,
    )
    image.save(FIXTURE_DIRECTORY / "travel-request-screenshot.png", format="PNG")


def form_image(
    *,
    title: str,
    rows: list[tuple[str, str]],
    width: int,
    height: int,
) -> Image.Image:
    image = Image.new("RGB", (width, height), "#f1f5f9")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=max(26, width // 35))
    label_font = ImageFont.load_default(size=max(18, width // 60))
    value_font = ImageFont.load_default(size=max(22, width // 50))
    margin = width // 12
    draw.rounded_rectangle(
        (margin, margin, width - margin, height - margin),
        radius=18,
        fill="#ffffff",
        outline="#cbd5e1",
        width=3,
    )
    draw.rectangle((margin, margin, width - margin, margin + height // 8), fill="#0f172a")
    draw.text((margin + 40, margin + 32), title, fill="#ffffff", font=title_font)
    y = margin + height // 8 + 42
    field_height = max(74, (height - y - margin - 30) // len(rows))
    for label, value in rows:
        draw.text((margin + 45, y), label.upper(), fill="#64748b", font=label_font)
        draw.text((margin + width // 3, y - 3), value, fill="#0f172a", font=value_font)
        draw.line((margin + 40, y + field_height - 20, width - margin - 40, y + field_height - 20), fill="#e2e8f0", width=2)
        y += field_height
    return image


def main() -> None:
    FIXTURE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    native_text_pdf()
    scanned_pdf()
    multipage_pdf()
    rotated_pdf()
    blank_pdf()
    table_pdf()
    screenshot_png()


if __name__ == "__main__":
    main()
