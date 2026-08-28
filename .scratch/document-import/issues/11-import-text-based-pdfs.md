# 11 — Import text-based PDFs and fail closed on OCR-dependent pages

**What to build:** Let a user import a text-based PDF locally, understand how well each page was extracted, adjust the proposed Canvas pages, and export only when the document can be remediated without unimplemented OCR or silent content loss.

**Blocked by:** 02 — Prove browser parser workers and establish import budgets; 05 — Import Markdown and HTML safely; 10 — Let users approve and edit the proposed page plan.

**Status:** ready-for-agent

- [ ] PDF parsing runs in the browser worker, honors budgets and cancellation, and never uploads the source file.
- [ ] The import report classifies text-based, scanned, mixed, encrypted, malformed, and extraction-poor documents with page-specific evidence.
- [ ] Extracted text reaches the shared safe semantic renderer and proposed-page workflow rather than a PDF-specific export path.
- [ ] Scanned or OCR-dependent pages block completion with a clear explanation that browser OCR is not supported in this release.
- [ ] Reading-order uncertainty, missing text, and suspicious extraction produce visible findings rather than silent acceptance.
- [ ] Passing PDF fixtures complete accessibility review and cartridge export with audited-byte parity.
