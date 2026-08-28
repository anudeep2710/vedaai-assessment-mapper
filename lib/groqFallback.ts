"use client";

const PAGE_WIDTH = 900;
const PAGE_GAP = 18;
const PAGE_PADDING = 10;
const LABEL_HEIGHT = 42;
const MAX_TOTAL_PAGES = 12;
const MAX_CONTACT_SHEET_BYTES = 2_800_000;

type RasterPage = {
  canvas: HTMLCanvasElement;
  label: string;
};

function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

async function renderPdfPages(file: File, labelPrefix: string): Promise<RasterPage[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();

  const source = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjs.getDocument({ data: source });
  const pdfDocument = await loadingTask.promise;

  try {
    const pages: RasterPage[] = [];
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const pdfPage = await pdfDocument.getPage(pageNumber);
      const baseViewport = pdfPage.getViewport({ scale: 1 });
      const viewport = pdfPage.getViewport({ scale: PAGE_WIDTH / baseViewport.width });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await pdfPage.render({ canvas, viewport, background: "#ffffff" }).promise;
      pages.push({ canvas, label: `${labelPrefix} · PAGE ${pageNumber}` });
    }
    return pages;
  } finally {
    await loadingTask.destroy();
  }
}

async function renderImagePage(file: File, labelPrefix: string): Promise<RasterPage[]> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, PAGE_WIDTH / bitmap.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image canvas is unavailable.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return [{ canvas, label: `${labelPrefix} · PAGE 1` }];
  } finally {
    bitmap.close();
  }
}

async function rasterize(file: File, labelPrefix: string): Promise<RasterPage[]> {
  if (isPdf(file)) return renderPdfPages(file, labelPrefix);
  if (file.type.startsWith("image/")) return renderImagePage(file, labelPrefix);
  throw new Error("Unsupported fallback file type.");
}

function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("Contact sheet encoding failed.")),
      "image/jpeg",
      quality,
    );
  });
}

async function encodeContactSheet(
  pages: RasterPage[],
  fileName: string,
  maximumColumns: number,
  quality: number,
): Promise<File | null> {
  if (pages.length === 0) return null;

  const columns = Math.min(maximumColumns, pages.length);
  const rows = Math.ceil(pages.length / columns);
  const cellWidth = PAGE_WIDTH + PAGE_PADDING * 2;
  const maxPageHeight = Math.max(...pages.map((page) => page.canvas.height));
  const cellHeight = LABEL_HEIGHT + maxPageHeight + PAGE_PADDING;
  const contactSheet = document.createElement("canvas");
  contactSheet.width = columns * cellWidth + (columns + 1) * PAGE_GAP;
  contactSheet.height = rows * cellHeight + (rows + 1) * PAGE_GAP;
  const context = contactSheet.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#d9d6d2";
  context.fillRect(0, 0, contactSheet.width, contactSheet.height);
  context.textBaseline = "middle";
  context.font = "700 22px Arial, sans-serif";

  pages.forEach((page, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = PAGE_GAP + column * (cellWidth + PAGE_GAP);
    const y = PAGE_GAP + row * (cellHeight + PAGE_GAP);
    context.fillStyle = "#ffffff";
    context.fillRect(x, y, cellWidth, cellHeight);
    context.fillStyle = page.label.startsWith("QUESTION") ? "#ff5623" : "#228b22";
    context.fillRect(x, y, cellWidth, LABEL_HEIGHT);
    context.fillStyle = "#ffffff";
    context.fillText(page.label, x + PAGE_PADDING, y + LABEL_HEIGHT / 2);
    context.drawImage(page.canvas, x + PAGE_PADDING, y + LABEL_HEIGHT);
  });

  const blob = await canvasBlob(contactSheet, quality);
  return new File([blob], fileName, { type: "image/jpeg" });
}

export async function buildGroqContactSheets(questionPaper: File, answerSheet: File): Promise<File[] | null> {
  try {
    const [questionPages, answerPages] = await Promise.all([
      rasterize(questionPaper, "QUESTION PAPER"),
      rasterize(answerSheet, "ANSWER SHEET"),
    ]);
    if (questionPages.length + answerPages.length > MAX_TOTAL_PAGES) return null;

    const encode = async (quality: number) => Promise.all([
      encodeContactSheet(questionPages, "assessment-groq-questions.jpg", 3, quality),
      encodeContactSheet(answerPages, "assessment-groq-answers.jpg", 2, quality),
    ]);

    let files = (await encode(0.84)).filter((file): file is File => Boolean(file));
    if (files.reduce((total, file) => total + file.size, 0) > MAX_CONTACT_SHEET_BYTES) {
      files = (await encode(0.68)).filter((file): file is File => Boolean(file));
    }
    if (files.length !== 2 || files.reduce((total, file) => total + file.size, 0) > MAX_CONTACT_SHEET_BYTES) {
      return null;
    }
    return files;
  } catch {
    return null;
  }
}
