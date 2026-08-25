import type {
  AnalysisResult,
  AnswerRegion,
  AssessmentQuestion,
  UnmatchedAnswer,
} from "./types";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null ? (value as UnknownRecord) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeRegion(value: unknown): AnswerRegion | null {
  const item = asRecord(value);
  const bbox = Array.isArray(item.bbox) ? item.bbox : null;
  const page = Math.max(1, Math.round(asNumber(item.page ?? item.pageNumber, 1)));
  const x = bbox ? asNumber(bbox[0]) : asNumber(item.x);
  const y = bbox ? asNumber(bbox[1]) : asNumber(item.y);
  const width = bbox ? asNumber(bbox[2]) : asNumber(item.width, 20);
  const height = bbox ? asNumber(bbox[3]) : asNumber(item.height, 10);

  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) {
    return null;
  }

  return {
    page,
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
    width: Math.max(1, Math.min(100, width)),
    height: Math.max(1, Math.min(100, height)),
    confidence: Math.max(0, Math.min(1, asNumber(item.confidence, 0.8))),
  };
}

function normalizeQuestion(value: unknown, index: number): AssessmentQuestion {
  const item = asRecord(value);
  const maxMarks = Math.max(1, Math.round(asNumber(item.maxMarks ?? item.marksAvailable, 2)));
  const marks = Math.max(0, Math.min(maxMarks, Math.round(asNumber(item.marks ?? item.score, 0))));
  const rawRegions = Array.isArray(item.regions)
    ? item.regions
    : Array.isArray(item.answerRegions)
      ? item.answerRegions
      : [];
  const regions = rawRegions.map(normalizeRegion).filter((region): region is AnswerRegion => Boolean(region));
  const status = marks === 0 ? "unanswered" : marks === maxMarks ? "correct" : "partial";

  return {
    id: asString(item.id, `q-${index + 1}`),
    number: asString(item.number ?? item.label, `${index + 1}`),
    text: asString(item.text ?? item.question, "Question text was not detected."),
    maxMarks,
    marks,
    status,
    answerText: asString(item.answerText ?? item.answer, marks === 0 ? "No answer detected." : "Answer detected."),
    feedback: asString(item.feedback ?? item.aiFeedback) || undefined,
    regions,
  };
}

function normalizeUnmatched(value: unknown, index: number): UnmatchedAnswer {
  const item = asRecord(value);
  const bbox = Array.isArray(item.bbox) ? item.bbox : [];
  return {
    id: asString(item.id, `unmatched-${index + 1}`),
    label: asString(item.label, "Unmatched answer"),
    page: Math.max(1, Math.round(asNumber(item.page ?? item.pageNumber, 1))),
    text: asString(item.text ?? item.answer, "Answer did not match a printed question."),
    x: Math.max(0, Math.min(100, asNumber(bbox[0] ?? item.x, 70))),
    y: Math.max(0, Math.min(100, asNumber(bbox[1] ?? item.y, 70))),
    width: Math.max(1, Math.min(100, asNumber(bbox[2] ?? item.width, 20))),
    height: Math.max(1, Math.min(100, asNumber(bbox[3] ?? item.height, 10))),
  };
}

export function extractJsonObject(raw: string): unknown {
  const withoutFence = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("The model response did not contain JSON.");
  }
  return JSON.parse(withoutFence.slice(start, end + 1));
}

export function normalizeAnalysis(value: unknown, mode: AnalysisResult["mode"], providerLabel: string): AnalysisResult {
  const result = asRecord(value);
  const rawQuestions = Array.isArray(result.questions)
    ? result.questions
    : Array.isArray(result.extractedQuestions)
      ? result.extractedQuestions
      : [];
  const questions = rawQuestions.map(normalizeQuestion);
  const rawUnmatched = Array.isArray(result.unmatchedAnswers) ? result.unmatchedAnswers : [];
  const unmatchedAnswers = rawUnmatched.map(normalizeUnmatched);
  const pages = Math.max(1, Math.round(asNumber(result.pages ?? result.pageCount, 1)));
  const matchedAnswers = Math.max(0, Math.round(asNumber(result.matchedAnswers, questions.filter((question) => question.regions.length > 0).length)));
  const confidence = Math.round(Math.max(0, Math.min(100, asNumber(result.confidence, 82))));

  return {
    mode,
    providerLabel,
    questions,
    unmatchedAnswers,
    pages,
    matchedAnswers,
    confidence,
    note: asString(result.note) || undefined,
  };
}
