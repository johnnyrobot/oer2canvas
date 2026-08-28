# 01 — Import plain text into a Canvas cartridge

**What to build:** Let a user paste plain text or select a text file, supply the document title and rights information, preview the resulting page, run the existing accessibility review, and export the approved content as a Canvas cartridge. Introduce the source-neutral document path through this working tracer while preserving every existing publisher import.

**Blocked by:** None — can start immediately.

**Status:** resolved

- [x] A user can paste text or select a valid plain-text file entirely in the browser.
- [x] The import captures title, source attribution, and rights metadata before export.
- [x] Imported text reaches the existing compile, accessibility-review, planning, and cartridge-export workflow without a document-specific bypass.
- [x] Exported page bytes are the exact bytes that passed the accessibility gate.
- [x] Invalid encodings, empty input, cancellation, and oversized input produce clear recoverable outcomes.
- [x] Existing publisher-source behavior and regression tests remain green.

## Answer

Implemented the browser-only plain-text tracer for pasted text and UTF-8 `.txt` files. It creates
deterministic, escaped semantic HTML with source/rights provenance, previews parser findings and
the exact zero packaged-asset count, then converges at the shared `Chapter` compile/audit/review/
Plan/cartridge path. Cartridge pages use the audited gate HTML verbatim. Source replacement clears
all previously derived and exportable state, and validation failures remain focused and recoverable.

The 2 MiB limit is explicitly provisional for this tracer; issue 02 owns benchmark-selected
production budgets. Page splitting/editing remains in issue 10, and release-wide capability and
drag/drop hardening remains in issue 13.

Verification: TypeScript checks, 88 test files / 829 tests, production build, and built-bundle smoke
test all pass. The production build retains its pre-existing chunk-size warning.
