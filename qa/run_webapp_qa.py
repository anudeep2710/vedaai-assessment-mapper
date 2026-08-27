"""Browser QA for the assessment mapper.

Run this through webapp-testing's with_server.py so the server lifecycle is
managed outside the test script.
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from playwright.sync_api import Page, sync_playwright


def require(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def qa_analysis() -> dict[str, object]:
    questions: list[dict[str, object]] = []
    for number in range(1, 14):
        answered = number != 4
        max_marks = 2 if number <= 5 else 5
        questions.append({
            "id": f"q-{number}",
            "number": str(number),
            "text": f"QA fixture question {number}: explain the evidence and show your working.",
            "maxMarks": max_marks,
            "marks": max_marks if answered else 0,
            "answerText": "Answer detected in the fixture." if answered else "No answer detected.",
            "feedback": "QA feedback for the selected answer.",
            "regions": [{
                "page": ((number - 1) // 4) + 1,
                "bbox": [6, 8 + ((number - 1) % 4) * 18, 88, 12],
                "confidence": 0.94,
            }] if answered else [],
        })
    return {
        "mode": "gemini",
        "providerLabel": "QA fixture",
        "pages": 4,
        "matchedAnswers": 12,
        "confidence": 96,
        "questions": questions,
        "unmatchedAnswers": [{
            "id": "unmatched-1",
            "label": "Unmatched note",
            "page": 2,
            "text": "Fixture handwriting that is not tied to a question.",
            "bbox": [63, 78, 29, 9],
        }],
    }


def run_case(base_url: str, case_dir: Path, output_dir: Path, case_index: int) -> dict[str, object]:
    output_dir.mkdir(parents=True, exist_ok=True)
    errors: list[str] = []
    warnings: list[str] = []
    failures: list[str] = []
    checks: dict[str, bool] = {}
    label = case_dir.name

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        page = context.new_page()
        page.on("console", lambda message: (errors if message.type == "error" else warnings if message.type == "warning" else []).append(message.text))
        page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))
        page.on("requestfailed", lambda request: failures.append(f"{request.method} {request.url}: {request.failure}"))

        try:
            page.route("**/api/analyze", lambda route: route.fulfill(status=200, content_type="application/json", body=json.dumps(qa_analysis())))
            page.goto(base_url, wait_until="networkidle")
            checks["page_loaded"] = page.locator("#upload-heading").is_visible()
            require(checks["page_loaded"], "Upload heading did not render")
            font_family = page.locator("body").evaluate("element => getComputedStyle(element).fontFamily")
            require("Bricolage" in font_family, f"Bricolage Grotesque is not active: {font_family}")
            require(page.locator('.brand-mark img[src*="vedaai.svg"]').count() >= 1, "Supplied VedaAI logo did not render")
            require(page.locator(".nav-icon").count() == 5, "Supplied sidebar icon set did not render")
            checks["reference_assets_and_font"] = True
            page.screenshot(path=str(output_dir / f"{case_index:02d}-{label}-upload-empty.png"), full_page=True)

            start_button = page.get_by_role("button", name=re.compile(r"^Start Mapping"))
            require(start_button.is_disabled(), "Start Mapping should be disabled before both files are selected")
            checks["empty_state_guard"] = True

            file_inputs = page.locator('input[type="file"]')
            require(file_inputs.count() == 2, f"Expected two file inputs, found {file_inputs.count()}")
            file_inputs.nth(0).set_input_files(str(case_dir / "question-paper.pdf"))
            file_inputs.nth(1).set_input_files(str(case_dir / "answer-sheet.pdf"))
            require(start_button.is_enabled(), "Start Mapping did not enable after both files were selected")
            require(page.get_by_text("question-paper.pdf", exact=True).is_visible(), "Question file chip is missing")
            require(page.get_by_text("answer-sheet.pdf", exact=True).is_visible(), "Answer file chip is missing")
            checks["file_upload_state"] = True
            page.screenshot(path=str(output_dir / f"{case_index:02d}-{label}-upload-filled.png"), full_page=True)

            start_button.click()
            processing_visible = page.get_by_text("Extracting...", exact=True).is_visible(timeout=3000)
            checks["processing_state"] = processing_visible
            page.screenshot(path=str(output_dir / f"{case_index:02d}-{label}-processing.png"), full_page=True)

            page.get_by_role("heading", name="Extracted Questions").wait_for(timeout=20000)
            require(page.get_by_role("heading", name="Answer Sheet").is_visible(), "Answer Sheet panel is missing")
            require(page.locator(".question-card").count() >= 10, "Review did not render the expected question list")
            require(page.locator(".answer-region").count() >= 1, "No answer regions rendered")
            checks["results_workspace"] = True

            first_card = page.locator(".question-card").first
            first_card.click()
            require("Showing answer" in page.locator(".answer-focus-line").inner_text(), "Selecting a question did not update the focus line")
            checks["question_selection"] = True

            expand_button = page.get_by_role("button", name="Expand All")
            expand_button.click()
            require(page.locator(".feedback-block").count() >= 1, "Expand All did not reveal feedback")
            checks["feedback_expand"] = True

            page.get_by_role("button", name="Zoom in").click()
            require("110%" in page.locator(".zoom-controls").inner_text(), "Zoom in did not update the toolbar")
            page.get_by_role("button", name="Next page").click()
            require("Page 2 of" in page.locator(".page-label").inner_text(), "Next page did not change the answer page")
            page.get_by_role("button", name="Previous page").click()
            checks["viewer_controls"] = True

            page.set_viewport_size({"width": 390, "height": 844})
            page.wait_for_timeout(250)
            horizontal_overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
            require(horizontal_overflow <= 2, f"Mobile layout has {horizontal_overflow}px horizontal overflow")
            checks["mobile_layout"] = True
            page.screenshot(path=str(output_dir / f"{case_index:02d}-{label}-results-mobile.png"), full_page=True)

            # Return to the desktop shell before resetting. The compact responsive
            # layout intentionally hides secondary status controls to match the
            # product reference, so the reset action is validated in its desktop
            # context instead of relying on a clipped mobile control.
            page.set_viewport_size({"width": 1440, "height": 1000})
            page.get_by_role("button", name="Start another review").click()
            require(page.locator("#upload-heading").is_visible(), "Reset did not return to the upload state")
            checks["reset_flow"] = True

            require(page.get_by_role("button", name="Preview a sample review").count() == 0, "Sample review action is still exposed")
            checks["sample_review_removed"] = True
            page.screenshot(path=str(output_dir / f"{case_index:02d}-{label}-upload-reset.png"), full_page=True)
        except Exception as error:  # Keep the report useful even if one check fails.
            errors.append(f"{type(error).__name__}: {error}")
        finally:
            context.close()
            browser.close()

    return {
        "case": label,
        "baseUrl": base_url,
        "checks": checks,
        "passedChecks": sum(1 for value in checks.values() if value),
        "failedChecks": [key for key, value in checks.items() if not value],
        "consoleErrors": errors,
        "consoleWarnings": warnings,
        "requestFailures": failures,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--case-dir", type=Path, action="append", required=True)
    args = parser.parse_args()

    results = [run_case(args.base_url, case_dir, args.output_dir, index) for index, case_dir in enumerate(args.case_dir, start=1)]
    report_path = args.output_dir / "qa-report.json"
    report_path.write_text(json.dumps(results, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(results, indent=2))
    print(f"REPORT={report_path}")


if __name__ == "__main__":
    main()
