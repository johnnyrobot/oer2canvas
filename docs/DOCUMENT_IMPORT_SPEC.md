# Browser document import specification

Status: Proposed
Date: 2026-08-27
Owners: oer2canvas maintainers

## 1. Decision summary

oer2canvas will add a general document-import path while preserving the product's current
browser-first architecture.

- Uploaded files are parsed, normalized, remediated, audited, and packaged in the user's
  browser. Source bytes are not sent to oer2canvas or Cloudflare.
- `@firecrawl/anydoc-wasm` parses supported office documents and EPUB files in a dedicated Web
  Worker.
- `@firecrawl/pdf-inspector-wasm` classifies and extracts text-based PDFs in a dedicated Web
  Worker.
- Docling is not part of the design.
- A single public URL may optionally be acquired through Firecrawl. The user supplies a
  Firecrawl API key, and the browser sends it directly to Firecrawl. The key never passes through
  the oer2canvas relay and never enters browser storage.
- Existing OpenStax, LibreTexts, and Pressbooks importers remain unchanged. Document formats
  converge on the existing `Chapter`/`Section` compilation seam rather than creating a second
  remediation engine.
- Generated output remains an accessibility transformation aid, not an ADA, WCAG, or
  institutional certification.

The browser necessarily downloads JavaScript and WebAssembly as ordinary application assets.
The user does not install a desktop application, browser extension, runtime, or command-line
tool.

## 2. Problem

The current application can prepare chapters only from three known OER publishers. Instructors
also have source material as PDFs, EPUBs, Word documents, slide decks, OpenDocument files, rich
text, plain text, and web pages. They need to turn that material into the same Canvas-safe page
structure, run it through the same accessibility gate, answer the same human-review questions,
and download the same Canvas-flavoured Common Cartridge.

The import path must not create a document-processing backend. Cloudflare remains a static host
and a narrowly allowlisted byte relay for the existing publishers; it must not become a parser,
credential broker, arbitrary URL proxy, or content store.

## 3. Goals

1. Import supported files without uploading their bytes to oer2canvas infrastructure.
2. Preserve meaningful content and semantics while deliberately discarding source page layout.
3. Produce the same `Chapter`/`Section` input consumed by the existing compile, audit, review,
   plan, and cartridge modules.
4. Preserve headings, paragraphs, lists, tables, links, equations, notes, meaningful images, and
   image captions when the parser exposes them.
5. Package supported embedded images into the Canvas cartridge and verify that Canvas resolves
   them after import.
6. Surface extraction uncertainty before the accessibility review so a successful parse is never
   presented as proof of complete content.
7. Keep long-running conversion off the main thread, cancellable, and understandable to screen
   reader users.
8. Support optional single-URL acquisition without storing or proxying the user's Firecrawl key.
9. Preserve the current publication invariant: only content that has completed remediation,
   automated checks, and required human review can be exported.

## 4. Non-goals

- Pixel-perfect reproduction of a PDF page, Word layout, EPUB styling, slide, or spreadsheet.
- Browser-side OCR in the first release.
- Importing scanned or image-only PDFs in the first release.
- Docling deployment or integration.
- Whole-site crawling, link-following, sitemap ingestion, or authenticated-site crawling.
- A browser extension, desktop companion, or local daemon.
- Executing macros, scripts, embedded applications, animations, transitions, formulas, or active
  content from an uploaded document.
- Preserving source CSS as a layout system.
- Automatically declaring imported content ADA- or WCAG-compliant.
- Adding server-side accounts, content storage, queues, or usage metering.
- Uploading embedded assets during optional direct Canvas REST push in the first release. An
  imported selection that contains packaged assets is cartridge-only until that capability is
  separately implemented and verified.

## 5. Product principles

### 5.1 Reformat, do not reproduce

Source geometry is evidence used to recover reading order and semantics; it is not the output
template. The generated page uses the supplied Canvas guide and the existing oer2canvas compiler.

The importer may discard margins, columns, fonts, page coordinates, decorative backgrounds, and
slide positioning. It must not silently discard meaningful text, headings, list structure, table
relationships, equations, figures, captions, footnotes, or links.

### 5.2 Local by default

File parsing and all Canvas processing happen in the browser. Network use is limited to loading
normal application assets, existing publisher imports, explicitly requested external images, and
an explicitly requested Firecrawl URL acquisition.

### 5.3 Extraction is not remediation

The import report answers, "What did the parser recover and where is it uncertain?" The existing
review queue and accessibility gate answer, "What must be fixed or confirmed before publishing?"
These are separate concerns and separate interfaces.

### 5.4 Human-visible uncertainty

Unsupported, encrypted, malformed, resource-limited, OCR-dependent, or materially incomplete
content fails closed. Recoverable uncertainty is displayed with the affected page or section and
must not disappear into a console message.

## 6. Input support matrix

Any format is exposed as supported only after its fixture corpus passes the acceptance gates in
section 16. AnyDoc's advertised format support is a parser capability, not automatically an
oer2canvas product guarantee.

| Family | Extensions | Browser parser | Initial product level | Important limitations |
| --- | --- | --- | --- | --- |
| PDF | `.pdf` | PDF Inspector WASM | Supported for text-based PDFs | Scanned/image-only pages fail with named page numbers; complex reading order is warned |
| EPUB | `.epub` | AnyDoc WASM | Supported | DRM/encryption fails; source styling is discarded; embedded images require cartridge packaging |
| Modern Word | `.docx`, `.docm` | AnyDoc WASM | Supported after corpus gate | Macros are never executed; text boxes and elaborate pagination may flatten |
| OpenDocument text | `.odt` | AnyDoc WASM | Supported after corpus gate | Page styling and layout are not reproduced |
| Rich text | `.rtf` | AnyDoc WASM | Supported after corpus gate | Complex drawing/layout constructs may flatten |
| Presentations | `.pptx`, `.pptm`, `.ppsx`, `.ppsm`, `.odp` | AnyDoc WASM | Preview until corpus gate passes | Animations, transitions, positioning, charts, and visual relationships are not reproduced |
| Legacy Word/PowerPoint | `.doc`, `.ppt`, `.pps`, `.pot` | AnyDoc WASM | Deferred behind modern-format release | Older binary producers need a separate compatibility corpus |
| Spreadsheets | `.xlsx`, `.xlsm`, `.xlsb`, `.xls`, `.ods`, `.csv` | AnyDoc WASM | Deferred | Worksheet identity, table size, formulas, charts, and header intent require spreadsheet-specific UX |
| Plain text | `.txt` or paste | Native browser adapter | Supported | One page unless the user accepts proposed heading/delimiter splits |
| Markdown | `.md` or paste | GFM-to-HTML adapter | Supported | Raw HTML is treated as untrusted and passes through the existing allowlist |
| HTML | `.html`, `.htm` or paste | Inert DOM adapter | Supported | Scripts, forms, active content, unsafe URLs, and unsupported semantics are removed or blocked |
| Public URL | `https://…` | Firecrawl, user-funded | Optional single-page acquisition | Requires a user-supplied key; no crawling; Firecrawl's privacy and billing terms apply |

Google Docs, Google Slides, Apple Pages, and Keynote files are not native inputs. The user exports
them to a supported format first.

## 7. User workflow

The five-phase shell remains, but the user-facing label for the current `chapters` phase becomes
**Content**. The internal phase identifier does not need to change.

1. The user chooses the cartridge destination as today.
2. On Content, the user chooses one of:
   - Browse an OER publisher.
   - Upload a document.
   - Paste text, Markdown, or HTML.
   - Import one URL with Firecrawl.
3. The app parses the source and displays an import preview containing:
   - detected format and parser version;
   - source title and proposed Canvas page outline;
   - extraction warnings and blockers;
   - detected tables, equations, images, notes, and unavailable assets;
   - editable title, author, publisher/source, source URL, and license fields;
   - a required rights/permission acknowledgement before export;
   - controls to rename, exclude, split, or merge proposed pages.
4. The user confirms the page plan.
5. Confirmed pages enter the existing Review phase and existing compile/audit pipeline.
6. The Plan phase reports the exact Canvas page and packaged-asset counts.
7. The browser builds and downloads the cartridge.

Changing the source or importing a replacement clears the prior document, derived pages,
answers, compiled output, object URLs, and packaged assets. A stale import must never be combined
with a new source accidentally.

## 8. Page-formation policy

One uploaded file initially becomes one Canvas module (`Chapter`). Proposed Canvas pages are
formed as follows:

- EPUB, Word, OpenDocument text, RTF, Markdown, and HTML split at the highest heading level that
  appears as a repeated structural heading. A lone document title is not treated as a page split.
- PDF uses PDF Inspector's recovered headings and page markers. Physical PDF pages are not
  automatically Canvas pages. If no trustworthy heading structure is recovered, the import starts
  as one proposed Canvas page and the preview asks the user to split it.
- Presentations split at recovered slide-title headings when the parser exposes a reliable
  boundary. AnyDoc's public document model does not currently promise slide identity, so the first
  release must not claim one Canvas page per slide. Untitled or ambiguous runs remain together and
  are flagged in preview.
- Plain text starts as one page. The user may request splitting on blank-line delimiters or a
  recognized heading convention.
- Firecrawl single-page content starts as one module and one proposed Canvas page unless the
  returned headings clearly define sections and the user approves the proposed split.
- Spreadsheets receive no generic heading split. Their release requires worksheet-aware policy.

Every proposed page has a stable identifier derived from the source file hash plus its structural
path, not from its current array position. Renaming or excluding a sibling must not renumber other
pages and cause duplicate Canvas pages on a later import.

## 9. Metadata, attribution, and rights

Publisher imports continue using their existing attribution behavior. Imported documents use a
document-specific attribution policy.

Required before preparation:

- document/module title;
- a selection describing the user's authority to republish or adapt the content; and
- acknowledgement that the user is responsible for rights and final accessibility review.

Optional metadata:

- author or organization;
- publisher/source name;
- canonical source URL;
- license name and license URL.

The generated attribution block is always present. If no public source URL exists, the title is
plain text rather than a fabricated or dead link. If the license is unknown, the output states
that it was not supplied; it never implies an open license.

Firecrawl imports retain the requested canonical URL. The UI must not infer that publicly
reachable content is openly licensed.

## 10. Architecture

### 10.1 Existing seam

The existing publisher importers deliberately share no broad importer interface. They converge at
`Chapter`, and the document importer follows that rule.

```text
Publisher adapters ────────────────────────────────┐
                                                   │
File-specific adapters ─> ImportedWork ─> Chapter ─┼─> compileAndAuditChapter
Paste adapter ───────────> ImportedWork ─> Chapter ┤
Firecrawl adapter ────────> ImportedWork ─> Chapter ┘
```

`compileAndAuditChapter` remains the deep remediation module. Parser quirks, Web Worker messages,
Firecrawl response shapes, and asset-table management do not enter its public interface.

### 10.2 Document import module

The new `src/import/` module has three small caller-facing functions rather than one interface full
of optional parameters:

```ts
importFile(file: File, options: FileImportOptions): Promise<ImportResult>
importText(input: TextImportInput, options: TextImportOptions): Promise<ImportResult>
importUrl(input: UrlImportInput, firecrawl: FirecrawlPort, options: UrlImportOptions): Promise<ImportResult>
```

All three return data and produce no download, navigation, storage write, or UI side effect.
Progress and cancellation are optional interface behavior. The caller owns screen state.

The AnyDoc and PDF Inspector packages are true external dependencies. The module owns internal
parser ports with production WASM adapters and deterministic fake adapters for tests. Firecrawl is
a true external dependency behind an injected port with a browser-fetch adapter and a fake test
adapter.

### 10.3 Normalized result

```ts
type ImportedFormat =
  | 'pdf' | 'epub' | 'doc' | 'docx' | 'odt' | 'rtf'
  | 'ppt' | 'pptx' | 'odp'
  | 'xls' | 'xlsx' | 'ods' | 'csv'
  | 'text' | 'markdown' | 'html' | 'web'

interface ImportResult {
  work: ImportedWork
  report: ImportReport
}

interface ImportedWork {
  id: string
  title: string
  format: ImportedFormat
  sections: ImportedSection[]
  assets: ImportedAsset[]
  provenance: ImportProvenance
}

interface ImportedSection {
  id: string
  title: string
  order: number
  html: string
}

interface ImportedAsset {
  id: string
  mediaType: string
  extension: string
  bytes: Uint8Array
  sha256: string
  originPart?: string
}
```

`ImportedWork` deliberately contains semantic HTML instead of copying AnyDoc's complete AST into
the application domain. The format adapters own AST traversal, page splitting, image references,
and HTML rendering. This keeps vendor types behind the import module and lets the existing HTML
compiler remain the downstream seam.

### 10.4 Import report

```ts
type ImportFindingSeverity = 'warning' | 'blocker'

interface ImportFinding {
  code: string
  severity: ImportFindingSeverity
  message: string
  sectionId?: string
  sourcePage?: number
}

interface ImportReport {
  parser: 'native' | 'anydoc' | 'pdf-inspector' | 'firecrawl'
  parserVersion?: string
  format: ImportedFormat
  originalName?: string
  originalBytes?: number
  sourceUrl?: string
  sourceSha256?: string
  pageCount?: number
  findings: ImportFinding[]
  counts: {
    sections: number
    headings: number
    tables: number
    images: number
    equations: number
    notes: number
    unavailableAssets: number
  }
}
```

An import report blocker prevents preparation. A warning remains visible in preview and in the
Plan summary but is not silently converted into an accessibility pass.

### 10.5 Chapter model changes

Do not add every document extension to the publisher catalog type.

- Split the current source identifier into `PublisherSourceId` and `ContentSourceId`, where the
  latter adds `'document'`.
- `BookRef.source` remains `PublisherSourceId`.
- `Chapter.source` accepts `ContentSourceId`.
- `Section.contentBaseUrl`, `Section.canonicalUrl`, and `Attribution.url` become explicitly
  optional or are represented by a discriminated web/local provenance value. No synthetic URL is
  emitted to users.
- A document `PublisherProfile` describes the normalized HTML once. There is not one profile per
  file extension.
- A `Chapter` may carry deduplicated packaged assets referenced by its sections.

The absolutization and attribution steps must handle a local document without constructing a URL.
Uploaded relative links that cannot be resolved are findings, not guesses.

## 11. Format normalization

### 11.1 AnyDoc formats

Use `toDocument(bytes)` rather than converting to Markdown and parsing it back for non-PDF
formats. The renderer maps AnyDoc blocks and inlines to controlled semantic HTML:

- heading -> `h1` through `h6` before the existing heading-normalization step;
- paragraph and styled text -> `p`, `strong`, `em`, `del`, and `code`;
- lists -> nested `ol`/`ul`, preserving start and supported marker kinds;
- data tables -> `table` with spans and AnyDoc's leading header rows;
- layout tables -> linearized block content plus an import warning;
- block quotes -> `blockquote`;
- code blocks -> `pre`/`code`;
- inline/block math -> the delimiter representation expected by the existing math step;
- notes -> an endnotes section with stable backlinks;
- external and anchor links -> absolute URL or fragment links;
- relative links without a resolvable public base -> warning plus non-link text;
- asset images -> controlled packaged-asset references;
- unavailable images -> retained alt text plus a warning, never an empty fabricated image.

Speaker notes from presentations are included only when the preview says they are included. The
default is included because they may contain meaningful instructional content.

### 11.2 PDF

PDF Inspector runs detection first and extraction second.

- `TextBased` proceeds.
- `Scanned` and `ImageBased` fail with the exact pages requiring OCR.
- `Mixed` fails in the first release when any page needs OCR; partial extraction must not silently
  omit those pages.
- complex layouts, tables/columns, encoding issues, and low-confidence conditions become named
  findings.
- recovered Markdown is parsed through the controlled GFM adapter and then the normal semantic
  HTML path.

The app does not rasterize every PDF page into the Canvas output. Meaningful figures that PDF
Inspector cannot recover are a known completeness risk and must be represented in the PDF corpus
gate before PDF support is labeled stable.

### 11.3 Text, Markdown, and HTML

- Plain text is escaped before HTML creation.
- Markdown is parsed with raw HTML treated as untrusted input.
- HTML is parsed in an inert detached document.
- None of these paths insert untrusted markup into the live application document.
- All paths still pass through the current compiler and final allowlist.

### 11.4 Firecrawl URL acquisition

The browser calls `https://api.firecrawl.dev/v2/scrape` directly with the user's bearer key.
Initial requests use a deliberately small option surface: one HTTPS URL, main content, Markdown
output, bounded timeout, no caller-supplied headers or cookies, and no crawl.

The Firecrawl adapter returns content and provenance. It never returns or stores the key. The key
is held in a module-scoped variable for the current document lifetime, following the existing
Canvas-token pattern. It is not placed in React persistence, IndexedDB, `localStorage`,
`sessionStorage`, URLs, analytics, or error text.

The UI states that the URL and API key are sent directly to Firecrawl and that Firecrawl usage may
consume the user's credits. Clearing the key removes the in-memory value immediately.

## 12. Embedded assets and cartridge output

Embedded assets are the main extension to the current exporter.

### 12.1 Asset policy

- Deduplicate assets by SHA-256 bytes plus media type.
- Use deterministic archive paths such as `web_resources/<sha256>.<extension>`.
- Initially accept raster image MIME types that Canvas can render safely: PNG, JPEG, GIF, and
  WebP, subject to a real-Canvas import probe.
- SVG requires a separately reviewed sanitizer or rasterization path and is not accepted merely
  because its MIME type begins with `image/`.
- Embedded executables, scripts, macros, OLE payloads, and unknown binary objects are never
  emitted.
- Every missing, rejected, or unavailable meaningful asset becomes an import finding.

### 12.2 Canvas file references

Canvas course exports use the `$IMS-CC-FILEBASE$` substitution token for packaged course files.
The implementation will use only an exact, app-generated token plus a controlled archive path; it
will not accept a token copied from untrusted input.

Before implementation is considered complete, a small probe cartridge must prove in a real Canvas
sandbox:

1. the manifest shape that imports the image as a course file;
2. the HTML reference form Canvas rewrites correctly;
3. repeated use of one asset across pages;
4. image rendering after a second import of the same cartridge; and
5. the exact HTML Canvas stores after sanitization.

The probe result, not assumption, freezes the manifest implementation.

### 12.3 Audit parity

The final compiled HTML must remain byte-identical between the successful final gate and cartridge
export. Packaged-asset tokens therefore exist in compiled HTML before the final gate; the exporter
must not rewrite audited HTML afterward.

The allowlist gains a narrowly scoped rule for app-generated packaged-image paths. The audit frame
may resolve those tokens to object URLs solely as a rendering projection of the same packaged
bytes. That projection is an internal seam with explicit parity tests: only the URL resolution may
differ; element structure, attributes, text, dimensions, and asset bytes may not.

Object URLs are revoked after preview/audit and on cancellation. Assets remain in memory only as
long as the active import requires them.

## 13. Performance and offline behavior

- AnyDoc and PDF Inspector are dynamically imported only after the user selects a matching file.
- Their WASM files are excluded from the service worker install precache, like the existing local
  VLM runtime. They may be runtime-cached after the user first requests them.
- Parsing runs in a dedicated module Web Worker because both WASM interfaces are synchronous after
  initialization.
- Source `ArrayBuffer` ownership is transferred to the worker rather than copied.
- Only one file parses at a time in the first release.
- Every import exposes progress phases even when the parser cannot report byte-level progress:
  loading parser, reading file, parsing, forming pages, preparing assets, and ready.
- Cancel terminates the worker, revokes object URLs, clears partial results, and returns to an
  actionable screen.
- The app checks file size before allocating an `ArrayBuffer` and honors AnyDoc's
  `resourceLimit` error.
- The initial hard file-size and page-count budgets are constants selected by the Phase 0 browser
  benchmark. Candidate values must be tested on supported desktop and mobile-class devices rather
  than guessed into the release.

## 14. Privacy and security requirements

1. Uploaded bytes never reach the Worker, Firecrawl, analytics, logs, or another origin.
2. No imported source, derived HTML, asset, title, author, URL, or Firecrawl key is persisted by
   default.
3. All parser output is untrusted until it passes controlled rendering and the existing allowlist.
4. No active document content executes. Macros, scripts, forms, event handlers, external objects,
   and document relationships cannot cause browser execution or arbitrary file/network access.
5. Firecrawl accepts only an HTTPS public URL. The browser never supplies target-site cookies,
   arbitrary request headers, credentials embedded in URLs, or private-network destinations.
6. The existing `/relay` allowlist remains unchanged and must not accept Firecrawl requests or
   arbitrary document URLs.
7. Firecrawl keys are memory-only, redactable by construction, and absent from thrown messages.
8. A restrictive Content Security Policy must permit the required Worker/WASM execution and the
   direct Firecrawl endpoint without opening broad script or connection sources.
9. Imported SVG and HTML receive dedicated malicious fixtures.
10. Dependency versions are pinned by the lockfile and their MIT notices are added to
    `THIRD-PARTY-NOTICES.md`.

## 15. Accessibility requirements for the authoring workflow

- File selection supports both an accessible file input and drag/drop; drag/drop is never the only
  method.
- The accepted-format help text is programmatically associated with the input.
- Progress uses one polite live region and does not announce every internal parser event.
- Cancel is keyboard reachable and named for the active document.
- Import blockers receive focus when parsing ends unsuccessfully.
- The proposed page outline is operable by keyboard without relying on drag-only reordering.
- Rename, exclude, split, and merge actions have explicit accessible names and predictable focus
  restoration.
- Tables and images detected during import are summarized in text.
- Firecrawl key help identifies the destination and retention behavior before entry.
- Color is never the only distinction between warnings, blockers, selected pages, or parser state.
- Existing axe browser tests are extended across upload, preview, failure, Firecrawl-key, review,
  and result states.

## 16. Acceptance gates

### 16.1 Content fidelity

For every release-supported format, the committed fixture corpus must demonstrate:

- all expected paragraphs are present once and in reading order;
- headings form a valid hierarchy after compilation;
- nested lists and numbering remain understandable;
- data tables preserve cell text, spans, and known header rows;
- layout tables are not falsely emitted as accessible data tables;
- equations survive as accessible MathML through the existing math step;
- links and internal anchors remain meaningful;
- footnotes/endnotes remain reachable;
- meaningful images either render with the correct bytes or produce a visible blocker/warning;
- no macro, script, active object, or unsafe URL executes; and
- the final output passes the existing publication gate after required human answers.

### 16.2 Browser behavior

- The application shell remains interactive during parsing.
- Cancellation completes promptly and leaves no partial selection.
- A reload loses source bytes, derived content, and Firecrawl keys.
- Loading the initial application does not fetch either parser WASM asset.
- Selecting a non-PDF document does not fetch PDF Inspector, and selecting a PDF does not require
  AnyDoc.
- Built-artifact smoke tests exercise a real tiny AnyDoc fixture and a real tiny PDF fixture.

### 16.3 Canvas artifact

- The cartridge contains every referenced embedded asset exactly once.
- Every manifest and HTML reference points to an archive entry.
- No unreferenced source binary or active document payload is included.
- Canvas imports the pages, module order, images, alt text, captions, equations, and tables as
  expected.
- The HTML stored by Canvas after sanitization is manually reviewed against the audited preview.
- Reimport updates the same stable pages without duplicating them or breaking assets.

### 16.4 Firecrawl

- The key is sent only to `api.firecrawl.dev` in the `Authorization` header.
- Tests prove the key never reaches storage, the oer2canvas relay, thrown UI errors, or request
  URLs.
- A failed, invalid, rate-limited, or exhausted key yields actionable text without exposing it.
- URL import is optional; every file and paste path works when Firecrawl is unavailable.

## 17. Release boundaries

The first production release may expose only the formats whose corpus and Canvas probes have
passed. The UI must derive its accepted extensions from the same capability table used by tests so
documentation, file input, detection, and implementation cannot drift.

The following conditions block the entire feature from release:

- parser work occurs on the main thread;
- scanned/mixed PDFs can produce partial output without a blocker;
- imported image references are rewritten after the final audit;
- an embedded image is missing from the cartridge without a finding;
- a Firecrawl key is persisted or proxied;
- the Worker allowlist is widened for arbitrary URLs; or
- existing publisher and cartridge tests regress.

## 18. External references

- [AnyDoc browser/WASM interface](https://github.com/firecrawl/anydoc/blob/main/wasm/README.md)
- [AnyDoc supported formats and document model](https://github.com/firecrawl/anydoc)
- [PDF Inspector browser/WASM interface](https://github.com/firecrawl/pdf-inspector/blob/main/wasm/README.md)
- [Firecrawl scrape endpoint](https://docs.firecrawl.dev/api-reference/endpoint/scrape)
- [Firecrawl v2 authentication](https://docs.firecrawl.dev/api-reference/v2-introduction)
- [Canvas content export documentation](https://developerdocs.instructure.com/services/canvas/resources/content_exports)
- [Canvas `$IMS-CC-FILEBASE$` compatibility evidence](https://github.com/instructure/canvas-lms/issues/2376)
