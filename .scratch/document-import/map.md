# Document import map

**Frontier:** 15 — Evaluate legacy DOC/PPT.

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
| [15 — Evaluate legacy DOC/PPT](issues/15-evaluate-legacy-doc-ppt.md) | ready-for-agent | 13, 14 |
| [16 — Decide spreadsheet imports](issues/16-decide-spreadsheet-imports.md) | ready-for-agent | 13 |
| [17 — Extract web articles self-hosted](issues/17-extract-web-articles-self-hosted.md) | ready-for-agent | 12 |
| [18 — Attribute imported charts](issues/18-attribute-imported-charts.md) | ready-for-agent | 14 |
| [19 — Commit the real-deck harness](issues/19-commit-real-deck-harness.md) | ready-for-agent | 14 |
| [20 — One account of refusal](issues/20-one-account-of-refusal.md) | ready-for-agent | 13, 14 |

**What 14 left behind, now filed.** Issue 18 carries its largest remaining refusal — an
inserted chart — and commits to the identity join rather than to predicting anydoc's
rendering, which is the class of rule that produced eleven silent misattributions there.
Issue 19 commits the harness that found 14's two worst defects after 1,537 synthetic tests
had passed; it is the least reproducible thing that issue learned. Issue 20 promotes what was
a dangling note here into work: a refused import currently gets two unrelated screens
depending on which layer refused it.
