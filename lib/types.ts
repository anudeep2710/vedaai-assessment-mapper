export type ExtractionMode = "gemini" | "groq";

export type AnswerStatus = "correct" | "partial" | "incorrect" | "unanswered";

export type AnswerRegion = {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
};

export type AssessmentQuestion = {
  id: string;
  number: string;
  text: string;
  maxMarks: number;
  marks: number;
  status: AnswerStatus;
  answerText: string;
  feedback?: string;
  regions: AnswerRegion[];
};

export type UnmatchedAnswer = {
  id: string;
  label: string;
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AnalysisResult = {
  mode: ExtractionMode;
  providerLabel: string;
  questions: AssessmentQuestion[];
  unmatchedAnswers: UnmatchedAnswer[];
  pages: number;
  matchedAnswers: number;
  confidence: number;
  note?: string;
};

export type UploadedFiles = {
  questionPaper: File | null;
  answerSheet: File | null;
};
