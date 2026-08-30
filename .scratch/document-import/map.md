# Document import map

**Frontier:** 18 — Stop publishing content the author hid.

| Issue | Status | Blocked by |
| --- | --- | --- |
| [01 — Import plain text](issues/01-import-plain-text.md) | resolved | — |
| [02 — Prove browser parser workers](issues/02-prove-browser-parser-workers.md) | resolved | — |
| [03 — Import text-only DOCX](issues/03-import-text-only-docx.md) | resolved | 01, 02 |
| [04 — Enable EPUB, ODT, and RTF](issues/04-enable-epub-odt-rtf.md) | resolved | 03 |
| [05 — Import Markdown and HTML safely](issues/05-import-markdown-html-safely.md) | resolved | 01 |
| [06 — Generate Canvas image probes](issues/06-generate-canvas-image-probes.md) | resolved | — |
| [07 — Validate images in Canvas](issues/07-validate-images-in-canvas.md) | resolved | 06 |
| [08 — Ship embedded-image tracer](issues/08-ship-embedded-image-tracer.md) | resolved | 04, 07 |
| [09 — Harden packaged assets](issues/09-harden-packaged-assets.md) | resolved | 08 |
| [10 — Edit proposed page plan](issues/10-edit-proposed-page-plan.md) | resolved | 01, 04, 05 |
| [11 — Import text-based PDFs](issues/11-import-text-based-pdfs.md) | resolved | 02, 05, 10 |
| [12 — Import URL with Firecrawl](issues/12-import-url-with-firecrawl.md) | resolved | 05, 10 |
| [13 — Release core document importer](issues/13-release-core-document-importer.md) | resolved | 09, 10, 11, 12 |
| [14 — Graduate presentations](issues/14-graduate-presentations.md) | resolved (PPTX and ODP enabled) | 04, 09, 10 |
| [15 — Evaluate legacy DOC/PPT](issues/15-evaluate-legacy-doc-ppt.md) | resolved (DOC and PPT both disabled) | 13, 14 |
| [16 — Decide spreadsheet imports](issues/16-decide-spreadsheet-imports.md) | resolved (all four formats disabled) | 13 |
| [17 — Extract web articles self-hosted](issues/17-extract-web-articles-self-hosted.md) | resolved | 12 |
| [18 — Stop publishing hidden content](issues/18-stop-publishing-hidden-content.md) | ready-for-agent | — |
| [19 — One refusal, one screen](issues/19-one-refusal-one-screen.md) | ready-for-agent | — |
| [20 — Surface or remove `retryable`](issues/20-surface-or-remove-retryable.md) | ready-for-agent | — |
| [21 — State the PDF text ceiling](issues/21-state-the-pdf-text-ceiling.md) | ready-for-agent | — |

**Everything once carried here now has an issue.** The two-screens refusal carried from 14 is
issue 19; issue 13's `retryable` residual is issue 20 and its PDF-ceiling residual is issue 21;
the hidden-content behaviour issue 15 found in an enabled format is issue 18. Issues 18-21 were
filed 2026-08-30, and each was re-verified against the tree that day rather than trusted from the
note that recorded it.

**Still carried, with no issue.** `docs/RELEASE-ACCEPTANCE.md` §3 — the screen-reader pass — has
never been run, and cannot be run by a tool. `scripts/screen-reader-worksheet.mjs` prints what a
screen reader reaches so the pass is a confirmation rather than an exploration, but the judgement
it exists to make is a human's.
