"""Benchmark deployed extraction against the hard-variant ground truth manifests."""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any


def canonical_label(value: object) -> str:
    compact = re.sub(r"\s+", "", str(value)).lower()
    compact = re.sub(r"^q(?=\d)", "", compact)
    return re.sub(r"[.:]+$", "", compact)


def percent_box(raw_box: dict[str, Any]) -> tuple[float, float, float, float]:
    values = tuple(float(raw_box.get(key, 0)) for key in ("x", "y", "width", "height"))
    if values and max(values) <= 1:
        return tuple(value * 100 for value in values)
    return values


def region_box(region: dict[str, Any]) -> tuple[float, float, float, float]:
    bbox = region.get("bbox")
    if isinstance(bbox, list) and len(bbox) >= 4:
        return tuple(float(value) for value in bbox[:4])
    return tuple(float(region.get(key, 0)) for key in ("x", "y", "width", "height"))


def intersection_over_union(
    first: tuple[float, float, float, float],
    second: tuple[float, float, float, float],
) -> float:
    first_x2, first_y2 = first[0] + first[2], first[1] + first[3]
    second_x2, second_y2 = second[0] + second[2], second[1] + second[3]
    intersection_width = max(0.0, min(first_x2, second_x2) - max(first[0], second[0]))
    intersection_height = max(0.0, min(first_y2, second_y2) - max(first[1], second[1]))
    intersection = intersection_width * intersection_height
    union = first[2] * first[3] + second[2] * second[3] - intersection
    return intersection / union if union > 0 else 0.0


def multipart_body(question_path: Path, answer_path: Path) -> tuple[bytes, str]:
    boundary = f"----vedaai-qa-{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for field_name, path in (("questionPaper", question_path), ("answerSheet", answer_path)):
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{field_name}"; filename="{path.name}"\r\n'.encode(),
            b"Content-Type: application/pdf\r\n\r\n",
            path.read_bytes(),
            b"\r\n",
        ])
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), boundary


def request_analysis(base_url: str, case_dir: Path, timeout: float) -> tuple[int, dict[str, Any], float]:
    body, boundary = multipart_body(case_dir / "question-paper.pdf", case_dir / "answer-sheet.pdf")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/api/analyze",
        data=body,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    started_at = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
            return response.status, payload, time.perf_counter() - started_at
    except urllib.error.HTTPError as error:
        raw_payload = error.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw_payload)
        except json.JSONDecodeError:
            payload = {"error": raw_payload or str(error)}
        return error.code, payload, time.perf_counter() - started_at


def compare_result(expected_manifest: dict[str, Any], actual: dict[str, Any]) -> dict[str, Any]:
    expected_questions = expected_manifest.get("questions", [])
    actual_questions = actual.get("questions", []) if isinstance(actual.get("questions"), list) else []
    expected_labels = [canonical_label(question.get("printedLabel", question.get("questionId", ""))) for question in expected_questions]
    actual_labels = [canonical_label(question.get("number", "")) for question in actual_questions]
    actual_by_label = {canonical_label(question.get("number", "")): question for question in actual_questions}

    status_matches = 0
    status_total = len(expected_questions)
    page_matches = 0
    page_total = 0
    region_count_matches = 0
    empty_region_matches = 0
    empty_region_total = 0
    multi_page_matches = 0
    multi_page_total = 0
    region_ious: list[float] = []
    question_details: list[dict[str, Any]] = []

    for expected_question in expected_questions:
        label = canonical_label(expected_question.get("printedLabel", expected_question.get("questionId", "")))
        expected_status = expected_question.get("status", "answered")
        expected_regions = expected_question.get("regions", [])
        expected_pages = [int(region.get("page", 1)) for region in expected_regions]
        actual_question = actual_by_label.get(label)
        actual_regions = actual_question.get("regions", []) if actual_question else []
        actual_pages = [int(region.get("page", 1)) for region in actual_regions]
        actual_status = actual_question.get("status") if actual_question else "missing"
        actual_attempt_status = (
            "unanswered"
            if actual_status == "unanswered"
            else "answered"
            if actual_status in {"correct", "partial", "incorrect"}
            else "missing"
        )

        status_match = actual_attempt_status == expected_status
        status_matches += int(status_match)
        region_count_match = len(actual_regions) == len(expected_regions)
        region_count_matches += int(region_count_match)

        page_match: bool | None = None
        if expected_status == "answered":
            page_total += 1
            page_match = actual_pages == expected_pages
            page_matches += int(page_match)

        empty_region_match: bool | None = None
        if expected_status == "unanswered":
            empty_region_total += 1
            empty_region_match = len(actual_regions) == 0
            empty_region_matches += int(empty_region_match)

        multi_page_match: bool | None = None
        if len(expected_pages) > 1:
            multi_page_total += 1
            multi_page_match = actual_pages == expected_pages
            multi_page_matches += int(multi_page_match)

        used_actual_regions: set[int] = set()
        question_ious: list[float] = []
        for expected_region in expected_regions:
            expected_page = int(expected_region.get("page", 1))
            expected_box = percent_box(expected_region.get("bbox", {}))
            candidates = [
                (index, intersection_over_union(expected_box, region_box(actual_region)))
                for index, actual_region in enumerate(actual_regions)
                if index not in used_actual_regions and int(actual_region.get("page", 1)) == expected_page
            ]
            if candidates:
                best_index, best_iou = max(candidates, key=lambda item: item[1])
                used_actual_regions.add(best_index)
            else:
                best_iou = 0.0
            question_ious.append(best_iou)
            region_ious.append(best_iou)

        question_details.append({
            "label": expected_question.get("printedLabel", expected_question.get("questionId")),
            "expectedStatus": expected_status,
            "actualStatus": actual_status,
            "actualAttemptStatus": actual_attempt_status,
            "statusMatch": status_match,
            "expectedPages": expected_pages,
            "actualPages": actual_pages,
            "pageMatch": page_match,
            "regionCountMatch": region_count_match,
            "unansweredHasNoRegion": empty_region_match,
            "multiPageMatch": multi_page_match,
            "meanRegionIoU": round(sum(question_ious) / len(question_ious), 4) if question_ious else None,
        })

    expected_unmatched = expected_manifest.get("unmatchedAnswers", [])
    actual_unmatched = actual.get("unmatchedAnswers", []) if isinstance(actual.get("unmatchedAnswers"), list) else []
    expected_unmatched_pages = sorted(
        int(region.get("page", 1))
        for answer in expected_unmatched
        for region in answer.get("regions", [])
    )
    actual_unmatched_pages = sorted(int(answer.get("page", 1)) for answer in actual_unmatched)
    unmatched_count_match = len(actual_unmatched) == len(expected_unmatched)
    unmatched_pages_match = actual_unmatched_pages == expected_unmatched_pages

    def accuracy(matches: int, total: int) -> float:
        return round(matches / total, 4) if total else 1.0

    order_exact = actual_labels == expected_labels
    status_accuracy = accuracy(status_matches, status_total)
    page_accuracy = accuracy(page_matches, page_total)
    region_count_accuracy = accuracy(region_count_matches, status_total)
    unanswered_empty_accuracy = accuracy(empty_region_matches, empty_region_total)
    multi_page_accuracy = accuracy(multi_page_matches, multi_page_total)
    mean_region_iou = round(sum(region_ious) / len(region_ious), 4) if region_ious else 0.0
    core_pass = all([
        order_exact,
        status_accuracy == 1,
        page_accuracy == 1,
        region_count_accuracy == 1,
        unanswered_empty_accuracy == 1,
        multi_page_accuracy == 1,
        unmatched_count_match,
        unmatched_pages_match,
    ])

    return {
        "expectedQuestionCount": len(expected_questions),
        "actualQuestionCount": len(actual_questions),
        "questionOrderExact": order_exact,
        "statusAccuracy": status_accuracy,
        "pageMappingAccuracy": page_accuracy,
        "regionCountAccuracy": region_count_accuracy,
        "unansweredEmptyRegionAccuracy": unanswered_empty_accuracy,
        "multiPageAccuracy": multi_page_accuracy,
        "unmatchedCountMatch": unmatched_count_match,
        "unmatchedPagesMatch": unmatched_pages_match,
        "meanRegionIoU": mean_region_iou,
        "corePass": core_pass,
        "questionDetails": question_details,
    }


def markdown_report(report: dict[str, Any]) -> str:
    lines = [
        "# VedaAI real extraction benchmark",
        "",
        f"Live endpoint: {report['baseUrl']}",
        "",
        "| Variant | HTTP | Time | Questions | Order | Status | Pages | Regions | Blank regions | Multi-page | Unmatched | Mean bbox IoU | Core |",
        "|---|---:|---:|---:|:---:|---:|---:|---:|---:|---:|:---:|---:|:---:|",
    ]
    for result in report["results"]:
        metrics = result.get("metrics") or {}
        questions = f"{metrics.get('actualQuestionCount', 0)}/{metrics.get('expectedQuestionCount', 0)}"
        unmatched = "pass" if metrics.get("unmatchedCountMatch") and metrics.get("unmatchedPagesMatch") else "fail"
        lines.append(
            f"| {result['variant']} | {result['httpStatus']} | {result['elapsedSeconds']:.1f}s | {questions} | "
            f"{'pass' if metrics.get('questionOrderExact') else 'fail'} | {metrics.get('statusAccuracy', 0):.1%} | "
            f"{metrics.get('pageMappingAccuracy', 0):.1%} | {metrics.get('regionCountAccuracy', 0):.1%} | "
            f"{metrics.get('unansweredEmptyRegionAccuracy', 0):.1%} | {metrics.get('multiPageAccuracy', 0):.1%} | "
            f"{unmatched} | {metrics.get('meanRegionIoU', 0):.1%} | {'PASS' if metrics.get('corePass') else 'FAIL'} |"
        )
    summary = report["summary"]
    lines.extend([
        "",
        "## Summary",
        "",
        f"- Successful API responses: {summary['successfulResponses']}/{summary['variantCount']}",
        f"- Core passes: {summary['corePasses']}/{summary['variantCount']}",
        f"- Mean response time: {summary['meanResponseSeconds']:.1f}s",
        f"- Mean bounding-box IoU against the supplied manifests: {summary['meanRegionIoU']:.1%}",
        "",
        "Core pass requires exact question order, correct answered/unanswered status, exact answer-page and region counts, "
        "empty regions for unanswered questions, multi-page mapping, and unmatched-answer count/page. Bounding-box IoU is reported separately because "
        "the supplied manifests and rendered handwriting should also be visually audited.",
        "",
    ])
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--suite-dir", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--timeout", type=float, default=75)
    parser.add_argument("--case-id", action="append", help="Run only the named variant directory; may be repeated")
    args = parser.parse_args()

    args.output_dir.mkdir(parents=True, exist_ok=True)
    case_dirs = sorted(path for path in args.suite_dir.iterdir() if path.is_dir() and (path / "expected-answer-mapping.json").exists())
    if args.case_id:
        requested_cases = set(args.case_id)
        case_dirs = [path for path in case_dirs if path.name in requested_cases]
    results: list[dict[str, Any]] = []

    for case_dir in case_dirs:
        print(f"Running {case_dir.name}...", flush=True)
        status, payload, elapsed = request_analysis(args.base_url, case_dir, args.timeout)
        case_output_dir = args.output_dir / case_dir.name
        case_output_dir.mkdir(parents=True, exist_ok=True)
        (case_output_dir / "response.json").write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

        metrics = None
        if status == 200 and isinstance(payload.get("questions"), list):
            expected = json.loads((case_dir / "expected-answer-mapping.json").read_text(encoding="utf-8"))
            metrics = compare_result(expected, payload)
        results.append({
            "variant": case_dir.name,
            "httpStatus": status,
            "elapsedSeconds": round(elapsed, 3),
            "provider": payload.get("providerLabel"),
            "confidence": payload.get("confidence"),
            "error": payload.get("error"),
            "metrics": metrics,
        })

    successful = [result for result in results if result["httpStatus"] == 200 and result["metrics"]]
    all_ious = [result["metrics"]["meanRegionIoU"] for result in successful]
    summary = {
        "variantCount": len(results),
        "successfulResponses": len(successful),
        "corePasses": sum(1 for result in successful if result["metrics"]["corePass"]),
        "meanResponseSeconds": round(sum(result["elapsedSeconds"] for result in results) / len(results), 3) if results else 0,
        "meanRegionIoU": round(sum(all_ious) / len(all_ious), 4) if all_ious else 0,
    }
    report = {"baseUrl": args.base_url, "summary": summary, "results": results}
    json_path = args.output_dir / "benchmark-report.json"
    markdown_path = args.output_dir / "benchmark-report.md"
    json_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    markdown_path.write_text(markdown_report(report), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    print(f"REPORT_JSON={json_path}")
    print(f"REPORT_MARKDOWN={markdown_path}")


if __name__ == "__main__":
    main()
