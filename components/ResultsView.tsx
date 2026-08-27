"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronLeft, ChevronRight, Maximize2, Minus, Plus, RotateCcw, Sparkles } from "lucide-react";
import { PdfPagePreview } from "./PdfPagePreview";
import type { AnalysisResult, AssessmentQuestion, UploadedFiles } from "@/lib/types";

type ResultsViewProps = {
  analysis: AnalysisResult;
  files: UploadedFiles;
  selectedId: string;
  onSelectQuestion: (id: string) => void;
  answerPage: number;
  onPageChange: (page: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onReset: () => void;
};

function ScorePill({ question }: { question: AssessmentQuestion }) {
  return (
    <span className={`score-pill is-${question.status}`}>
      {question.marks} / {question.maxMarks}
    </span>
  );
}

function QuestionCard({
  question,
  selected,
  feedbackVisible,
  onClick,
}: {
  question: AssessmentQuestion;
  selected: boolean;
  feedbackVisible: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`question-card${selected ? " is-selected" : ""}${feedbackVisible ? " has-feedback" : ""}`} type="button" onClick={onClick} aria-pressed={selected}>
      <div className="question-card-main">
        <span className={`question-index${question.number.length > 2 ? " is-subpart" : ""}`}>{question.number}</span>
        <span className="question-text">{question.text}</span>
        <ScorePill question={question} />
        <ChevronDown className={`question-chevron${selected ? " is-open" : ""}`} size={15} />
      </div>
      {feedbackVisible && question.feedback && (
        <div className="feedback-block" onClick={(event) => event.stopPropagation()}>
          <strong>AI Feedback</strong>
          <p>{question.feedback}</p>
        </div>
      )}
    </button>
  );
}

function AnswerPaper({
  page,
  zoom,
  analysis,
  selectedId,
  answerFile,
  previewUrl,
  pageCount,
  onPdfDocumentLoad,
}: {
  page: number;
  zoom: number;
  analysis: AnalysisResult;
  selectedId: string;
  answerFile: File | null;
  previewUrl: string | null;
  pageCount: number;
  onPdfDocumentLoad: (pages: number) => void;
}) {
  const [pageAspectRatio, setPageAspectRatio] = useState(0.707);
  const selected = analysis.questions.find((question) => question.id === selectedId);
  const selectedPageRegions = selected?.regions.filter((region) => region.page === page) || [];
  const unmatched = analysis.unmatchedAnswers.filter((answer) => answer.page === page);
  const isPdf = Boolean(answerFile && (answerFile.type === "application/pdf" || answerFile.name.toLowerCase().endsWith(".pdf")));
  const isImage = Boolean(answerFile?.type.startsWith("image/") && previewUrl);

  const handlePageAspectRatio = useCallback((ratio: number) => {
    if (Number.isFinite(ratio) && ratio > 0) setPageAspectRatio(ratio);
  }, []);

  return (
    <div className="paper-scale-frame">
      <div
        className="answer-paper is-document-preview"
        style={{ transform: `scale(${zoom / 100})`, aspectRatio: `${pageAspectRatio}` }}
      >
        {isPdf && answerFile ? (
          <PdfPagePreview
            file={answerFile}
            page={page}
            onDocumentLoad={onPdfDocumentLoad}
            onPageAspectRatio={handlePageAspectRatio}
          />
        ) : null}

        {isImage && previewUrl ? (
          <Image
            className="uploaded-answer-preview"
            src={previewUrl}
            alt="Uploaded handwritten answer sheet"
            fill
            unoptimized
            sizes="(max-width: 760px) 100vw, 50vw"
            onLoad={(event) => handlePageAspectRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
          />
        ) : null}

        {!isPdf && !isImage ? (
          <div className="document-page-status is-error" role="alert">
            <strong>Answer sheet preview unavailable</strong>
            <span>Upload a PDF, PNG, JPG, or WebP answer sheet.</span>
          </div>
        ) : null}

        {selectedPageRegions.map((region, index) => (
          <div
            className="answer-region is-selected"
            key={`selected-region-${index}`}
            style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.width}%`, height: `${region.height}%` }}
          >
            <span className="region-label">Q{selected?.number}</span>
          </div>
        ))}

        {unmatched.map((answer) => (
          <div className="answer-region is-unmatched" key={answer.id} style={{ left: `${answer.x}%`, top: `${answer.y}%`, width: `${answer.width}%`, height: `${answer.height}%` }}>
            <span className="region-label">?</span>
          </div>
        ))}
        <span className="paper-page-number">{page} / {pageCount}</span>
      </div>
    </div>
  );
}

function ResultsSummary({ analysis }: { analysis: AnalysisResult }) {
  const earned = analysis.questions.reduce((sum, question) => sum + question.marks, 0);
  const possible = analysis.questions.reduce((sum, question) => sum + question.maxMarks, 0);
  const answered = analysis.questions.filter((question) => question.status !== "unanswered").length;
  return (
    <div className="results-summary">
      <div><strong>{earned}/{possible}</strong><span>marks</span></div>
      <div><strong>{answered}/{analysis.questions.length}</strong><span>answered</span></div>
      <div><strong>{analysis.unmatchedAnswers.length}</strong><span>unmatched</span></div>
    </div>
  );
}

export function ResultsView({
  analysis,
  files,
  selectedId,
  onSelectQuestion,
  answerPage,
  onPageChange,
  zoom,
  onZoomChange,
  onReset,
}: ResultsViewProps) {
  const answerIsPdf = Boolean(files.answerSheet && (files.answerSheet.type === "application/pdf" || files.answerSheet.name.toLowerCase().endsWith(".pdf")));
  const [showAllFeedback, setShowAllFeedback] = useState(false);
  const [mobileTab, setMobileTab] = useState<"questions" | "answer">("questions");
  const [documentPageCount, setDocumentPageCount] = useState(() => answerIsPdf ? Math.max(1, analysis.pages) : 1);
  const answerViewerRef = useRef<HTMLDivElement>(null);
  const previewUrl = useMemo(() => {
    const file = files.answerSheet;
    if (!file || !file.type.startsWith("image/")) return null;
    return URL.createObjectURL(file);
  }, [files.answerSheet]);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const handlePdfDocumentLoad = useCallback((pages: number) => {
    setDocumentPageCount(Math.max(1, pages));
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await answerViewerRef.current?.requestFullscreen();
    } catch {
      // Fullscreen can be denied by browser policy; the viewer remains usable.
    }
  };

  const selectedQuestion = analysis.questions.find((question) => question.id === selectedId);
  const visibleAnswerPage = Math.max(1, Math.min(answerPage, documentPageCount));
  const answerPageLabel = documentPageCount > 1 ? `Page ${visibleAnswerPage} of ${documentPageCount}` : "Page 1 of 1";

  return (
    <section className="results-view" aria-label="Question and answer mapping review">
      <div className="mobile-results-tabs" role="tablist" aria-label="Review panels">
        <button
          className={mobileTab === "questions" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={mobileTab === "questions"}
          onClick={() => setMobileTab("questions")}
        >
          Questions
        </button>
        <button
          className={mobileTab === "answer" ? "is-active" : ""}
          type="button"
          role="tab"
          aria-selected={mobileTab === "answer"}
          onClick={() => setMobileTab("answer")}
        >
          Answer Sheet
        </button>
      </div>

      <div className={`results-panel questions-panel${mobileTab === "questions" ? " is-mobile-visible" : ""}`}>
        <div className="questions-panel-head">
          <div>
            <span className="eyebrow">Assessment review</span>
            <h1>Extracted Questions <span>(from question paper)</span></h1>
          </div>
          <button className="expand-button" type="button" onClick={() => setShowAllFeedback((value) => !value)}>
            {showAllFeedback ? "Collapse" : "Expand All"}
          </button>
        </div>

        <div className="extraction-status">
          <span className={`status-dot is-${analysis.mode}`} />
          <span>{analysis.providerLabel}</span>
          <span className="status-divider">·</span>
          <span>{analysis.confidence}% confidence</span>
          <button type="button" className="reset-review-button" onClick={onReset} aria-label="Start another review"><RotateCcw size={12} /></button>
        </div>

        <ResultsSummary analysis={analysis} />

        {analysis.note && <div className="review-note"><Sparkles size={13} /><span>{analysis.note}</span></div>}

        <div className="question-list">
          {analysis.questions.map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              selected={selectedId === question.id}
              feedbackVisible={showAllFeedback || selectedId === question.id}
              onClick={() => onSelectQuestion(question.id)}
            />
          ))}
          {analysis.unmatchedAnswers.length > 0 && (
            <div className="unmatched-summary">
              <div className="unmatched-summary-heading"><span>?</span><strong>Unmatched answers</strong><em>{analysis.unmatchedAnswers.length}</em></div>
              <p>Handwriting was found that could not be connected to a printed question. Check the marked regions on the sheet.</p>
            </div>
          )}
        </div>
      </div>

      <div className={`results-panel answer-panel${mobileTab === "answer" ? " is-mobile-visible" : ""}`}>
        <div className="answer-panel-head">
          <div>
            <span className="eyebrow">Mapped source</span>
            <h2>Answer Sheet</h2>
          </div>
          <div className="answer-toolbar-controls">
            <div className="zoom-controls" aria-label="Zoom controls">
              <button type="button" onClick={() => onZoomChange(Math.max(70, zoom - 10))} aria-label="Zoom out"><Minus size={13} /></button>
              <span>{zoom}%</span>
              <button type="button" onClick={() => onZoomChange(Math.min(130, zoom + 10))} aria-label="Zoom in"><Plus size={13} /></button>
            </div>
            <button type="button" className="page-control" onClick={() => onPageChange(Math.max(1, visibleAnswerPage - 1))} disabled={visibleAnswerPage === 1} aria-label="Previous page"><ChevronLeft size={13} /></button>
            <span className="page-label">{answerPageLabel}</span>
            <button type="button" className="page-control" onClick={() => onPageChange(Math.min(documentPageCount, visibleAnswerPage + 1))} disabled={visibleAnswerPage === documentPageCount} aria-label="Next page"><ChevronRight size={13} /></button>
            <button type="button" className="fullscreen-control" onClick={toggleFullscreen} aria-label="Toggle answer sheet fullscreen"><Maximize2 size={13} /></button>
          </div>
        </div>
        <div className="answer-focus-line">
          <span className="focus-pin" />
          <span>{selectedQuestion ? `Showing answer ${selectedQuestion.number}` : "Select a question to locate its answer"}</span>
          {selectedQuestion?.regions.length ? <span className="focus-confidence">{Math.round((selectedQuestion.regions[0].confidence || 0) * 100)}% region confidence</span> : null}
        </div>
        <div className="answer-viewer" ref={answerViewerRef}>
          <AnswerPaper
            page={visibleAnswerPage}
            zoom={zoom}
            analysis={analysis}
            selectedId={selectedId}
            answerFile={files.answerSheet}
            previewUrl={previewUrl}
            pageCount={documentPageCount}
            onPdfDocumentLoad={handlePdfDocumentLoad}
          />
        </div>
        <div className="answer-panel-footer">
          <span><span className="legend-dot is-mapped" /> Selected answer region</span>
          <span><span className="legend-dot is-unmatched" /> Unmatched writing</span>
        </div>
      </div>
    </section>
  );
}
