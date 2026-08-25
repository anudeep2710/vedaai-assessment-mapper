# Hard extraction fixture

Upload these two files together in the assessment mapper:

- `tough-question-paper.pdf` - a three-page printed paper with 19 extractable question entries, including labelled sub-parts.
- `tough-answer-sheet.pdf` - a four-page blue-ink answer sheet with answers deliberately written out of order.

The same pages are also available as PNG files for image-upload testing.

Expected edge cases:

- `2 (a)` continues from answer-sheet page 1 to page 2.
- `2 (b)`, `6 (b) (ii)`, `9`, and `11 (b)` are unanswered.
- `Q13` is an answer with no matching printed question.
- Sub-parts such as `4 (a)` and `4 (b)` must remain separate entries.
- `Q8` contains a diagram rather than only prose.
- The answer order differs from the printed question order.

Use `expected-answer-mapping.json` as the ground-truth manifest for a manual check of question status, page number, and normalized answer regions.
