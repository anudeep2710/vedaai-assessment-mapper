"""Create hard extraction fixtures for the VedaAI assessment mapper.

The PDFs are intentionally deterministic so the expected mapping can be used
to compare an AI extraction run against known answer locations.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Sequence

import fitz
from PIL import Image, ImageEnhance
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.utils import simpleSplit
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parent
PAGE_W, PAGE_H = A4
MARGIN = 18 * mm
INK_BLUE = colors.HexColor("#183b70")
PAPER = colors.HexColor("#fffefa")
LINE_BLUE = colors.HexColor("#c7d8eb")
MUTED = colors.HexColor("#667085")
ORANGE = colors.HexColor("#f05b3b")


def register_fonts() -> tuple[str, str]:
    """Register a readable handwriting font when running on Windows."""

    candidates = [
        ("Inkfree", Path(r"C:\Windows\Fonts\Inkfree.ttf")),
        ("SegoePrint", Path(r"C:\Windows\Fonts\segoepr.ttf")),
    ]
    for name, path in candidates:
        if path.exists():
            pdfmetrics.registerFont(TTFont(name, str(path)))
            bold_path = path.with_name(path.stem + "b" + path.suffix)
            bold_name = name + "Bold"
            if bold_path.exists():
                pdfmetrics.registerFont(TTFont(bold_name, str(bold_path)))
            else:
                bold_name = name
            return name, bold_name
    return "Helvetica-Oblique", "Helvetica-BoldOblique"


HAND_FONT, HAND_BOLD = register_fonts()


def draw_wrapped(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    font: str = "Helvetica",
    size: float = 9.2,
    leading: float | None = None,
    color: colors.Color = colors.black,
) -> tuple[float, list[str]]:
    leading = leading or size * 1.35
    lines = simpleSplit(text, font, size, width)
    c.setFont(font, size)
    c.setFillColor(color)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y, lines


def rounded_rect(
    c: canvas.Canvas,
    x: float,
    y: float,
    width: float,
    height: float,
    fill: colors.Color,
    stroke: colors.Color,
    radius: float = 8,
) -> None:
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.roundRect(x, y, width, height, radius, fill=1, stroke=1)


def question_header(c: canvas.Canvas, section: str, page_label: str) -> None:
    c.setFillColor(colors.HexColor("#182230"))
    c.rect(0, PAGE_H - 48, PAGE_W, 48, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 13)
    c.drawString(MARGIN, PAGE_H - 29, "NORTHSTAR INSTITUTE")
    c.setFont("Helvetica", 8.5)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 29, page_label)
    c.setFillColor(ORANGE)
    c.rect(MARGIN, PAGE_H - 66, 90, 3, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#344054"))
    c.setFont("Helvetica-Bold", 11)
    c.drawString(MARGIN, PAGE_H - 60, "ADVANCED SYSTEMS AND ALGORITHMS")
    c.setFont("Helvetica", 8.5)
    c.setFillColor(MUTED)
    c.drawRightString(PAGE_W - MARGIN, PAGE_H - 60, section)


def question_footer(c: canvas.Canvas, page_no: int, total: int) -> None:
    c.setStrokeColor(colors.HexColor("#d0d5dd"))
    c.line(MARGIN, 18 * mm, PAGE_W - MARGIN, 18 * mm)
    c.setFillColor(MUTED)
    c.setFont("Helvetica", 8)
    c.drawString(MARGIN, 13 * mm, "Mock assessment fixture - extraction stress test")
    c.drawRightString(PAGE_W - MARGIN, 13 * mm, f"Page {page_no} of {total}")


def draw_question(
    c: canvas.Canvas,
    label: str,
    text: str,
    y: float,
    marks: str,
    extra: str | None = None,
) -> float:
    c.setFillColor(colors.HexColor("#101828"))
    c.setFont("Helvetica-Bold", 9.5)
    c.drawString(MARGIN, y, label)
    c.setFont("Helvetica-Bold", 8.2)
    c.setFillColor(ORANGE)
    c.drawRightString(PAGE_W - MARGIN, y, marks)
    y -= 14
    y, _ = draw_wrapped(c, text, MARGIN + 17, y, PAGE_W - 2 * MARGIN - 17, size=9.2, leading=12.5)
    if extra:
        y -= 2
        y, _ = draw_wrapped(c, extra, MARGIN + 17, y, PAGE_W - 2 * MARGIN - 17, font="Helvetica-Oblique", size=8.2, leading=11, color=MUTED)
    return y - 10


def draw_table(
    c: canvas.Canvas,
    x: float,
    top: float,
    widths: Sequence[float],
    rows: Sequence[Sequence[str]],
    row_height: float = 18,
    header: bool = True,
) -> float:
    total_width = sum(widths)
    y = top
    for row_idx, row in enumerate(rows):
        x_pos = x
        fill = colors.HexColor("#f2f4f7") if header and row_idx == 0 else colors.white
        for col_idx, cell in enumerate(row):
            cell_width = widths[col_idx]
            c.setFillColor(fill)
            c.setStrokeColor(colors.HexColor("#d0d5dd"))
            c.rect(x_pos, y - row_height, cell_width, row_height, fill=1, stroke=1)
            c.setFillColor(colors.HexColor("#101828"))
            c.setFont("Helvetica-Bold" if header and row_idx == 0 else "Helvetica", 8.2)
            c.drawCentredString(x_pos + cell_width / 2, y - row_height / 2 - 3, cell)
            x_pos += cell_width
        y -= row_height
    return y


def draw_graph(c: canvas.Canvas, x: float, y: float) -> None:
    nodes = {"s": (x, y), "a": (x + 78, y + 38), "b": (x + 78, y - 42), "c": (x + 156, y + 4), "d": (x + 235, y - 40)}
    edges = [("s", "a", "4"), ("s", "b", "2"), ("a", "c", "1"), ("b", "a", "1"), ("b", "c", "5"), ("c", "d", "3"), ("a", "d", "9")]
    c.setStrokeColor(colors.HexColor("#475467"))
    c.setLineWidth(1.1)
    for source, target, weight in edges:
        x1, y1 = nodes[source]
        x2, y2 = nodes[target]
        c.line(x1, y1, x2, y2)
        c.setFillColor(colors.HexColor("#f79009"))
        c.setFont("Helvetica-Bold", 8)
        c.drawCentredString((x1 + x2) / 2, (y1 + y2) / 2 + 4, weight)
    for label, (node_x, node_y) in nodes.items():
        c.setFillColor(colors.HexColor("#e0f2fe"))
        c.setStrokeColor(colors.HexColor("#0284c7"))
        c.circle(node_x, node_y, 12, fill=1, stroke=1)
        c.setFillColor(colors.HexColor("#0c4a6e"))
        c.setFont("Helvetica-Bold", 9)
        c.drawCentredString(node_x, node_y - 3, label)


def create_question_paper(path: Path) -> None:
    c = canvas.Canvas(str(path), pagesize=A4)

    # Page 1
    question_header(c, "Section 1 - Algorithms and Data", "Paper code: NSA-401")
    rounded_rect(c, MARGIN, PAGE_H - 146, PAGE_W - 2 * MARGIN, 65, colors.HexColor("#fff7ed"), colors.HexColor("#fed7aa"))
    c.setFillColor(colors.HexColor("#9a3412"))
    c.setFont("Helvetica-Bold", 9)
    c.drawString(MARGIN + 12, PAGE_H - 101, "Candidate instructions")
    instructions = (
        "Answer in the printed order only when convenient; every labelled sub-part is a separate question. "
        "Show intermediate reasoning for calculations. If a diagram is requested, label all edges or axes. "
        "There are 20 marks on this fixture; some questions deliberately contain multi-line data."
    )
    draw_wrapped(c, instructions, MARGIN + 12, PAGE_H - 116, PAGE_W - 2 * MARGIN - 24, size=8.4, leading=10.8, color=colors.HexColor("#7c2d12"))

    y = PAGE_H - 174
    c.setFillColor(colors.HexColor("#475467"))
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(MARGIN, y, "SECTION A - CORE REASONING")
    y -= 22
    y = draw_question(c, "1.", "Define amortized analysis. Use the potential method to analyse a dynamic table that doubles when full and shrinks when one quarter full.", y, "[3]")
    y = draw_question(c, "2 (a).", "Solve the recurrence T(n) = 2T(n/2) + n log n using a suitable form of the Master theorem. State any regularity assumption you use.", y, "[4]")
    y = draw_question(c, "2 (b).", "Give a tight asymptotic bound for the total work if the recurrence is evaluated for every power-of-two input from 1 through n.", y, "[2]")
    y = draw_question(c, "3.", "For the directed weighted graph below, run Dijkstra's algorithm from source s. Report the final distance vector in the order (s, a, b, c, d) and the predecessor of each non-source vertex.", y, "[4]")
    draw_graph(c, MARGIN + 45, y - 48)
    y -= 122
    y = draw_question(c, "4 (a).", "Explain the CAP theorem using a network partition between two replicas. Name one design choice that favours availability and one that favours consistency.", y, "[3]")
    y = draw_question(c, "4 (b).", "Compare serializable isolation with snapshot isolation. Give one write-skew example that snapshot isolation may permit.", y, "[3]")
    question_footer(c, 1, 3)
    c.showPage()

    # Page 2
    question_header(c, "Section 2 - Theory, ML and Security", "Paper code: NSA-401")
    y = PAGE_H - 92
    c.setFillColor(colors.HexColor("#475467"))
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(MARGIN, y, "SECTION B - STRUCTURED ANSWERS")
    y -= 22
    y = draw_question(c, "5.", "Given Orders(order_id, customer_id, amount, created_at) and Customers(customer_id, region), write a SQL query that returns the top two customers per region by total order amount in the last 30 days. Include ties.", y, "[4]", "Use a window function or explain an equivalent approach.")
    y = draw_question(c, "6 (a).", "Prove that L = { 0^n 1^n | n >= 0 } is not regular using the pumping lemma. State clearly where the contradiction occurs.", y, "[4]")
    y = draw_question(c, "6 (b) (i).", "Give a PDA transition sketch for the language in 6 (a). A compact labelled diagram is sufficient.", y, "[2]")
    y = draw_question(c, "6 (b) (ii).", "State whether the grammar S -> 0S1 | epsilon is ambiguous. Justify your answer in one or two sentences.", y, "[2]")
    y = draw_question(c, "7 (a).", "For one gradient step of logistic regression, write the vector update for weights w and bias b, using learning rate eta and binary cross-entropy loss.", y, "[3]")
    y = draw_question(c, "7 (b).", "A fraud detector changes its threshold from 0.50 to 0.20. Predict the direction of change for precision, recall and the false-positive rate, and explain why.", y, "[3]")
    y = draw_question(c, "8.", "Insert the keys 41, 38, 31, 12, 19, 8 into an initially empty red-black tree. Draw the final tree and mark the colour of every node.", y, "[4]")
    y = draw_question(c, "9.", "Describe a two-phase commit timeline in which the coordinator crashes after sending PREPARE but before sending COMMIT. Explain what each participant can safely do.", y, "[3]")
    y = draw_question(c, "10.", "Review this pseudocode: `if user.is_admin(): file.write(request.body); log(request.user);` Identify two security problems and give one mitigation for each.", y, "[3]")
    question_footer(c, 2, 3)
    c.showPage()

    # Page 3
    question_header(c, "Section 3 - Design and Quantitative Reasoning", "Paper code: NSA-401")
    y = PAGE_H - 92
    c.setFillColor(colors.HexColor("#475467"))
    c.setFont("Helvetica-Bold", 8.5)
    c.drawString(MARGIN, y, "SECTION C - APPLICATION")
    y -= 22
    y = draw_question(c, "11 (a).", "Design an idempotent POST /payments endpoint. List the minimum request fields, the idempotency-key behaviour, and the response returned when a key is replayed.", y, "[3]")
    y = draw_question(c, "11 (b).", "Give one reason a database transaction alone does not guarantee exactly-once payment effects when a downstream provider is involved.", y, "[2]")
    y = draw_question(c, "12.", "A classifier is evaluated on 2,000 cases. The confusion matrix is TP = 168, FP = 42, FN = 32, TN = 1,758. Calculate accuracy, precision, recall and F1 score to three decimal places.", y, "[5]")
    y -= 5
    rounded_rect(c, MARGIN, y - 158, PAGE_W - 2 * MARGIN, 142, colors.HexColor("#f8fafc"), colors.HexColor("#d0d5dd"))
    c.setFillColor(colors.HexColor("#344054"))
    c.setFont("Helvetica-Bold", 9)
    c.drawString(MARGIN + 12, y - 24, "Reference data block")
    draw_table(c, MARGIN + 12, y - 38, [94, 94, 94, 94], [["Metric", "Positive", "Negative", "Total"], ["Actual", "200", "1,800", "2,000"], ["Predicted", "210", "1,790", "2,000"]], row_height=22)
    c.setFillColor(MUTED)
    c.setFont("Helvetica-Oblique", 8)
    c.drawString(MARGIN + 12, y - 126, "Use the confusion-matrix values in the question, not the rounded reference block, for your calculations.")
    question_footer(c, 3, 3)
    c.save()


def draw_answer_page_background(c: canvas.Canvas, page_no: int, total: int) -> None:
    c.setFillColor(colors.HexColor("#fbfaf4"))
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setStrokeColor(LINE_BLUE)
    c.setLineWidth(0.45)
    first_line = PAGE_H - 74
    for line_y in range(int(first_line), int(18 * mm), -23):
        c.line(15 * mm, line_y, PAGE_W - 12 * mm, line_y)
    c.setStrokeColor(colors.HexColor("#e7a6a6"))
    c.setLineWidth(0.8)
    c.line(29 * mm, 17 * mm, 29 * mm, PAGE_H - 17 * mm)
    c.setFillColor(colors.HexColor("#697586"))
    c.setFont("Helvetica", 7.2)
    c.drawString(13 * mm, PAGE_H - 28, "NORTHSTAR INSTITUTE / ANSWER SHEET")
    c.drawRightString(PAGE_W - 14 * mm, PAGE_H - 28, f"Student: A. Mehta    Page {page_no}/{total}")
    c.setFillColor(colors.HexColor("#8c8c8c"))
    c.setFont("Helvetica-Oblique", 7)
    c.drawString(34 * mm, 11 * mm, "Blue ink scan fixture - labels are intentionally out of order")


def hand_block(
    c: canvas.Canvas,
    label: str,
    text: str,
    x: float,
    y: float,
    width: float,
    size: float = 13,
    leading: float = 20,
    angle: float = 0,
) -> tuple[float, tuple[float, float, float, float]]:
    lines = simpleSplit(text, HAND_FONT, size, width - 53)
    height = max(1, len(lines)) * leading + 9
    top = y + 8
    bottom = y - (len(lines) - 1) * leading - 7
    c.saveState()
    c.translate(x, y)
    c.rotate(angle)
    c.setFillColor(INK_BLUE)
    c.setFont(HAND_BOLD, size + 0.5)
    c.drawString(0, 0, label)
    c.setFont(HAND_FONT, size)
    for idx, line in enumerate(lines):
        c.drawString(53, -idx * leading, line)
    c.restoreState()
    return y - height - 7, (x - 6, bottom, x + width, top)


def hand_lines(c: canvas.Canvas, text: str, x: float, y: float, width: float, size: float = 13, leading: float = 20) -> tuple[float, tuple[float, float, float, float]]:
    lines = simpleSplit(text, HAND_FONT, size, width)
    top = y + 7
    for idx, line in enumerate(lines):
        c.saveState()
        c.setFillColor(INK_BLUE)
        c.setFont(HAND_FONT, size)
        c.drawString(x, y - idx * leading, line)
        c.restoreState()
    bottom = y - (len(lines) - 1) * leading - 7
    return y - max(1, len(lines)) * leading - 5, (x - 4, bottom, x + width, top)


def draw_tree_answer(c: canvas.Canvas, x: float, y: float) -> tuple[float, float, float, float]:
    c.setFillColor(INK_BLUE)
    c.setFont(HAND_FONT, 11.5)
    c.drawString(x, y + 62, "after rotations: black root 19")
    nodes = {
        "19": (x + 145, y + 28, colors.black),
        "12": (x + 82, y - 13, colors.black),
        "38": (x + 208, y - 13, colors.black),
        "8": (x + 42, y - 54, colors.HexColor("#d64545")),
        "31": (x + 165, y - 54, colors.HexColor("#d64545")),
        "41": (x + 249, y - 54, colors.black),
    }
    for parent, child in [("19", "12"), ("19", "38"), ("12", "8"), ("38", "31"), ("38", "41")]:
        x1, y1, _ = nodes[parent]
        x2, y2, _ = nodes[child]
        c.setStrokeColor(INK_BLUE)
        c.setLineWidth(1)
        c.line(x1, y1 - 7, x2, y2 + 7)
    for label, (node_x, node_y, fill) in nodes.items():
        c.setFillColor(fill)
        c.setStrokeColor(INK_BLUE)
        c.circle(node_x, node_y, 12, fill=1, stroke=1)
        c.setFillColor(colors.white if fill == colors.black else colors.HexColor("#571313"))
        c.setFont(HAND_BOLD, 10)
        c.drawCentredString(node_x, node_y - 3, label)
    return (x + 28, y - 70, x + 275, y + 73)


def draw_confusion_answer(c: canvas.Canvas, x: float, y: float) -> tuple[float, float, float, float]:
    c.setFillColor(INK_BLUE)
    c.setFont(HAND_FONT, 12)
    lines = [
        "accuracy = (168+1758)/2000 = 0.963",
        "precision = 168/(168+42) = 0.800",
        "recall = 168/(168+32) = 0.840",
        "F1 = 2*0.800*0.840/(0.800+0.840) = 0.819",
    ]
    for idx, line in enumerate(lines):
        c.drawString(x, y - idx * 20, line)
    return (x - 4, y - 3 * 20 - 8, x + 300, y + 8)


def create_answer_sheet(path: Path) -> dict[str, list[dict[str, object]]]:
    c = canvas.Canvas(str(path), pagesize=A4)
    all_regions: dict[str, list[dict[str, object]]] = {}

    # Page 1: starts with 7, then starts the answer that continues on page 2.
    draw_answer_page_background(c, 1, 4)
    y = PAGE_H - 92
    y, bbox = hand_block(c, "Q7(a).", "w update = w - eta * (p - y) x ; b update = b - eta * (p - y). The gradient is averaged over the batch.", 36 * mm, y, 150 * mm, angle=-0.4)
    all_regions.setdefault("7(a)", []).append({"page": 1, "bbox": bbox})
    y, bbox = hand_block(c, "Q7(b).", "lower threshold catches more fraud, so recall rises. Precision usually falls and false positives rise because more normal cases are flagged.", 36 * mm, y, 150 * mm, angle=0.5)
    all_regions.setdefault("7(b)", []).append({"page": 1, "bbox": bbox})
    y -= 7
    y, bbox = hand_block(c, "Q2(a).", "Let a = log n. The recursion tree has a level cost n(a - i), so the sum is n [a + (a-1) + ... + 1].", 36 * mm, y, 150 * mm, angle=-0.3)
    all_regions.setdefault("2(a)", []).append({"page": 1, "bbox": bbox})
    y, bbox = hand_block(c, "Q13.", "bonus: the algorithm should be tested on a disconnected graph too.", 36 * mm, y, 150 * mm, size=12.5, angle=0.8)
    all_regions.setdefault("UNMATCHED_Q13", []).append({"page": 1, "bbox": bbox})
    c.showPage()

    # Page 2: continuation, then answers to 4(b) and 3.
    draw_answer_page_background(c, 2, 4)
    y = PAGE_H - 92
    y, bbox = hand_block(c, "Q2(a).", "continued: this is n log squared n, so T(n) = Theta(n log squared n), assuming the leaf work is linear or smaller.", 36 * mm, y, 150 * mm, angle=0.3)
    all_regions.setdefault("2(a)", []).append({"page": 2, "bbox": bbox})
    y -= 8
    y, bbox = hand_block(c, "Q4(b).", "serializable behaves like one-at-a-time execution. Snapshot isolation reads a stable version but two transactions can both read a free seat and then write different rows: write skew.", 36 * mm, y, 150 * mm, angle=-0.5)
    all_regions.setdefault("4(b)", []).append({"page": 2, "bbox": bbox})
    y -= 5
    y, bbox = hand_block(c, "Q3.", "distances from s are (0, 3, 2, 4, 7). predecessors: a = b, b = s, c = a, d = c.", 36 * mm, y, 150 * mm, angle=0.4)
    all_regions.setdefault("3", []).append({"page": 2, "bbox": bbox})
    c.showPage()

    # Page 3: more labels, including nested sub-parts.
    draw_answer_page_background(c, 3, 4)
    y = PAGE_H - 92
    y, bbox = hand_block(c, "Q1.", "Potential can be stored as twice the number of empty slots. A push that does not resize has amortized cost one; the expensive resize is paid by the potential saved by earlier pushes. Shrinking at one quarter avoids oscillation.", 36 * mm, y, 150 * mm, angle=-0.35)
    all_regions.setdefault("1", []).append({"page": 3, "bbox": bbox})
    y -= 4
    y, bbox = hand_block(c, "Q6(a).", "Assume a pumping length p and choose 0^p 1^p. Any split xyz with |xy| <= p has y only zeros. Pumping y changes the zero count but not the one count, so the result is not in L.", 36 * mm, y, 150 * mm, angle=0.4)
    all_regions.setdefault("6(a)", []).append({"page": 3, "bbox": bbox})
    y, bbox = hand_block(c, "Q6(b)(i).", "push each 0 onto the stack; for each 1 pop one 0; accept when the input ends and the stack has only the bottom marker.", 36 * mm, y, 150 * mm, size=12.5, angle=-0.2)
    all_regions.setdefault("6(b)(i)", []).append({"page": 3, "bbox": bbox})
    y, bbox = hand_block(c, "Q11(a).", "POST /payments takes amount, currency and an Idempotency-Key. Store the first result by key; a replay returns the same status and body without charging again.", 36 * mm, y, 150 * mm, angle=0.5)
    all_regions.setdefault("11(a)", []).append({"page": 3, "bbox": bbox})
    y, bbox = hand_block(c, "Q4(a).", "CAP says a partition forces a choice between consistency and availability. A quorum can favour consistency; accepting writes on either side favours availability.", 36 * mm, y, 150 * mm, angle=-0.3)
    all_regions.setdefault("4(a)", []).append({"page": 3, "bbox": bbox})
    c.showPage()

    # Page 4: diagram, calculation, SQL, security, and a visible blank marker.
    draw_answer_page_background(c, 4, 4)
    y = PAGE_H - 92
    c.setFillColor(INK_BLUE)
    c.setFont(HAND_BOLD, 13)
    c.drawString(36 * mm, y, "Q8.")
    bbox = draw_tree_answer(c, 36 * mm + 46, y - 88)
    all_regions.setdefault("8", []).append({"page": 4, "bbox": bbox})
    y = y - 178
    c.setFillColor(INK_BLUE)
    c.setFont(HAND_BOLD, 13)
    c.drawString(36 * mm, y, "Q12.")
    bbox = draw_confusion_answer(c, 36 * mm + 46, y - 2)
    all_regions.setdefault("12", []).append({"page": 4, "bbox": bbox})
    y -= 104
    y, bbox = hand_block(c, "Q5.", "WITH totals AS (SELECT customer_id, region, SUM(amount) total FROM Orders JOIN Customers USING(customer_id) WHERE created_at >= CURRENT_DATE - 30 GROUP BY customer_id, region) SELECT * FROM (SELECT totals.*, DENSE_RANK() OVER (PARTITION BY region ORDER BY total DESC) r FROM totals) z WHERE r <= 2;", 36 * mm, y, 150 * mm, size=11.5, leading=18, angle=-0.4)
    all_regions.setdefault("5", []).append({"page": 4, "bbox": bbox})
    y, bbox = hand_block(c, "Q10.", "problem one: admin is not enough validation; allow-list the path and reject traversal. problem two: request.body is written without a size/type check; validate and limit it before storage.", 36 * mm, y, 150 * mm, size=11.5, leading=18, angle=0.5)
    all_regions.setdefault("10", []).append({"page": 4, "bbox": bbox})
    c.setFillColor(colors.HexColor("#a33a3a"))
    c.setFont(HAND_BOLD, 12.5)
    unanswered_y = max(52 * mm, y)
    c.drawString(36 * mm, unanswered_y, "Q9. skipped - no answer")
    c.setFont("Helvetica-Oblique", 8)
    c.setFillColor(colors.HexColor("#8c8c8c"))
    c.drawString(36 * mm + 78, unanswered_y - 16, "(intentional unanswered case)")
    c.showPage()
    c.save()
    return all_regions


def render_pages(pdf_path: Path, prefix: str, scan_style: bool = False) -> list[Path]:
    doc = fitz.open(str(pdf_path))
    outputs: list[Path] = []
    for index, page in enumerate(doc, start=1):
        output = ROOT / f"{prefix}-page-{index}.png"
        pix = page.get_pixmap(matrix=fitz.Matrix(2.05, 2.05), alpha=False)
        pix.save(str(output))
        if scan_style:
            image = Image.open(output).convert("RGB")
            image = ImageEnhance.Contrast(image).enhance(0.96)
            image = ImageEnhance.Color(image).enhance(0.92)
            image.save(output, optimize=True)
        outputs.append(output)
    return outputs


def normalized_bbox(bbox: tuple[float, float, float, float]) -> dict[str, float]:
    left, bottom, right, top = bbox
    return {
        "x": round(max(0, left) / PAGE_W, 4),
        "y": round(max(0, PAGE_H - top) / PAGE_H, 4),
        "width": round(min(PAGE_W, right) / PAGE_W - max(0, left) / PAGE_W, 4),
        "height": round(min(PAGE_H, PAGE_H - bottom) / PAGE_H - max(0, PAGE_H - top) / PAGE_H, 4),
    }


def write_mapping(regions: dict[str, list[dict[str, object]]], path: Path) -> None:
    ordered = [
        ("1", "1"), ("2(a)", "2 (a)"), ("2(b)", "2 (b)"), ("3", "3"),
        ("4(a)", "4 (a)"), ("4(b)", "4 (b)"), ("5", "5"), ("6(a)", "6 (a)"),
        ("6(b)(i)", "6 (b) (i)"), ("6(b)(ii)", "6 (b) (ii)"), ("7(a)", "7 (a)"),
        ("7(b)", "7 (b)"), ("8", "8"), ("9", "9"), ("10", "10"),
        ("11(a)", "11 (a)"), ("11(b)", "11 (b)"), ("12", "12"),
    ]
    answers = []
    for question_id, printed_label in ordered:
        raw_regions = regions.get(question_id, [])
        answers.append({
            "questionId": question_id,
            "printedLabel": printed_label,
            "status": "answered" if raw_regions else "unanswered",
            "regions": [
                {"page": item["page"], "bbox": normalized_bbox(item["bbox"])}
                for item in raw_regions
            ],
        })
    unmatched = [
        {
            "label": "Q13",
            "status": "unmatched",
            "regions": [
                {"page": item["page"], "bbox": normalized_bbox(item["bbox"])}
                for item in regions["UNMATCHED_Q13"]
            ],
        }
    ]
    payload = {
        "fixture": "northstar-advanced-systems-hard-v1",
        "questionPaper": "tough-question-paper.pdf",
        "answerSheet": "tough-answer-sheet.pdf",
        "expected": {
            "questionCount": len(ordered),
            "answeredCount": sum(1 for question_id, _ in ordered if regions.get(question_id)),
            "unansweredQuestionIds": [question_id for question_id, _ in ordered if not regions.get(question_id)],
            "outOfOrder": True,
            "multiPageAnswers": ["2(a)"],
            "subPartsMustRemainSeparate": ["2(a)", "2(b)", "4(a)", "4(b)", "6(a)", "6(b)(i)", "6(b)(ii)", "7(a)", "7(b)", "11(a)", "11(b)"],
        },
        "questions": answers,
        "unmatchedAnswers": unmatched,
    }
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def main() -> None:
    question_pdf = ROOT / "tough-question-paper.pdf"
    answer_pdf = ROOT / "tough-answer-sheet.pdf"
    create_question_paper(question_pdf)
    answer_regions = create_answer_sheet(answer_pdf)
    render_pages(question_pdf, "tough-question-paper")
    render_pages(answer_pdf, "tough-answer-sheet", scan_style=True)
    write_mapping(answer_regions, ROOT / "expected-answer-mapping.json")
    print(f"Created {question_pdf}")
    print(f"Created {answer_pdf}")
    print(f"Created {ROOT / 'expected-answer-mapping.json'}")


if __name__ == "__main__":
    main()
