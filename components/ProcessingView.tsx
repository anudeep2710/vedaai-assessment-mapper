"use client";

import Image from "next/image";

export function ProcessingView({ progress }: { progress: number }) {
  return (
    <section className="processing-view" aria-live="polite">
      <div className="processing-stars" aria-hidden="true">
        <Image src="/extracting-stars.svg" alt="" width={129} height={135} priority />
      </div>
      <h1>Extracting<span>...</span></h1>
      <p>This may take a while</p>
      <div className="processing-progress" role="progressbar" aria-label="Extraction progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
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
