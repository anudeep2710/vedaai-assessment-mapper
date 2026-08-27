"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type PdfPagePreviewProps = {
  file: File;
  page: number;
  onDocumentLoad: (pages: number) => void;
  onPageAspectRatio: (ratio: number) => void;
};

type PreviewStatus = "loading" | "ready" | "error";

export function PdfPagePreview({ file, page, onDocumentLoad, onPageAspectRatio }: PdfPagePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [status, setStatus] = useState<PreviewStatus>("loading");
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let active = true;
    let loadingTask: PDFDocumentLoadingTask | null = null;

    async function loadDocument() {
      setStatus("loading");
      setErrorMessage("");
      setPdfDocument(null);

      const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();

      const source = new Uint8Array(await file.arrayBuffer());
      loadingTask = pdfjs.getDocument({ data: source });
      const loadedDocument = await loadingTask.promise;

      if (!active) {
        await loadingTask.destroy();
        return;
      }

      setPdfDocument(loadedDocument);
      onDocumentLoad(loadedDocument.numPages);
    }

    loadDocument().catch((error: unknown) => {
      if (!active) return;
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "The PDF preview could not be loaded.");
    });

    return () => {
      active = false;
      if (loadingTask) void loadingTask.destroy();
    };
  }, [file, onDocumentLoad]);

  useEffect(() => {
    if (!pdfDocument) return;

    let active = true;
    let renderTask: RenderTask | null = null;

    async function renderPage() {
      setStatus("loading");
      setErrorMessage("");

      const safePage = Math.max(1, Math.min(page, pdfDocument!.numPages));
      const pdfPage = await pdfDocument!.getPage(safePage);
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      onPageAspectRatio(baseViewport.width / baseViewport.height);

      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = pdfPage.getViewport({ scale: 1.55 * pixelRatio });
      const canvas = canvasRef.current;
      if (!canvas || !active) return;

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      renderTask = pdfPage.render({ canvas, viewport, background: "#ffffff" });
      await renderTask.promise;

      if (active) setStatus("ready");
    }

    renderPage().catch((error: unknown) => {
      if (!active || (error instanceof Error && error.name === "RenderingCancelledException")) return;
      setStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "This PDF page could not be rendered.");
    });

    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [page, pdfDocument, onPageAspectRatio]);

  return (
    <>
      <canvas
        ref={canvasRef}
        className={`pdf-page-canvas${status === "ready" ? " is-ready" : ""}`}
        role="img"
        aria-label={`Uploaded answer sheet, page ${page}`}
      />
      {status !== "ready" && (
        <div className={`document-page-status is-${status}`} role={status === "error" ? "alert" : "status"}>
          {status === "loading" ? <span className="document-page-spinner" /> : null}
          <strong>{status === "loading" ? "Rendering uploaded PDF…" : "PDF preview unavailable"}</strong>
          {status === "error" && <span>{errorMessage}</span>}
        </div>
      )}
    </>
  );
}
