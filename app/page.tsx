"use client";

import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { ProcessingView } from "@/components/ProcessingView";
import { ResultsView } from "@/components/ResultsView";
import { UploadView } from "@/components/UploadView";
import { DEMO_ANALYSIS } from "@/lib/demo-data";
import type { AnalysisResult, UploadedFiles } from "@/lib/types";

type ViewState = "upload" | "processing" | "results";

function sleep(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export default function HomePage() {
  const [view, setView] = useState<ViewState>("upload");
  const [files, setFiles] = useState<UploadedFiles>({ questionPaper: null, answerSheet: null });
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [progress, setProgress] = useState(12);
  const [selectedId, setSelectedId] = useState("q-2");
  const [answerPage, setAnswerPage] = useState(1);
  const [zoom, setZoom] = useState(100);

  const openResults = (nextAnalysis: AnalysisResult) => {
    setAnalysis(nextAnalysis);
    const initialQuestion = nextAnalysis.questions.find((question) => question.id === selectedId) || nextAnalysis.questions[0];
    setSelectedId(initialQuestion?.id || "");
    setAnswerPage(initialQuestion?.regions[0]?.page || 1);
    setZoom(100);
    setView("results");
  };

  const handleDemo = () => {
    openResults(DEMO_ANALYSIS);
  };

  const handleStart = async () => {
    if (!files.questionPaper || !files.answerSheet) return;

    setView("processing");
    setProgress(18);
    window.setTimeout(() => setProgress(36), 300);
    window.setTimeout(() => setProgress(58), 700);
    window.setTimeout(() => setProgress(78), 1_100);

    const formData = new FormData();
    formData.append("questionPaper", files.questionPaper);
    formData.append("answerSheet", files.answerSheet);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    const startedAt = Date.now();

    try {
      const response = await fetch("/api/analyze", { method: "POST", body: formData, signal: controller.signal });
      const payload = (await response.json()) as Partial<AnalysisResult> & { error?: string };
      if (!response.ok || !Array.isArray(payload.questions)) throw new Error(payload.error || "Analysis failed.");
      setProgress(92);
      await sleep(Math.max(0, 1_800 - (Date.now() - startedAt)));
      openResults(payload as AnalysisResult);
    } catch {
      await sleep(Math.max(0, 1_800 - (Date.now() - startedAt)));
      openResults({
        ...DEMO_ANALYSIS,
        note: "AI extraction could not be reached, so a deterministic sample review is shown. Your files are still attached for retry.",
      });
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const reset = () => {
    setView("upload");
    setAnalysis(null);
    setFiles({ questionPaper: null, answerSheet: null });
    setProgress(12);
    setSelectedId("q-2");
    setAnswerPage(1);
  };

  const selectQuestion = (id: string) => {
    setSelectedId(id);
    const question = analysis?.questions.find((item) => item.id === id);
    const firstRegionPage = question?.regions[0]?.page;
    if (firstRegionPage) setAnswerPage(firstRegionPage);
  };

  return (
    <AppShell compactNav={view === "results"} onBack={view === "upload" ? undefined : () => setView("upload")}>
      {view === "upload" && <UploadView files={files} onFilesChange={setFiles} onStart={handleStart} onDemo={handleDemo} />}
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
