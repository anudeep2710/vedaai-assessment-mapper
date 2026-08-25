import { NextResponse } from "next/server";
import { DEMO_ANALYSIS } from "@/lib/demo-data";
import { extractJsonObject, normalizeAnalysis } from "@/lib/analysis";

export const runtime = "nodejs";
export const maxDuration = 60;

const EXTRACTION_PROMPT = `You are an assessment extraction and answer-mapping engine. Inspect the question paper and the student's handwritten answer sheet.

Return JSON only with this shape:
{
  "pages": number,
  "confidence": number,
  "questions": [
    {
      "id": "q-1",
      "number": "1 or 11a",
      "text": "the printed question, preserving wording and order",
      "maxMarks": number,
      "marks": number,
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
- Keep unanswered questions in the list with an empty regions array and marks 0.
- Put handwriting that cannot be matched into unmatchedAnswers.
- Each bbox uses normalized percentages from the top-left of the answer-sheet page: x, y, width, height are all between 0 and 100.
- Use the smallest rectangle that contains the complete handwritten answer; use multiple regions if an answer spans pages.
- Never put question-paper regions in the answer-sheet regions.
- If a mark value cannot be inferred, use the printed maximum and a conservative score.
`;

function asBase64(buffer: ArrayBuffer): string {
  return Buffer.from(buffer).toString("base64");
}

async function callGemini(questionPaper: File, answerSheet: File) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const [questionBuffer, answerBuffer] = await Promise.all([questionPaper.arrayBuffer(), answerSheet.arrayBuffer()]);
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
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
      generationConfig: { temperature: 0.1, responseMimeType: "application/json" },
    }),
  });

  if (!response.ok) throw new Error(`Gemini request failed with status ${response.status}.`);
  const data = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const rawText = data.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("") || "";
  if (!rawText) throw new Error("Gemini returned an empty response.");
  return normalizeAnalysis(extractJsonObject(rawText), "gemini", "Gemini extraction");
}

async function callGroq(questionPaper: File, answerSheet: File) {
  const key = process.env.GROQ_API_KEY;
  const isImageInput = questionPaper.type.startsWith("image/") && answerSheet.type.startsWith("image/");
  if (!key || !isImageInput) return null;

  const [questionBuffer, answerBuffer] = await Promise.all([questionPaper.arrayBuffer(), answerSheet.arrayBuffer()]);
  const model = process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: EXTRACTION_PROMPT },
            { type: "text", text: "QUESTION PAPER IMAGE:" },
            { type: "image_url", image_url: { url: `data:${questionPaper.type};base64,${asBase64(questionBuffer)}` } },
            { type: "text", text: "STUDENT ANSWER SHEET IMAGE:" },
            { type: "image_url", image_url: { url: `data:${answerSheet.type};base64,${asBase64(answerBuffer)}` } },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`Groq request failed with status ${response.status}.`);
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const rawText = data.choices?.[0]?.message?.content || "";
  if (!rawText) throw new Error("Groq returned an empty response.");
  return normalizeAnalysis(extractJsonObject(rawText), "groq", "Groq vision fallback");
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const questionPaper = formData.get("questionPaper");
    const answerSheet = formData.get("answerSheet");

    if (!(questionPaper instanceof File) || !(answerSheet instanceof File)) {
      return NextResponse.json({ error: "Upload both a question paper and an answer sheet." }, { status: 400 });
    }

    if (questionPaper.size > 15_000_000 || answerSheet.size > 15_000_000) {
      return NextResponse.json({
        ...DEMO_ANALYSIS,
        note: "The file is larger than the serverless AI limit, so a demo mapping is shown. Compress the files and retry.",
      });
    }

    try {
      const geminiResult = await callGemini(questionPaper, answerSheet);
      if (geminiResult?.questions.length) return NextResponse.json(geminiResult);
    } catch {
      // The Groq branch below is intentionally a fallback; the UI still remains usable if both providers fail.
    }

    try {
      const groqResult = await callGroq(questionPaper, answerSheet);
      if (groqResult?.questions.length) return NextResponse.json(groqResult);
    } catch {
      // Fall through to a deterministic sample result so an API outage never strands the teacher.
    }

    return NextResponse.json({
      ...DEMO_ANALYSIS,
      note: "AI extraction was unavailable for this run, so the review is shown with a deterministic sample mapping.",
    });
  } catch {
    return NextResponse.json({
      ...DEMO_ANALYSIS,
      note: "The files could not be analyzed, so the review is shown with a deterministic sample mapping.",
    });
  }
}
