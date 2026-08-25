"""Generate reproducible messy answer-sheet variants for OCR stress testing.

The question content and answer labels stay constant across all variants.
Only paper, handwriting font, scan quality, and physical damage change so
failures can be compared fairly.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import random
import shutil
from pathlib import Path

import fitz
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont


REPO_SAMPLE = Path(__file__).resolve().parent
BASE_GENERATOR_PATH = REPO_SAMPLE / "generate_fixtures.py"


def load_base_module():
    spec = importlib.util.spec_from_file_location("fixture_base", BASE_GENERATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {BASE_GENERATOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASE = load_base_module()
PAGE_W, PAGE_H = BASE.PAGE_W, BASE.PAGE_H


VARIANTS = [
    {
        "id": "01_lined_inkfree",
        "paper": "cream ruled notebook paper",
        "paper_color": "#fbfaf4",
        "line_color": "#c7d8eb",
        "margin_color": "#e7a6a6",
        "font_path": r"C:\Windows\Fonts\Inkfree.ttf",
        "ink": "#183b70",
        "line_style": "ruled",
        "line_spacing": 23,
        "rotation": 0.35,
        "noise_alpha": 0.035,
        "noise_strength": 7,
        "blur": 0.05,
        "crease_count": 1,
        "smudges": 2,
        "bleed_alpha": 0,
        "crossouts": 0,
        "difficulty": "medium",
        "focus": "Baseline cursive with mild skew and natural ink variation.",
        "failure_modes": "Small label characters may be missed; mapping should still be reliable.",
        "seed": 101,
    },
    {
        "id": "02_recycled_segoe_print",
        "paper": "warm recycled paper with a wide red margin",
        "paper_color": "#f3ead5",
        "line_color": "#d4c7a9",
        "margin_color": "#c98989",
        "font_path": r"C:\Windows\Fonts\segoepr.ttf",
        "ink": "#203d61",
        "line_style": "wide",
        "line_spacing": 29,
        "rotation": -0.65,
        "noise_alpha": 0.075,
        "noise_strength": 12,
        "blur": 0.15,
        "crease_count": 2,
        "smudges": 5,
        "bleed_alpha": 8,
        "crossouts": 1,
        "difficulty": "medium-high",
        "focus": "Warm paper tint, wider baselines, faint scan noise, and a few ink smears.",
        "failure_modes": "Low-contrast blue ink and warm tint can reduce confidence in long lines.",
        "seed": 202,
    },
    {
        "id": "03_graph_lucida_handwriting",
        "paper": "pale blue graph paper with faint bleed-through",
        "paper_color": "#eef5f5",
        "line_color": "#b9d3d7",
        "margin_color": "#d99a9a",
        "font_path": r"C:\Windows\Fonts\LHANDW.TTF",
        "ink": "#194b43",
        "line_style": "graph",
        "line_spacing": 18,
        "rotation": 0.9,
        "noise_alpha": 0.06,
        "noise_strength": 10,
        "blur": 0.2,
        "crease_count": 3,
        "smudges": 6,
        "bleed_alpha": 12,
        "crossouts": 2,
        "difficulty": "high",
        "focus": "Graph lines, green-black ink, heavier baseline interference, and cross-outs.",
        "failure_modes": "Text-line segmentation may merge with grid lines; answer boxes can drift.",
        "seed": 303,
    },
    {
        "id": "04_exam_booklet_french_script",
        "paper": "gray exam-booklet paper with a page fold and shadow",
        "paper_color": "#e9e5dc",
        "line_color": "#c9c5bb",
        "margin_color": "#bf8d8d",
        "font_path": r"C:\Windows\Fonts\FRSCRIPT.TTF",
        "ink": "#283447",
        "line_style": "sparse",
        "line_spacing": 27,
        "rotation": -1.15,
        "noise_alpha": 0.095,
        "noise_strength": 15,
        "blur": 0.35,
        "crease_count": 5,
        "smudges": 8,
        "bleed_alpha": 16,
        "crossouts": 2,
        "difficulty": "very high",
        "focus": "Thin script, gray paper, page shadow, folds, and low-contrast scan.",
        "failure_modes": "Cursive segmentation and faint labels may cause missed or merged question IDs.",
        "seed": 404,
    },
    {
        "id": "05_crumpled_script_mt",
        "paper": "crumpled ruled paper with strong diagonal folds",
        "paper_color": "#f6f0df",
        "line_color": "#bac9da",
        "margin_color": "#d79797",
        "font_path": r"C:\Windows\Fonts\SCRIPTBL.TTF",
        "ink": "#1f3159",
        "line_style": "ruled",
        "line_spacing": 24,
        "rotation": 1.25,
        "noise_alpha": 0.12,
        "noise_strength": 20,
        "blur": 0.5,
        "crease_count": 12,
        "smudges": 11,
        "bleed_alpha": 25,
        "crossouts": 3,
        "difficulty": "extreme",
        "focus": "Strong folds, dark edge shadows, bleed-through, blur, and dense script.",
        "failure_modes": "Hardest case: OCR can lose labels, split regions, or mistake fold shadows for writing.",
        "seed": 505,
    },
]


def register_variant_font(index: int, font_path: str) -> str:
    path = Path(font_path)
    if not path.exists():
        path = Path(r"C:\Windows\Fonts\segoepr.ttf")
    font_name = f"StressFont{index}"
    pdfmetrics.registerFont(TTFont(font_name, str(path)))
    return font_name


def make_background(config: dict[str, object], variant_index: int):
    paper_color = colors.HexColor(str(config["paper_color"]))
    line_color = colors.HexColor(str(config["line_color"]))
    margin_color = colors.HexColor(str(config["margin_color"]))
    line_style = str(config["line_style"])
    spacing = float(config["line_spacing"])
    seed = int(config["seed"])

    def draw(c, page_no: int, total: int) -> None:
        c.setFillColor(paper_color)
        c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
        c.setStrokeColor(line_color)
        c.setLineWidth(0.45)
        if line_style == "graph":
            for x in range(18, int(PAGE_W), int(spacing)):
                c.line(x, 16 * mm, x, PAGE_H - 16 * mm)
            for y in range(int(PAGE_H - 68), int(16 * mm), -int(spacing)):
                c.line(16 * mm, y, PAGE_W - 12 * mm, y)
        elif line_style == "sparse":
            for y in range(int(PAGE_H - 82), int(16 * mm), -int(spacing)):
                c.line(18 * mm, y, PAGE_W - 12 * mm, y)
        else:
            for y in range(int(PAGE_H - 74), int(16 * mm), -int(spacing)):
                c.line(15 * mm, y, PAGE_W - 12 * mm, y)
        c.setStrokeColor(margin_color)
        c.setLineWidth(0.8)
        c.line(29 * mm, 16 * mm, 29 * mm, PAGE_H - 16 * mm)
        c.setFillColor(colors.HexColor("#68727f"))
        c.setFont("Helvetica", 7.2)
        c.drawString(13 * mm, PAGE_H - 28, f"NORTHSTAR / ANSWER BOOKLET {variant_index}")
        c.drawRightString(PAGE_W - 14 * mm, PAGE_H - 28, f"Student: A. Mehta    Page {page_no}/{total}")
        c.setFillColor(colors.HexColor("#8d8a80"))
        c.setFont("Helvetica-Oblique", 7)
        c.drawString(34 * mm, 11 * mm, "Stress fixture - scan condition intentionally degraded")
        if line_style == "graph":
            c.setFillColor(colors.HexColor("#8da6aa"))
            c.setFont("Helvetica", 6.5)
            c.drawRightString(PAGE_W - 14 * mm, 11 * mm, "grid 5 mm")
        random.seed(seed + page_no)

    return draw


def render_pdf_pages(pdf_path: Path, output_dir: Path, config: dict[str, object]) -> list[Path]:
    doc = fitz.open(str(pdf_path))
    page_paths: list[Path] = []
    for page_no, page in enumerate(doc, start=1):
        page_path = output_dir / f"answer-page-{page_no}.png"
        pix = page.get_pixmap(matrix=fitz.Matrix(2.05, 2.05), alpha=False)
        pix.save(str(page_path))
        style_page(page_path, config, page_no)
        page_paths.append(page_path)
    return page_paths


def style_page(page_path: Path, config: dict[str, object], page_no: int) -> None:
    random.seed(int(config["seed"]) + page_no * 37)
    image = Image.open(page_path).convert("RGB")
    paper_rgb = tuple(int(config["paper_color"][i : i + 2], 16) for i in (1, 3, 5))
    image = Image.blend(image, Image.new("RGB", image.size, paper_rgb), 0.06)
    image = ImageEnhance.Contrast(image).enhance(0.9 if config["difficulty"] == "extreme" else 0.96)
    image = ImageEnhance.Color(image).enhance(0.88)
    if float(config["blur"]) > 0:
        image = image.filter(ImageFilter.GaussianBlur(float(config["blur"])))
    angle = float(config["rotation"])
    if angle:
        image = image.rotate(angle, resample=Image.Resampling.BICUBIC, expand=False, fillcolor=paper_rgb)

    width, height = image.size
    overlay = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    # Uneven scanner shadows at the edges.
    draw.rectangle((0, 0, width, int(height * 0.018)), fill=(40, 40, 40, 20))
    draw.rectangle((0, 0, int(width * 0.012), height), fill=(30, 30, 30, 18))
    draw.rectangle((int(width * 0.986), 0, width, height), fill=(70, 60, 40, 16))

    # Smudges near writing lines; translucent and blurred rather than opaque.
    for _ in range(int(config["smudges"])):
        x = random.randint(int(width * 0.17), int(width * 0.86))
        y = random.randint(int(height * 0.13), int(height * 0.84))
        radius = random.randint(5, 22)
        draw.ellipse((x - radius, y - radius // 2, x + radius, y + radius // 2), fill=(35, 46, 66, random.randint(8, 24)))

    # Cross-outs are sparse and intentionally do not cover whole answers.
    for index in range(int(config["crossouts"])):
        y = int(height * (0.30 + (index % 4) * 0.11))
        x1 = int(width * (0.30 + (index % 2) * 0.03))
        x2 = int(width * (0.66 + (index % 3) * 0.05))
        draw.line((x1, y, x2, y + random.randint(-8, 8)), fill=(26, 49, 83, 105), width=max(2, int(width / 520)))

    # Creases are built from a soft dark fold plus a lighter highlight.
    crease_layer = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    crease_draw = ImageDraw.Draw(crease_layer)
    for _ in range(int(config["crease_count"])):
        if random.random() < 0.55:
            x = random.randint(int(width * 0.10), int(width * 0.92))
            points = [(x, 0), (x + random.randint(-70, 70), int(height * 0.35)), (x + random.randint(-90, 90), int(height * 0.72)), (x + random.randint(-80, 80), height)]
        else:
            y = random.randint(int(height * 0.15), int(height * 0.88))
            points = [(0, y), (int(width * 0.35), y + random.randint(-70, 70)), (int(width * 0.72), y + random.randint(-80, 80)), (width, y + random.randint(-60, 60))]
        crease_draw.line(points, fill=(55, 49, 40, 30), width=random.randint(8, 18), joint="curve")
        crease_draw.line([(x + 4, y) for x, y in points], fill=(255, 255, 255, 24), width=random.randint(2, 5), joint="curve")
    crease_layer = crease_layer.filter(ImageFilter.GaussianBlur(4.5 if config["difficulty"] == "extreme" else 2.5))
    overlay = Image.alpha_composite(overlay, crease_layer)

    image = Image.alpha_composite(image.convert("RGBA"), overlay).convert("RGB")

    # Very light reverse-side bleed-through; only the hardest variants get it.
    bleed_alpha = int(config["bleed_alpha"])
    if bleed_alpha:
        bleed = ImageOps.flip(image).filter(ImageFilter.GaussianBlur(2.2)).convert("RGBA")
        bleed.putalpha(Image.new("L", image.size, bleed_alpha))
        image = Image.alpha_composite(image.convert("RGBA"), bleed).convert("RGB")

    # Add a faint noise field after all transforms so the page looks scanned.
    noise = Image.effect_noise(image.size, float(config["noise_strength"])).convert("L")
    noise = ImageOps.autocontrast(noise)
    noise_rgb = ImageOps.colorize(noise, black=(178, 174, 161), white=(255, 255, 250)).convert("RGB")
    image = Image.blend(image, noise_rgb, float(config["noise_alpha"]))
    image.save(page_path, optimize=True)


def make_image_pdf(page_paths: list[Path], output_pdf: Path) -> None:
    pages = [Image.open(path).convert("RGB") for path in page_paths]
    pages[0].save(str(output_pdf), "PDF", resolution=150.0, save_all=True, append_images=pages[1:])


def resolve_output_dir(requested: Path) -> Path:
    if not requested.exists() or not any(requested.iterdir()):
        requested.mkdir(parents=True, exist_ok=True)
        return requested
    suffix = 2
    while True:
        candidate = requested.with_name(f"{requested.name}-copy{suffix if suffix > 2 else ''}")
        if not candidate.exists():
            candidate.mkdir(parents=True)
            return candidate
        suffix += 1


def write_report(output_dir: Path, results: list[dict[str, object]]) -> None:
    lines = [
        "# Messy answer-sheet stress report",
        "",
        "These five fixtures use the same question paper and the same answer labels. Only the physical presentation changes, so mapping differences can be attributed to image conditions.",
        "",
        "Important: the difficulty ratings below are engineering estimates from the fixture design. Gemini/Groq were not called by this generator, so this is not a measured model-accuracy report.",
        "",
        "| Case | Paper and writing | Stress conditions | Estimated difficulty |",
        "| --- | --- | --- | --- |",
    ]
    for item in results:
        lines.append(f"| {item['id']} | {item['paper']} / {item['font']} | {item['focus']} | {item['difficulty']} |")
    lines.extend(
        [
            "",
            "## Shared ground truth",
            "",
            "- 18 printed question entries, with labelled sub-parts kept separate.",
            "- 14 answered entries, 4 unanswered entries: `2(b)`, `6(b)(ii)`, `9`, and `11(b)`.",
            "- `2(a)` spans answer-sheet pages 1 and 2.",
            "- `Q13` is an unmatched answer.",
            "- `Q8` is a diagram answer; `Q5` is a long SQL answer.",
            "",
            "## Recommended test order",
            "",
            "1. Run Case 01 to verify the baseline OCR and mapping path.",
            "2. Run Cases 02 and 03 to test low contrast, lines, smudges, and segmentation.",
            "3. Run Case 04 to test thin cursive and skew.",
            "4. Run Case 05 last; it is deliberately close to a worst-case scan and should be used to test graceful uncertainty rather than perfect extraction.",
            "",
            "## What a robust result should do",
            "",
            "- Preserve the printed question order and keep every labelled sub-part separate.",
            "- Map answers by label and content even when answer order is different.",
            "- Keep multi-page regions together for `2(a)`.",
            "- Show explicit unanswered and unmatched states instead of silently dropping them.",
            "- Lower confidence or request review when a fold, shadow, or cursive label makes the region ambiguous.",
        ]
    )
    (output_dir / "messy-variant-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=Path(r"C:\Users\anude\Downloads\vedaai-hard-variants"))
    args = parser.parse_args()
    output_dir = resolve_output_dir(args.output_dir)
    results: list[dict[str, object]] = []

    for index, config in enumerate(VARIANTS, start=1):
        variant_dir = output_dir / config["id"]
        variant_dir.mkdir(parents=True, exist_ok=False)
        shutil.copy2(REPO_SAMPLE / "tough-question-paper.pdf", variant_dir / "question-paper.pdf")
        shutil.copy2(REPO_SAMPLE / "expected-answer-mapping.json", variant_dir / "expected-answer-mapping.json")
        shutil.copy2(REPO_SAMPLE / "README.md", variant_dir / "README-ground-truth.md")

        font_name = register_variant_font(index, str(config["font_path"]))
        BASE.HAND_FONT = font_name
        BASE.HAND_BOLD = font_name
        BASE.INK_BLUE = colors.HexColor(str(config["ink"]))
        BASE.draw_answer_page_background = make_background(config, index)

        source_pdf = variant_dir / ".answer-source.pdf"
        BASE.create_answer_sheet(source_pdf)
        page_paths = render_pdf_pages(source_pdf, variant_dir, config)
        source_pdf.unlink()
        make_image_pdf(page_paths, variant_dir / "answer-sheet.pdf")
        manifest = {
            "id": config["id"],
            "paper": config["paper"],
            "font": Path(str(config["font_path"])).name,
            "difficulty": config["difficulty"],
            "focus": config["focus"],
            "failureModes": config["failure_modes"],
            "questionPaper": "question-paper.pdf",
            "answerSheet": "answer-sheet.pdf",
            "answerPages": [path.name for path in page_paths],
            "groundTruth": "expected-answer-mapping.json",
        }
        (variant_dir / "variant-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        results.append(manifest)

    write_report(output_dir, results)
    (output_dir / "variant-index.json").write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(f"Created {len(results)} variants in {output_dir}")
    print(f"Report: {output_dir / 'messy-variant-report.md'}")


if __name__ == "__main__":
    main()
