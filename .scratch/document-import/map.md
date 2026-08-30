# Document import map

**Frontier:** 16 — Decide spreadsheet imports.

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
| [16 — Decide spreadsheet imports](issues/16-decide-spreadsheet-imports.md) | ready-for-agent | 13 |
| [17 — Extract web articles self-hosted](issues/17-extract-web-articles-self-hosted.md) | ready-for-agent | 12 |

**Carried forward from 14, with no issue of its own yet.** A deck refused for an unpackageable
image lands in the plan editor with a disabled Prepare button, while a deck refused by the
reconciler throws back to the file picker — two different screens for "this file cannot be
imported", not explained to the user anywhere. It became more visible in 14, because a real
Impress chart takes exactly the first path (its GDI metafile preview cannot be packaged).
