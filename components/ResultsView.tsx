"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { ChevronDown, ChevronLeft, ChevronRight, Maximize2, Minus, Plus, RotateCcw, Sparkles } from "lucide-react";
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

const PAGE_COPY: Record<number, Array<{ label: string; text: string; top: number; wide?: boolean; diagram?: boolean }>> = {
  1: [
    { label: "Q1.", text: "Arteries carry blood away from the heart.", top: 8 },
    { label: "Q2.", text: "The process mainly occurs in the chloroplast of the plant cell.", top: 29, wide: true },
    { label: "Q3.", text: "Chloroplasts contain chlorophyll. Light reaction captures energy; dark reaction uses it to make glucose.", top: 51, wide: true },
  ],
  2: [
    { label: "Q5.", text: "Alveolar sac · capillary · oxygen and carbon dioxide exchange", top: 10, diagram: true },
    { label: "Q6.", text: "Digestive system — stomach, small intestine, liver and pancreas", top: 44, diagram: true },
  ],
  3: [
    { label: "Q7.", text: "Nephron: Bowman's capsule → tubule → collecting duct", top: 11, diagram: true },
    { label: "Q8.", text: "Palisade cells are tightly packed; spongy cells leave air spaces for gas exchange.", top: 45, wide: true },
    { label: "Q9.", text: "Transpiration is the loss of water vapour through stomata. Wind and heat increase the rate.", top: 70, wide: true },
  ],
  4: [
    { label: "Q10.", text: "Xylem vessels have lignified walls and form a continuous hollow tube for water transport.", top: 9, wide: true },
    { label: "Q11a.", text: "Plant A: broad green leaves · Plant B: pale elongated leaves", top: 31, diagram: true },
    { label: "Q11b.", text: "Move Plant B to brighter indirect light.", top: 53 },
    { label: "Q12.", text: "Minute ventilation = 0.5 × 12 = 6 L/min", top: 68, wide: true },
    { label: "Q13.", text: "(0.5 − 0.15) × 12 = 4.2 L/min", top: 85, wide: true },
  ],
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

function MiniDiagram({ kind }: { kind?: string }) {
  return (
    <span className={`mini-diagram ${kind === "alveolus" ? "is-alveolus" : ""}`} aria-hidden="true">
      <span className="diagram-circle" />
      <span className="diagram-line line-a" />
      <span className="diagram-line line-b" />
      <span className="diagram-label label-a">O₂</span>
      <span className="diagram-label label-b">CO₂</span>
    </span>
  );
}

function PaperContent({ page }: { page: number }) {
  return (
    <div className="paper-content" aria-hidden="true">
      {(PAGE_COPY[page] || []).map((entry) => (
        <div className={`paper-entry${entry.wide ? " is-wide" : ""}`} style={{ top: `${entry.top}%` }} key={`${page}-${entry.label}`}>
          <span className="paper-entry-label">{entry.label}</span>
          {entry.diagram ? <MiniDiagram /> : <span>{entry.text}</span>}
          {entry.diagram && <span className="paper-entry-caption">{entry.text}</span>}
        </div>
      ))}
      <div className="paper-signature">student answer sheet</div>
    </div>
  );
}

function AnswerPaper({
  page,
  zoom,
  analysis,
  selectedId,
  previewUrl,
  previewIsImage,
}: {
  page: number;
  zoom: number;
  analysis: AnalysisResult;
  selectedId: string;
  previewUrl: string | null;
  previewIsImage: boolean;
}) {
  const regionItems = useMemo(() => {
    return analysis.questions.flatMap((question) => question.regions.map((region, index) => ({ question, region, index })));
  }, [analysis.questions]);
  const selected = analysis.questions.find((question) => question.id === selectedId);
  const selectedPageRegions = selected?.regions.filter((region) => region.page === page) || [];
  const unmatched = analysis.unmatchedAnswers.filter((answer) => answer.page === page);

  return (
    <div className="paper-scale-frame">
      <div className={`answer-paper${previewIsImage ? " is-image-preview" : ""}`} style={{ transform: `scale(${zoom / 100})` }}>
        {previewUrl && previewIsImage ? (
          <Image className="uploaded-answer-preview" src={previewUrl} alt="Uploaded handwritten answer sheet" fill unoptimized sizes="(max-width: 760px) 100vw, 50vw" />
        ) : (
          <>
            <div className="paper-grid" />
            <div className="paper-margin" />
            <PaperContent page={page} />
          </>
        )}

        {!previewIsImage && regionItems.filter(({ region }) => region.page === page).map(({ question, region, index }) => {
          const isSelected = question.id === selectedId;
          return (
            <div
              className={`answer-region ${isSelected ? "is-selected" : "is-muted"}`}
              key={`${question.id}-${index}`}
              style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.width}%`, height: `${region.height}%` }}
              title={`${question.number} · ${Math.round((region.confidence || 0) * 100)}% confidence`}
            >
              {isSelected && <span className="region-label">Q{question.number}</span>}
            </div>
          );
        })}

        {previewIsImage && selectedPageRegions.map((region, index) => (
          <div
            className="answer-region is-selected"
            key={`selected-image-region-${index}`}
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
        <span className="paper-page-number">{page} / {analysis.pages}</span>
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
  const [showAllFeedback, setShowAllFeedback] = useState(false);
  const [mobileTab, setMobileTab] = useState<"questions" | "answer">("questions");
  const previewUrl = useMemo(() => {
    const file = files.answerSheet;
    if (!file || !file.type.startsWith("image/")) return null;
    return URL.createObjectURL(file);
  }, [files.answerSheet]);
  const previewIsImage = Boolean(files.answerSheet?.type.startsWith("image/") && previewUrl);

  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const selectedQuestion = analysis.questions.find((question) => question.id === selectedId);
  const answerPageLabel = analysis.pages > 1 ? `Page ${answerPage} of ${analysis.pages}` : "Page 1 of 1";

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
            <button type="button" className="page-control" onClick={() => onPageChange(Math.max(1, answerPage - 1))} disabled={answerPage === 1} aria-label="Previous page"><ChevronLeft size={13} /></button>
            <span className="page-label">{answerPageLabel}</span>
            <button type="button" className="page-control" onClick={() => onPageChange(Math.min(analysis.pages, answerPage + 1))} disabled={answerPage === analysis.pages} aria-label="Next page"><ChevronRight size={13} /></button>
            <button type="button" className="fullscreen-control" aria-label="Fit answer sheet"><Maximize2 size={13} /></button>
          </div>
        </div>
        <div className="answer-focus-line">
          <span className="focus-pin" />
          <span>{selectedQuestion ? `Showing answer ${selectedQuestion.number}` : "Select a question to locate its answer"}</span>
          {selectedQuestion?.regions.length ? <span className="focus-confidence">{Math.round((selectedQuestion.regions[0].confidence || 0) * 100)}% region confidence</span> : null}
        </div>
        <div className="answer-viewer">
          <AnswerPaper page={answerPage} zoom={zoom} analysis={analysis} selectedId={selectedId} previewUrl={previewUrl} previewIsImage={previewIsImage} />
        </div>
        <div className="answer-panel-footer">
          <span><span className="legend-dot is-mapped" /> Selected answer region</span>
          <span><span className="legend-dot is-unmatched" /> Unmatched writing</span>
        </div>
      </div>
    </section>
  );
}
