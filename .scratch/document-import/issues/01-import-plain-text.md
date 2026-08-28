# 01 — Import plain text into a Canvas cartridge

**What to build:** Let a user paste plain text or select a text file, supply the document title and rights information, preview the resulting page, run the existing accessibility review, and export the approved content as a Canvas cartridge. Introduce the source-neutral document path through this working tracer while preserving every existing publisher import.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A user can paste text or select a valid plain-text file entirely in the browser.
- [ ] The import captures title, source attribution, and rights metadata before export.
- [ ] Imported text reaches the existing compile, accessibility-review, planning, and cartridge-export workflow without a document-specific bypass.
- [ ] Exported page bytes are the exact bytes that passed the accessibility gate.
- [ ] Invalid encodings, empty input, cancellation, and oversized input produce clear recoverable outcomes.
- [ ] Existing publisher-source behavior and regression tests remain green.
