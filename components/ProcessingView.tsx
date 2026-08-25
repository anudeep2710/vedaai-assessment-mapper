"use client";

import { Sparkles } from "lucide-react";

export function ProcessingView({ progress }: { progress: number }) {
  return (
    <section className="processing-view" aria-live="polite">
      <div className="processing-stars" aria-hidden="true">
        <Sparkles size={56} strokeWidth={1.45} />
      </div>
      <h1>Extracting<span>...</span></h1>
      <p>Reading question order, answers, and regions</p>
      <div className="processing-progress" aria-label={`${progress}% complete`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <div className="processing-steps">
        <span className={progress >= 35 ? "is-done" : ""}>Question order</span>
        <span className={progress >= 56 ? "is-done" : ""}>Answer regions</span>
        <span className={progress >= 76 ? "is-done" : ""}>Mapping</span>
        <span className={progress >= 90 ? "is-done" : ""}>Review</span>
      </div>
    </section>
  );
}
