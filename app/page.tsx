"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ProcessingView } from "@/components/ProcessingView";
import { ResultsView } from "@/components/ResultsView";
import { UploadView } from "@/components/UploadView";
import { buildGroqContactSheets } from "@/lib/groqFallback";
import type { AnalysisResult, UploadedFiles } from "@/lib/types";

type ViewState = "upload" | "processing" | "results";

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

type AnalyzeResponse = {
  response: Response;
  payload: Partial<AnalysisResult> & { error?: string };
};

async function postAnalysis(formData: FormData): Promise<AnalyzeResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 110_000);

  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    const payload = (await response.json()) as Partial<AnalysisResult> & { error?: string };
    return { response, payload };
  } finally {
    window.clearTimeout(timeout);
  }
}

export default function HomePage() {
  const [view, setView] = useState<ViewState>("upload");
  const [files, setFiles] = useState<UploadedFiles>({ questionPaper: null, answerSheet: null });
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [progress, setProgress] = useState(12);
  const [selectedId, setSelectedId] = useState("q-2");
  const [answerPage, setAnswerPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const openResults = (nextAnalysis: AnalysisResult) => {
    setAnalysis(nextAnalysis);
    const initialQuestion = nextAnalysis.questions.find((question) => question.id === selectedId) || nextAnalysis.questions[0];
    setSelectedId(initialQuestion?.id || "");
    setAnswerPage(initialQuestion?.regions[0]?.page || 1);
    setZoom(100);
    setView("results");
  };

  const handleStart = async () => {
    if (!files.questionPaper || !files.answerSheet) return;

    setErrorMessage(null);
    setView("processing");
    setProgress(18);
    window.setTimeout(() => setProgress(36), 300);
    window.setTimeout(() => setProgress(58), 700);
    window.setTimeout(() => setProgress(78), 1_100);

    const formData = new FormData();
    formData.append("questionPaper", files.questionPaper);
    formData.append("answerSheet", files.answerSheet);
    const startedAt = Date.now();

    try {
      let { response, payload } = await postAnalysis(formData);

      const canRasterizeForGroq = isPdf(files.questionPaper) || isPdf(files.answerSheet);
      if (response.status === 503 && canRasterizeForGroq) {
        setProgress(84);
        const contactSheets = await buildGroqContactSheets(files.questionPaper, files.answerSheet);
        if (contactSheets) {
          const fallbackData = new FormData();
          fallbackData.append("preferGroq", "true");
          contactSheets.forEach((contactSheet) => fallbackData.append("groqContactSheet", contactSheet));
          ({ response, payload } = await postAnalysis(fallbackData));
        }
      }

      if (!response.ok || !Array.isArray(payload.questions)) throw new Error(payload.error || "Analysis failed.");
      setProgress(92);
      await sleep(Math.max(0, 1_800 - (Date.now() - startedAt)));
      openResults(payload as AnalysisResult);
    } catch (error) {
      await sleep(Math.max(0, 1_800 - (Date.now() - startedAt)));
      const message = error instanceof Error && error.name === "AbortError"
        ? "The extraction timed out. Try smaller files or retry."
        : error instanceof Error
          ? error.message
          : "The files could not be analyzed. Check the file type and retry.";
      setErrorMessage(message);
      setView("upload");
    }
  };

  const reset = () => {
    setView("upload");
    setAnalysis(null);
    setFiles({ questionPaper: null, answerSheet: null });
    setProgress(12);
    setSelectedId("q-2");
    setAnswerPage(1);
    setErrorMessage(null);
  };

  const selectQuestion = (id: string) => {
    setSelectedId(id);
    const question = analysis?.questions.find((item) => item.id === id);
    const firstRegionPage = question?.regions[0]?.page;
    if (firstRegionPage) setAnswerPage(firstRegionPage);
  };

  const handleFilesChange = (nextFiles: UploadedFiles) => {
    setFiles(nextFiles);
    setErrorMessage(null);
  };

  return (
    <AppShell compactNav={view === "results"} onBack={view === "upload" ? undefined : () => setView("upload")}>
      {view === "upload" && <UploadView files={files} onFilesChange={handleFilesChange} onStart={handleStart} errorMessage={errorMessage} />}
      {view === "processing" && <ProcessingView progress={progress} />}
      {view === "results" && analysis && (
        <ResultsView
          analysis={analysis}
          files={files}
          selectedId={selectedId}
          onSelectQuestion={selectQuestion}
          answerPage={answerPage}
          onPageChange={setAnswerPage}
          zoom={zoom}
          onZoomChange={setZoom}
          onReset={reset}
        />
      )}
    </AppShell>
  );
}
