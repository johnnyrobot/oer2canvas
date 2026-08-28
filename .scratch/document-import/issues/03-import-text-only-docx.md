# 03 — Import a text-only DOCX end to end

**What to build:** Let a user select a text-oriented DOCX, parse it locally through the browser worker, convert its document structure into safe semantic pages, inspect import findings, and complete the normal accessibility-review and cartridge-export workflow.

**Blocked by:** 01 — Import plain text into a Canvas cartridge; 02 — Prove browser parser workers and establish import budgets.

**Status:** resolved

- [x] Format detection validates file content and does not rely solely on the filename extension or MIME type.
- [x] Headings, paragraphs, lists, links, and simple tables retain document order and meaningful semantics for the approved fixture corpus.
- [x] Parsing occurs in a cancellable browser worker and obeys the established import budgets.
- [x] Unsupported or embedded content creates visible findings instead of disappearing silently.
- [x] The preview, accessibility audit, plan, and exported cartridge all use the shared document-import path.
- [x] Text-only DOCX fixtures complete the workflow without any server-side parsing or document upload.

## Answer

Implemented release-enabled, text-oriented DOCX import for desktop Chrome and Firefox. DOCX bytes
are content-signature checked, hashed locally, transferred to a fresh cancellable AnyDoc WebAssembly
Worker, and converted from the AnyDoc model into controlled semantic HTML. The approved corpus
preserves ordered headings, paragraphs, styled text, external and internal links, lists, and data
tables. Layout tables are linearized with a warning; embedded images, equations, notes, and other
recognized-but-unsupported content become visible blockers rather than disappearing. A future
AnyDoc document-model kind fails explicitly as an unsupported parser version.

The accessible Word-document form captures the shared attribution and rights metadata, reports
progress and recoverable errors, summarizes extraction counts/findings, and prevents preparation
when blockers exist. Recoverable warnings remain visible in Plan. Confirmed imports converge at the
existing `Chapter` compile, accessibility gate, Review, Plan, and Common Cartridge writer; no source
bytes or derived output are uploaded or persisted.

Verification: TypeScript checks, 97 test files / 860 tests, production build, and built-bundle smoke
test all pass. The built smoke loads parser assets only on demand, drives a real DOCX through the UI
to a downloaded cartridge, and unzips the artifact to inspect its semantic page bytes. The production
build retains its pre-existing chunk-size warning.
