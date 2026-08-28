# 03 — Import a text-only DOCX end to end

**What to build:** Let a user select a text-oriented DOCX, parse it locally through the browser worker, convert its document structure into safe semantic pages, inspect import findings, and complete the normal accessibility-review and cartridge-export workflow.

**Blocked by:** 01 — Import plain text into a Canvas cartridge; 02 — Prove browser parser workers and establish import budgets.

**Status:** ready-for-agent

- [ ] Format detection validates file content and does not rely solely on the filename extension or MIME type.
- [ ] Headings, paragraphs, lists, links, and simple tables retain document order and meaningful semantics for the approved fixture corpus.
- [ ] Parsing occurs in a cancellable browser worker and obeys the established import budgets.
- [ ] Unsupported or embedded content creates visible findings instead of disappearing silently.
- [ ] The preview, accessibility audit, plan, and exported cartridge all use the shared document-import path.
- [ ] Text-only DOCX fixtures complete the workflow without any server-side parsing or document upload.
