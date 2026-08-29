# 11 — Import text-based PDFs and fail closed on OCR-dependent pages

**What to build:** Let a user import a text-based PDF locally, understand how well each page was extracted, adjust the proposed Canvas pages, and export only when the document can be remediated without unimplemented OCR or silent content loss.

**Blocked by:** 02 — Prove browser parser workers and establish import budgets; 05 — Import Markdown and HTML safely; 10 — Let users approve and edit the proposed page plan.

**Design:** [11-import-text-based-pdfs-design.md](../11-import-text-based-pdfs-design.md)

**Plan:** [11-import-text-based-pdfs-plan.md](../11-import-text-based-pdfs-plan.md)

**Status:** resolved

- [x] PDF parsing runs in the browser worker, honors budgets and cancellation, and never uploads the source file.
      — `src/import/workers/pdf-inspector.worker.ts`, `src/import/pdf.ts`. The page budget now runs
      on the classification rather than the result (`detectionBudgetFailure`, `probe.ts`), so an
      over-budget document is refused before any text is built. Pinned by
      `probe.test.ts` ("an over-budget pdf is refused before any text is extracted", which asserts
      the second phase was never requested) and `pdf.browser.test.ts` ("cancelling a pdf import
      stops the parse").
- [x] The import report classifies text-based, scanned, mixed, encrypted, malformed, and extraction-poor documents with page-specific evidence.
      — `src/import/pdf-findings.ts`; encrypted/malformed in `pdf-inspector.worker.ts`'s `failure()`.
      Pinned by `pdf-findings.test.ts` (11 cases) and `probe.browser.test.ts` ("encrypted and
      malformed pdfs keep their distinct, correctly retryable failures").
- [x] Extracted text reaches the shared safe semantic renderer and proposed-page workflow rather than a PDF-specific export path.
      — `src/import/pdf.ts` sanitizes each page slice through `sanitizeImportedMarkdown` and returns
      one section; nothing PDF-specific exists downstream. Pinned by `pdf.test.ts` ("a text-based pdf
      becomes one section of sanitized html with a page count").
- [x] Scanned or OCR-dependent pages block completion with a clear explanation that browser OCR is not supported in this release.
      — `pdf-ocr-required`, `severity: 'blocker'`. Pinned by
      `ImportPlanEditor.browser.test.tsx`, which asserts the confirm CONTROL is disabled rather than
      merely that a finding exists. **This criterion required work beyond the plan** — see the
      Answer below.
- [x] Reading-order uncertainty, missing text, and suspicious extraction produce visible findings rather than silent acceptance.
      — `pdf-reading-order`, `pdf-page-empty`, `pdf-figure-not-imported`, `pdf-encoding`, each naming
      its pages as ranges. Pinned by `pdf-findings.test.ts`.
- [x] Passing PDF fixtures complete accessibility review and cartridge export with audited-byte parity.
      — Pinned by `pdf.browser.test.ts` ("a text-based pdf exports the exact bytes the gate
      audited"), which drives the real compile+gate and `buildCartridge`, and asserts both that no
      page marker survives into audited bytes and that a cartridge entry contains those bytes
      verbatim.

## Answer

**The block/warn boundary, and why figures warn.** A figure on a page that extracted text warns and
leaves a visible `[Embedded image: Figure on page N]` mark; the page still publishes. For DOCX and
EPUB the image bytes exist, so refusing them is a real decision about real content — but
`PdfProcessResult` exposes no byte-bearing field at all, so a PDF figure can never become a Canvas
image and blocking would protect nobody while making PDF import useless. A page that is entirely an
image of text still blocks: there is nothing to import, and publishing it would ship a blank Canvas
page where a chapter section should be.

**Page provenance comes from reading marker numbers, never counting them.** A page that yields no
text emits no `<!-- Page N -->` marker at all, so a four-page document can emit markers 1, 2 and 4.
Every page number in every finding is read from a marker.

**Splitting happens before sanitization, which is what makes audited-byte parity structural.**
`sanitizeImportedHtml` deletes every HTML comment, so a marker could not survive it; rewriting one
into a surviving element would put a PDF-specific sentinel inside the bytes the gate audits and
`buildCartridge` publishes verbatim. Splitting first means no PDF-specific token ever exists in
gated bytes, so parity holds by construction rather than by a check.

**`detectPdf` moved the page budget ahead of the parse it exists to prevent.** The budget used to
run on the result — after every page had been parsed and Markdown built for all of them. The Worker
now classifies, reports, and stops until asked to extract. Measured cost of the second structural
pass, 200-page fixture: 19.6 of 178.1 ms in Chrome, 73 of 912 ms in Firefox, 24 of 194 ms in WebKit.

**`pagesNeedingOcr` does not name every scanned page, and this issue would have shipped a silent
content gap without a second signal.** Measured 2026-08-29: the module only populates that list once
the scanned fraction is high enough for it to classify the document `Mixed`. At one scanned page in
three it reports `TextBased` with an empty list, so a page that is an image of text was
indistinguishable from blank paper and would have published as a gap — the exact failure criterion 4
exists to prevent. The plan's stated measured fact generalised from a two-page document.

The fix invents no threshold: a page that emitted no marker is re-parsed ALONE with
`processPdf({ pages: [n] })`, where a blank page yields no image placeholder and a scanned page
yields one. It runs in the Worker, needs no new protocol message, costs 0.0–0.4 ms, and fails closed
when the re-parse throws. See the design's second 2026-08-29 amendment.

### Residuals

- **A construct straddling a physical page break is cut in two** — most plausibly a table continued
  across two sheets. Both halves render, and `layout.pagesWithTables` flags such a document. The
  alternative loses all page provenance.
- **Sanitizer findings are merged by code, first message winning**, so which page an
  `import-active-content-removed` came from is lost. `ImportPlanEditor` keys findings on `code` and
  duplicates would collide. The PDF-specific findings carry the page evidence instead.
- **`confidence` is carried as diagnostics and no decision is taken on it.** Measured 0–1, tracking
  the fraction of pages that produced text for a `TextBased` document; nothing upstream documents
  its scale.
- **Encrypted and malformed classification rests on matching English error messages.** Fixtures pin
  the actual messages against the pinned `parserVersion`, so an upstream wording change breaks a
  test rather than silently downgrading `encrypted` to a retryable failure.
- **Task 11 of the plan (labelling split points with their PDF page) was deferred by decision** and
  is not implemented. No acceptance criterion depends on it, and it was the only task that would
  have changed a public type.
- **Presentations, legacy DOC/PPT and spreadsheets are out of scope** and remain with issues 14–16.
