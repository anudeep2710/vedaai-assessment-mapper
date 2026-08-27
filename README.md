# VedaAI Assessment Mapper

An assessment review workspace for extracting printed questions, locating handwritten answers, and reviewing per-question marks and feedback.

## What is included

- Upload a question paper and one student answer sheet as PDF or image files.
- Processing state with extraction progress.
- Printed-order question list with labelled sub-parts preserved as separate entries.
- Answer mapping for answers written out of order, unanswered questions, and unmatched writing.
- Normalized answer-region overlays on a notebook-style answer sheet viewer.
- Gemini extraction with Groq vision fallback.
- Responsive desktop/mobile layout based on the provided VedaAI reference screens.

## Local setup

```bash
npm install
copy .env.example .env.local
npm run dev
```

Add `GEMINI_API_KEY` to `.env.local` for live extraction. `GROQ_API_KEY` is optional and is used for image-only fallback requests. Both keys are server-only.

The app does not need a database for this assignment: files are processed in memory and the review state lives in the browser.

## Important limitation

AI region coordinates are only as accurate as the model's document vision response. When both providers are unavailable, the app keeps the uploaded files attached and shows a retryable error instead of presenting fabricated grading data.
