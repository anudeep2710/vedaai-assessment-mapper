import { NextResponse } from "next/server";
import { extractJsonObject, normalizeAnalysis } from "@/lib/analysis";

export const runtime = "nodejs";
export const maxDuration = 120;

const EXTRACTION_PROMPT = `You are an assessment extraction and answer-mapping engine. Inspect the question paper and the student's handwritten answer sheet.

Return JSON only with this shape:
{
  "pages": number,
  "confidence": 0.0,
  "questions": [
    {
      "id": "q-1",
      "number": "1 or 11a",
      "text": "the printed question, preserving wording and order",
      "maxMarks": number,
      "marks": number,
      "status": "correct | partial | incorrect | unanswered",
      "answerText": "short transcription or No answer detected.",
      "feedback": "one concise grading insight",
      "regions": [{"page": 1, "bbox": [x, y, width, height], "confidence": 0.0}]
    }
  ],
  "unmatchedAnswers": [{"label": "Unmatched answer", "page": 1, "text": "...", "bbox": [x, y, width, height]}]
}

Rules:
- Extract every printed question in printed order.
- Treat labelled sub-parts such as 11 (a) and 11 (b) as separate entries, while preserving the original number.
- Find answers even when the student answered out of order.
- Keep unanswered questions in the list with status unanswered, an empty regions array, and marks 0.
- Use status incorrect—not unanswered—when writing is present but earns 0 marks, and keep its answer regions.
- Put handwriting that cannot be matched into unmatchedAnswers.
- Express the overall confidence and each region confidence as decimals between 0 and 1.
- Each bbox uses normalized percentages from the top-left of the answer-sheet page: x, y, width, height are all between 0 and 100.
- Use the smallest rectangle that contains the complete handwritten answer; use multiple regions if an answer spans pages.
- Never put question-paper regions in the answer-sheet regions.
- If a mark value cannot be inferred, use the printed maximum and a conservative score.
`;

const CONTACT_SHEET_PROMPT = `The supplied JPEG is a contact sheet containing both documents.
- Tiles with orange headers are QUESTION PAPER pages. Tiles with green headers are ANSWER SHEET pages.
- Read every tile independently and use the page number printed in each tile header.
- For regions[].page and unmatchedAnswers[].page, return the ANSWER SHEET page number from the green header.
- Calculate every bbox relative to the individual white answer-page image inside its tile, excluding the green header and the grey contact-sheet background. Do not calculate bboxes relative to the full contact sheet.
- Never return a region from an orange QUESTION PAPER tile.`;

const GROQ_OUTPUT_RULES = `For this fallback response:
- Return one complete JSON object and no Markdown or commentary.
- Preserve each printed question, but keep question text to at most 35 words.
- Keep answerText to at most 12 words and feedback to at most 10 words per question.
- Prefer concise values over truncating the response. Close every JSON array and object.`;

const MAX_CONTACT_SHEET_BYTES = 2_800_000;

function asBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

async function callGemini(questionPaper: File, answerSheet: File) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const [questionBuffer, answerBuffer] = await Promise.all([questionPaper.arrayBuffer(), answerSheet.arrayBuffer()]);
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const requestBody = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { text: EXTRACTION_PROMPT },
          { text: "QUESTION PAPER FILE:" },
          { inlineData: { mimeType: questionPaper.type || "application/pdf", data: asBase64(questionBuffer) } },
          { text: "STUDENT ANSWER SHEET FILE:" },
          { inlineData: { mimeType: answerSheet.type || "application/pdf", data: asBase64(answerBuffer) } },
        ],
      },
    ],
    generationConfig: { responseMimeType: "application/json" },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: requestBody,
      });
    } catch (error) {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 750));
        continue;
      }
      throw error;
    }

    if (!response.ok) {
      const retryable = [408, 429, 500, 502, 503, 504].includes(response.status);
      if (attempt === 0 && retryable) {
        await response.text();
        await new Promise((resolve) => setTimeout(resolve, 750));
        continue;
      }
      throw new Error(`Gemini request failed with status ${response.status}.`);
    }

    const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const rawText = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
    if (!rawText) throw new Error("Gemini returned an empty response.");
    return normalizeAnalysis(extractJsonObject(rawText), "gemini", "Gemini extraction");
  }

  throw new Error("Gemini extraction failed after retrying.");
}

function isImage(file: File | null): file is File {
  return Boolean(file?.type.startsWith("image/"));
}

async function callGroq(questionPaper: File | null, answerSheet: File | null, contactSheets: File[]) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  let content: Array<Record<string, unknown>>;
  if (contactSheets.length > 0) {
    const contactBuffers = await Promise.all(contactSheets.map((contactSheet) => contactSheet.arrayBuffer()));
    content = [
      { type: "text", text: `${EXTRACTION_PROMPT}\n${CONTACT_SHEET_PROMPT}\n${GROQ_OUTPUT_RULES}` },
      ...contactSheets.map((contactSheet, index) => ({
        type: "image_url",
        image_url: { url: `data:${contactSheet.type};base64,${asBase64(contactBuffers[index])}` },
      })),
    ];
  } else if (isImage(questionPaper) && isImage(answerSheet)) {
    const [questionBuffer, answerBuffer] = await Promise.all([questionPaper.arrayBuffer(), answerSheet.arrayBuffer()]);
    content = [
      { type: "text", text: `${EXTRACTION_PROMPT}\n${GROQ_OUTPUT_RULES}` },
      { type: "text", text: "QUESTION PAPER IMAGE:" },
      { type: "image_url", image_url: { url: `data:${questionPaper.type};base64,${asBase64(questionBuffer)}` } },
      { type: "text", text: "STUDENT ANSWER SHEET IMAGE:" },
      { type: "image_url", image_url: { url: `data:${answerSheet.type};base64,${asBase64(answerBuffer)}` } },
    ];
  } else {
    return null;
  }

  const model = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.5,
      top_p: 0.8,
      reasoning_effort: "none",
      reasoning_format: "hidden",
      max_completion_tokens: 3_200,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    let providerMessage = "";
    try {
      const errorPayload = JSON.parse(errorText) as { error?: { message?: string; code?: string } };
      providerMessage = [errorPayload.error?.code, errorPayload.error?.message].filter(Boolean).join(": ");
    } catch {
      providerMessage = errorText;
    }
    const safeMessage = providerMessage.replace(/[\r\n]+/g, " ").slice(0, 500);
    throw new Error(`Groq request failed with status ${response.status}${safeMessage ? `: ${safeMessage}` : "."}`);
  }
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const rawText = data.choices?.[0]?.message?.content || "";
  if (!rawText) throw new Error("Groq returned an empty response.");
  return normalizeAnalysis(extractJsonObject(rawText), "groq", "Groq vision fallback");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const questionEntry = formData.get("questionPaper");
    const answerEntry = formData.get("answerSheet");
    const contactEntries = formData.getAll("groqContactSheet");
    const questionPaper = questionEntry instanceof File ? questionEntry : null;
    const answerSheet = answerEntry instanceof File ? answerEntry : null;
    const contactSheets = contactEntries.filter((entry): entry is File => entry instanceof File);
    const preferGroq = formData.get("preferGroq") === "true";
    const contactSheetBytes = contactSheets.reduce((total, file) => total + file.size, 0);
    const validContactSheets = contactSheets.length > 0
      && contactSheets.length <= 2
      && contactSheets.length === contactEntries.length
      && contactSheets.every((file) => isImage(file))
      && contactSheetBytes <= MAX_CONTACT_SHEET_BYTES;

    if ((!questionPaper || !answerSheet) && !(preferGroq && validContactSheets)) {
      return NextResponse.json({ error: "Upload both a question paper and an answer sheet." }, { status: 400 });
    }

    if ((questionPaper && questionPaper.size > 15_000_000) || (answerSheet && answerSheet.size > 15_000_000)) {
      return NextResponse.json({ error: "Each file must be 15 MB or smaller. Compress the files and retry." }, { status: 413 });
    }

    if (contactEntries.length > 0 && !validContactSheets) {
      return NextResponse.json({ error: "The Groq fallback images are invalid or too large." }, { status: 413 });
    }

    const geminiConfiguredForFiles = Boolean(process.env.GEMINI_API_KEY && questionPaper && answerSheet);
    const groqConfiguredForFiles = Boolean(
      process.env.GROQ_API_KEY
      && (validContactSheets || (isImage(questionPaper) && isImage(answerSheet))),
    );

    if ((!geminiConfiguredForFiles || preferGroq) && !groqConfiguredForFiles) {
      const usesPdf = questionPaper?.type === "application/pdf" || answerSheet?.type === "application/pdf";
      return NextResponse.json(
        {
          error: usesPdf
            ? "PDF extraction is not configured. Add GEMINI_API_KEY to the server and retry."
            : "AI extraction is not configured. Add GEMINI_API_KEY or GROQ_API_KEY to the server and retry.",
        },
        { status: 503 },
      );
    }

    if (!preferGroq && questionPaper && answerSheet) {
      try {
        const geminiResult = await callGemini(questionPaper, answerSheet);
        if (geminiResult?.questions.length) return NextResponse.json(geminiResult);
      } catch (error) {
        console.error("Gemini extraction failed", error instanceof Error ? error.message : "Unknown Gemini error");
        // The Groq branch below is intentionally a fallback; the UI still remains usable if both providers fail.
      }
    }

    try {
      const groqResult = await callGroq(questionPaper, answerSheet, validContactSheets ? contactSheets : []);
      if (groqResult?.questions.length) return NextResponse.json(groqResult);
    } catch (error) {
      console.error("Groq extraction failed", error instanceof Error ? error.message : "Unknown Groq error");
      // Keep the error response honest when both providers fail; never fabricate a review.
    }

    return NextResponse.json({ error: "AI extraction was unavailable. Configure Gemini or Groq and retry." }, { status: 503 });
  } catch {
    return NextResponse.json({ error: "The files could not be analyzed. Check the file type and retry." }, { status: 500 });
  }
}
