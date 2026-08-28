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

const GROQ_QUESTION_PROMPT = `Inspect only this printed QUESTION PAPER image. Return JSON only:
{"questions":[{"number":"exact printed label","text":"printed question","maxMarks":3}]}
Rules:
- Extract every question in printed page order, exactly once.
- Treat every labelled part, including nested parts such as 6 (b) (i), as a separate entry.
- Preserve each exact printed label. Never renumber sequentially.
- Read maxMarks from the red [n] beside that exact entry.
- Keep text to at most 24 words without changing its meaning.
- Orange tile headers identify question-paper page order. Return no commentary.`;

const GROQ_ANSWER_PROMPT = `Inspect only this handwritten ANSWER SHEET image and map it to the authoritative printed list below.
The answers are deliberately out of order. Match by meaning and handwritten labels, but return each authoritative number exactly.
Return JSON only:
{"pages":4,"confidence":0.9,"answers":[{"number":"exact authoritative number","marks":2,"status":"correct | partial | incorrect | unanswered","regions":[{"page":1,"bbox":[x,y,width,height],"confidence":0.9}]}],"unmatchedAnswers":[]}
Rules:
- Include one answer object for every authoritative number, in authoritative order.
- Unanswered means marks 0 and regions []. Incorrect writing keeps its regions.
- Green headers give answer page numbers.
- A bbox is a normalized 0-100 percentage rectangle relative to the individual white answer page, excluding its green header and grey background.
- Use the smallest complete answer rectangle and multiple regions for multi-page answers.
- Return no question text, transcription, feedback, Markdown or commentary.

AUTHORITATIVE PRINTED LIST:`;

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

async function callGroqJson(
  key: string,
  content: Array<Record<string, unknown>>,
  maxCompletionTokens: number,
): Promise<unknown> {
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
      max_completion_tokens: maxCompletionTokens,
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
  return extractJsonObject(rawText);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asNumber(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function numberKey(value: unknown): string {
  return asString(value)
    .toLowerCase()
    .replace(/^question\s*/i, "")
    .replace(/^q\s*/i, "")
    .replace(/[^0-9a-z]/g, "");
}

async function callGroq(questionPaper: File | null, answerSheet: File | null, contactSheets: File[]) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;

  const questionSource = contactSheets[0] || (isImage(questionPaper) ? questionPaper : null);
  const answerSource = contactSheets[1] || (isImage(answerSheet) ? answerSheet : null);
  if (!isImage(questionSource) || !isImage(answerSource)) return null;

  const [questionBuffer, answerBuffer] = await Promise.all([
    questionSource.arrayBuffer(),
    answerSource.arrayBuffer(),
  ]);
  const questionResult = asRecord(await callGroqJson(
    key,
    [
      { type: "text", text: GROQ_QUESTION_PROMPT },
      { type: "image_url", image_url: { url: `data:${questionSource.type};base64,${asBase64(questionBuffer)}` } },
    ],
    1_200,
  ));
  const rawPrintedQuestions = Array.isArray(questionResult.questions) ? questionResult.questions : [];
  const printedQuestions = rawPrintedQuestions
    .map((value, index) => {
      const item = asRecord(value);
      return {
        id: `q-${index + 1}`,
        number: asString(item.number ?? item.label),
        text: asString(item.text ?? item.question),
        maxMarks: Math.max(1, Math.round(asNumber(item.maxMarks ?? item.marksAvailable, 2))),
      };
    })
    .filter((question) => question.number && question.text);
  if (printedQuestions.length === 0) throw new Error("Groq did not extract printed questions.");

  const authoritativeList = JSON.stringify(printedQuestions.map(({ number, text, maxMarks }) => ({
    number,
    text,
    maxMarks,
  })));
  const answerResult = asRecord(await callGroqJson(
    key,
    [
      { type: "text", text: `${GROQ_ANSWER_PROMPT}\n${authoritativeList}` },
      { type: "image_url", image_url: { url: `data:${answerSource.type};base64,${asBase64(answerBuffer)}` } },
    ],
    1_200,
  ));
  const rawAnswers = Array.isArray(answerResult.answers)
    ? answerResult.answers
    : Array.isArray(answerResult.questions)
      ? answerResult.questions
      : [];
  const answersByNumber = new Map<string, Record<string, unknown>>();
  rawAnswers.forEach((value) => {
    const answer = asRecord(value);
    const keyValue = numberKey(answer.number ?? answer.label);
    if (keyValue) answersByNumber.set(keyValue, answer);
  });

  const questions = printedQuestions.map((question) => {
    const answer = answersByNumber.get(numberKey(question.number));
    const suppliedStatus = asString(answer?.status).toLowerCase();
    const status = ["correct", "partial", "incorrect", "unanswered"].includes(suppliedStatus)
      ? suppliedStatus
      : answer && Array.isArray(answer.regions) && answer.regions.length > 0
        ? "partial"
        : "unanswered";
    return {
      ...question,
      marks: status === "unanswered" ? 0 : asNumber(answer?.marks, 0),
      status,
      answerText: status === "unanswered" ? "No answer detected." : "Answer detected by Groq.",
      feedback: status === "unanswered" ? "No answer detected." : "Verify the mapped response and score.",
      regions: status === "unanswered" || !Array.isArray(answer?.regions) ? [] : answer.regions,
    };
  });

  return normalizeAnalysis(
    {
      pages: answerResult.pages,
      confidence: answerResult.confidence,
      questions,
      unmatchedAnswers: Array.isArray(answerResult.unmatchedAnswers) ? answerResult.unmatchedAnswers : [],
    },
    "groq",
    "Groq vision fallback",
  );
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
    const validContactSheets = contactSheets.length === 2
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
