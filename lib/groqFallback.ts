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

function cropQuestionFooter(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return canvas;

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const inkRows: number[] = [];
  for (let y = 0; y < canvas.height; y += 2) {
    let inkSamples = 0;
    for (let x = 0; x < canvas.width; x += 4) {
      const offset = (y * canvas.width + x) * 4;
      if (pixels[offset] < 225 || pixels[offset + 1] < 225 || pixels[offset + 2] < 225) {
        inkSamples += 1;
        if (inkSamples >= 3) break;
      }
    }
    if (inkSamples >= 3) inkRows.push(y);
  }

  if (inkRows.length < 2) return canvas;
  let footerStartIndex = inkRows.length - 1;
  while (
    footerStartIndex > 0
    && inkRows[footerStartIndex] - inkRows[footerStartIndex - 1] <= 18
  ) {
    footerStartIndex -= 1;
  }

  const footerStart = inkRows[footerStartIndex];
  const previousInk = inkRows[footerStartIndex - 1];
  const isolatedFooter = footerStart > canvas.height * 0.85 && footerStart - previousInk > 80;
  if (!isolatedFooter) return canvas;

  const cropHeight = Math.min(canvas.height, Math.max(canvas.height * 0.45, previousInk + 40));
  const cropped = document.createElement("canvas");
  cropped.width = canvas.width;
  cropped.height = Math.round(cropHeight);
  const croppedContext = cropped.getContext("2d");
  if (!croppedContext) return canvas;
  croppedContext.fillStyle = "#ffffff";
  croppedContext.fillRect(0, 0, cropped.width, cropped.height);
  croppedContext.drawImage(canvas, 0, 0, canvas.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return cropped;
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
      const renderedCanvas = labelPrefix === "QUESTION PAPER" ? cropQuestionFooter(canvas) : canvas;
      pages.push({ canvas: renderedCanvas, label: `${labelPrefix} · PAGE ${pageNumber}` });
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

    const answerSplit = Math.ceil(answerPages.length / 2);
    const firstAnswerPages = answerPages.slice(0, answerSplit);
    const secondAnswerPages = answerPages.slice(answerSplit);
    const encode = async (quality: number) => Promise.all([
      encodeContactSheet(questionPages, "assessment-groq-questions.jpg", 3, quality),
      encodeContactSheet(firstAnswerPages, "assessment-groq-answers-1.jpg", 2, quality),
      encodeContactSheet(secondAnswerPages, "assessment-groq-answers-2.jpg", 2, quality),
    ]);

    let files = (await encode(0.84)).filter((file): file is File => Boolean(file));
    if (files.reduce((total, file) => total + file.size, 0) > MAX_CONTACT_SHEET_BYTES) {
      files = (await encode(0.68)).filter((file): file is File => Boolean(file));
    }
    const expectedFileCount = secondAnswerPages.length > 0 ? 3 : 2;
    if (files.length !== expectedFileCount || files.reduce((total, file) => total + file.size, 0) > MAX_CONTACT_SHEET_BYTES) {
      return null;
    }
    return files;
  } catch {
    return null;
  }
}
