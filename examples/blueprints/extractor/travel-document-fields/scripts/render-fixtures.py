#!/usr/bin/env python3
"""Render every document fixture into one visual QA contact sheet."""

from __future__ import annotations

from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageFont


UNIT_DIRECTORY = Path(__file__).resolve().parent.parent
FIXTURE_DIRECTORY = UNIT_DIRECTORY / "fixtures"
OUTPUT_DIRECTORY = UNIT_DIRECTORY.parents[3] / "tmp" / "pdfs" / "travel-document-fields"


def main() -> None:
    OUTPUT_DIRECTORY.mkdir(parents=True, exist_ok=True)
    rendered: list[tuple[str, Image.Image]] = []
    for pdf_path in sorted(FIXTURE_DIRECTORY.glob("*.pdf")):
        with fitz.open(pdf_path) as document:
            for page_index, page in enumerate(document):
                pixmap = page.get_pixmap(matrix=fitz.Matrix(1.25, 1.25), alpha=False)
                output = OUTPUT_DIRECTORY / f"{pdf_path.stem}-page-{page_index + 1}.png"
                pixmap.save(output)
                rendered.append((f"{pdf_path.name} / page {page_index + 1}", Image.open(output).convert("RGB")))
    rendered.append(("travel-request-screenshot.png", Image.open(
        FIXTURE_DIRECTORY / "travel-request-screenshot.png",
    ).convert("RGB")))
    contact_sheet(rendered).save(OUTPUT_DIRECTORY / "contact-sheet.png")


def contact_sheet(rendered: list[tuple[str, Image.Image]]) -> Image.Image:
    thumbnail_width = 430
    label_height = 46
    gap = 20
    columns = 2
    font = ImageFont.load_default(size=18)
    cells: list[tuple[str, Image.Image]] = []
    for label, image in rendered:
        thumbnail = image.copy()
        thumbnail.thumbnail((thumbnail_width, 610))
        cells.append((label, thumbnail))
    cell_height = max(image.height for _, image in cells) + label_height
    rows = (len(cells) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (
            columns * thumbnail_width + (columns + 1) * gap,
            rows * cell_height + (rows + 1) * gap,
        ),
        "#dbe4ee",
    )
    draw = ImageDraw.Draw(sheet)
    for index, (label, image) in enumerate(cells):
        column = index % columns
        row = index // columns
        x = gap + column * (thumbnail_width + gap)
        y = gap + row * (cell_height + gap)
        draw.rectangle((x, y, x + thumbnail_width, y + cell_height), fill="white")
        draw.text((x + 10, y + 10), label, fill="#0f172a", font=font)
        sheet.paste(image, (x + (thumbnail_width - image.width) // 2, y + label_height))
    return sheet


if __name__ == "__main__":
    main()
