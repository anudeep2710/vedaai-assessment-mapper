"use client";

import { useRef, type ChangeEvent, type DragEvent } from "react";
import { FileText, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { TeacherBadge } from "./AppShell";
import type { UploadedFiles } from "@/lib/types";

type UploadViewProps = {
  files: UploadedFiles;
  onFilesChange: (files: UploadedFiles) => void;
  onStart: () => void;
  onDemo: () => void;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileChip({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <div className="file-chip">
      <span className="file-type-icon"><FileText size={17} /></span>
      <span className="file-chip-copy">
        <strong title={file.name}>{file.name}</strong>
        <span>{formatBytes(file.size)} · {file.type === "application/pdf" ? "PDF" : "Image"}</span>
      </span>
      <button type="button" onClick={(event) => { event.stopPropagation(); onRemove(); }} aria-label={`Remove ${file.name}`} className="remove-file-button">
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function UploadCard({
  kind,
  file,
  onFile,
  onRemove,
}: {
  kind: "questionPaper" | "answerSheet";
  file: File | null;
  onFile: (file: File | null) => void;
  onRemove: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isQuestion = kind === "questionPaper";
  const title = isQuestion ? "Question Paper" : "Answer Sheet";

  const chooseFile = () => inputRef.current?.click();
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFile(event.target.files?.[0] || null);
    event.target.value = "";
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) onFile(dropped);
  };

  return (
    <div className={`upload-card${file ? " has-file" : ""}`} onClick={chooseFile} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <input ref={inputRef} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" onChange={handleChange} hidden />
      {file ? (
        <FileChip file={file} onRemove={onRemove} />
      ) : (
        <>
          <div className="upload-icon"><Upload size={15} strokeWidth={2.2} /></div>
          <div className="upload-title">Upload <span>{title}</span></div>
          <div className="upload-subtitle"><ImageIcon size={11} /> PDF, JPG, PNG · max 15 MB</div>
        </>
      )}
    </div>
  );
}

export function UploadView({ files, onFilesChange, onStart, onDemo }: UploadViewProps) {
  const ready = Boolean(files.questionPaper && files.answerSheet);

  return (
    <section className="upload-view" aria-labelledby="upload-heading">
      <div className="upload-copy">
        <h1 id="upload-heading">Upload <span>Question Paper &amp; Answer Sheets</span></h1>
        <p>Upload both files to get started</p>
      </div>

      <TeacherBadge />

      <div className="upload-cards">
        <UploadCard
          kind="questionPaper"
          file={files.questionPaper}
          onFile={(file) => onFilesChange({ ...files, questionPaper: file })}
          onRemove={() => onFilesChange({ ...files, questionPaper: null })}
        />
        <UploadCard
          kind="answerSheet"
          file={files.answerSheet}
          onFile={(file) => onFilesChange({ ...files, answerSheet: file })}
          onRemove={() => onFilesChange({ ...files, answerSheet: null })}
        />
      </div>

      <div className="upload-actions">
        <button className="start-button" type="button" disabled={!ready} onClick={onStart}>
          Start Mapping <span>→</span>
        </button>
        <button className="demo-button" type="button" onClick={onDemo}>
          Preview a sample review
        </button>
      </div>
      <p className="upload-help">We’ll extract printed question order, locate answers, and show each mapped region.</p>
    </section>
  );
}
