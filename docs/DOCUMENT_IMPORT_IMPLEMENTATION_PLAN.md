# Browser document import implementation plan

Status: Proposed
Date: 2026-08-27
Depends on: [Browser document import specification](DOCUMENT_IMPORT_SPEC.md)

## 1. Delivery strategy

Implement document import as a sequence of independently verifiable slices. Each slice must leave
the current publisher workflow and public cartridge-only deployment passing. Do not merge all
formats, Firecrawl, assets, and UI in one change.

The sequence is ordered by risk:

1. prove browser/runtime and Canvas asset assumptions;
2. create the normalized import module and worker protocol;
3. connect text-only document formats to the existing compile seam;
4. add embedded assets and verify Canvas import;
5. add PDF diagnostics;
6. add the authoring workflow;
7. add optional Firecrawl URL acquisition;
8. graduate additional formats through corpus gates.

## 2. Target module map

Proposed paths may change slightly during implementation, but the module ownership must remain.

```text
src/import/
  types.ts                   ImportedWork, assets, provenance, reports
  capability.ts              one format/extension capability table
  file.ts                    caller-facing file import interface
  text.ts                    caller-facing paste/text import interface
  url.ts                     caller-facing URL import interface
  to-chapter.ts              ImportedWork -> Chapter conversion
  metadata.ts                titles, attribution, rights state
  split.ts                   proposed page formation and stable ids
  render/
    anydoc-html.ts           AnyDoc document model -> controlled semantic HTML
    markdown-html.ts         PDF/Firecrawl/Markdown -> controlled semantic HTML
    packaged-assets.ts       asset references and archive paths
  parsers/
    ports.ts                 internal external-dependency ports
    anydoc-worker-client.ts  production AnyDoc adapter
    pdf-worker-client.ts     production PDF Inspector adapter
    firecrawl-client.ts      direct browser adapter
  workers/
    anydoc.worker.ts
    pdf-inspector.worker.ts
  fixtures/
    ...small redistributable documents and expected outcomes

src/components/import/
  ImportChooser.tsx
  FileImport.tsx
  TextImport.tsx
  UrlImport.tsx
  ImportProgress.tsx
  ImportPreview.tsx
  ImportFindings.tsx
  PageOutlineEditor.tsx
  ImportMetadata.tsx
```

The caller imports `file.ts`, `text.ts`, or `url.ts`; it does not import vendor WASM, Worker message
types, renderer internals, or Firecrawl response types.

## 3. Phase 0: feasibility probes and dependency pinning

### 3.1 Pin and inspect dependencies

- Add `@firecrawl/anydoc-wasm` and `@firecrawl/pdf-inspector-wasm` as production dependencies.
- Pin their resolved versions through `package-lock.json` and record their licenses.
- Select one actively maintained GFM parser with a browser build and no Node runtime dependency.
- Add the dependencies and licenses to `THIRD-PARTY-NOTICES.md`.
- Confirm Vite emits each WASM file as a hashed static asset and can construct both module Workers.
- Add parser WASM patterns to the PWA `globIgnores` list so an app install does not eagerly fetch
  them.
- Decide a runtime-cache name and bounded expiration for parser assets after first use.

Gate: a production build loads the application without requesting parser WASM, then successfully
loads the appropriate parser only after a test file is selected.

### 3.2 Browser performance probe

Create a development-only benchmark using representative small, medium, and large files. Record:

- input bytes;
- parser initialization time;
- parse time;
- peak browser memory where measurable;
- structured block and asset counts;
- time to terminate after cancellation; and
- output bytes.

Run current Chrome, Firefox, and Safari on at least one desktop-class and one mobile-class device.
Use the measurements to set:

- hard upload-byte limit;
- warning threshold;
- PDF page limit;
- maximum proposed-page count;
- maximum accepted embedded-asset bytes; and
- maximum individual asset bytes.

Gate: limits are committed as named constants with explanatory tests. They are not inferred from
Cloudflare limits because Cloudflare is not processing the file.

### 3.3 Canvas embedded-image probe

Build minimal probe cartridges without changing the production exporter. Each contains one page,
one image with alt text, and one shared-image variant. Test likely manifest/resource shapes and
the `$IMS-CC-FILEBASE$` reference against a real Canvas sandbox.

Record:

- import status;
- resulting course-file location;
- stored page HTML;
- rendered image URL and alt text;
- behavior after reimport; and
- behavior when two pages share the same asset.

Gate: check a short evidence note and the winning probe fixture into the repository. Production
asset work does not begin until this gate is resolved.

## 4. Phase 1: normalized import domain

### 4.1 Add types and invariants

Create `src/import/types.ts` with the spec's normalized types. Add invariants:

- work, section, and asset IDs are nonempty and deterministic;
- section order is contiguous after user exclusions;
- asset IDs resolve exactly one asset;
- asset MIME type and extension agree;
- hashes are lowercase SHA-256;
- no section HTML contains a dangling internal asset reference;
- report blocker codes are stable strings suitable for tests and UI mapping; and
- no type contains a Firecrawl key, `File`, object URL, Worker, or vendor document object.

The module interface returns results and does not mutate application state.

### 4.2 Separate publisher and content source identities

Update `src/sources/types.ts`:

- rename the current union to `PublisherSourceId`;
- add `ContentSourceId = PublisherSourceId | 'document'`;
- keep `BookRef.source` publisher-only;
- allow `Chapter.source` to be a content source;
- model web versus local provenance without fabricating a URL;
- allow chapters to own packaged assets.

Update `src/engine/compile/context.ts` with one `DOCUMENT` profile for normalized imported HTML.
Do not create profiles for PDF, EPUB, Word, or PowerPoint.

Update `absolutize` and `appendAttribution` so their behavior is explicit for local documents.
Existing publisher behavior and goldens must remain byte-for-byte unchanged.

### 4.3 Stable identity

Use `crypto.subtle.digest('SHA-256', bytes)` for the source fingerprint and assets. Derive page IDs
from the source fingerprint and stable structural path. Do not use display titles or array indexes
as the sole identity.

Tests:

- importing the same bytes twice produces the same page and asset IDs;
- renaming a page does not change its ID;
- excluding one page does not renumber siblings;
- identical embedded bytes deduplicate; and
- different bytes with the same original filename do not collide.

Gate: `npm run typecheck` and the full existing unit suite pass with no document UI yet.

## 5. Phase 2: Worker protocol and AnyDoc adapter

### 5.1 Worker protocol

Define a discriminated request/response protocol owned by the import module:

```ts
type ParseRequest = { kind: 'parse'; requestId: string; bytes: ArrayBuffer; formatHint?: string }
type ParseResponse =
  | { kind: 'ready'; requestId: string }
  | { kind: 'result'; requestId: string; document: SerializableAnyDocResult }
  | { kind: 'failure'; requestId: string; error: SerializedImportError }
```

Transfer the input buffer to the Worker. Do not clone it. Vendor objects must be converted into a
serializable internal shape before crossing back. `Uint8Array` asset buffers should also be
transferred when supported.

Cancellation terminates the active Worker rather than pretending a synchronous WASM call can be
interrupted. A later import receives a new Worker and request ID.

### 5.2 AnyDoc renderer

Implement exhaustive mapping from AnyDoc's public block/inline union to semantic HTML. Unknown
future block kinds fail visibly in development and become an unsupported-version failure in
production; they are not silently dropped.

Key tests cover:

- heading levels and anchors;
- nested lists and start values;
- text styles and inline code;
- external, internal, and unresolvable relative links;
- data and layout tables;
- row/column spans and header rows;
- inline and block math;
- footnotes/endnotes and backlinks;
- speaker notes;
- embedded, external, and unavailable images; and
- malicious strings in every text and URL position.

### 5.3 First text-document formats

Enable DOCX, ODT, RTF, and EPUB behind the capability table. Start with small fixtures that contain
every supported semantic shape. Add larger real-world fixtures only when their redistribution
rights are documented.

Gate: each enabled format produces deterministic `ImportedWork`, no parse runs on the main thread,
and all expected content survives into compiled HTML.

## 6. Phase 3: plain text, Markdown, and HTML

- Implement direct plain-text escaping.
- Implement Markdown through the selected GFM parser.
- Implement HTML through `DOMParser` in an inert detached document.
- Route all three through the same page splitter, metadata, import report, Chapter conversion, and
  existing compile/audit flow.
- Add paste and file fixtures containing hostile HTML, unsafe schemes, broken markup, deeply nested
  input, long unbroken text, Unicode, RTL text, CJK text, and equations.

Gate: raw input never enters the live DOM, and the final allowlist/gate has the same authority it
has for publisher content.

## 7. Phase 4: page formation and import preview

### 7.1 Page splitter

Implement the page-formation policy as a pure module. It accepts normalized sections/HTML and
returns a proposed page plan. It does not read UI state.

Tests pin:

- document-title versus repeated structural heading behavior;
- no-heading fallback;
- stable IDs across rename/exclusion;
- heading hierarchy retained inside each page;
- deterministic split/merge behavior; and
- maximum-page budget failure.

### 7.2 UI integration

Add an import chooser to `SourceBrowser` without changing the existing publisher cards. Change the
visible phase label from Chapters to Content while retaining the internal phase identifier.

Add file, paste, and preview screens. Integrate their confirmed result with the same prepared
chapter state used today. Avoid adding format-specific branches to `compileAndAuditChapter` or the
review queue.

The preview must support:

- page rename;
- include/exclude;
- keyboard-operable reordering if ordering is editable;
- split and merge at supported structural points;
- metadata entry;
- rights acknowledgement;
- warning/blocker navigation; and
- replacement/clear source.

Add reducer/pure-state tests for the editor separately from React rendering tests.

Gate: an instructor can upload a fixture, approve its pages, complete existing queue items, reach
Plan, and download a text-only cartridge entirely through a browser test.

## 8. Phase 5: embedded assets and audit parity

### 8.1 Asset registry

Implement the hash-based asset registry and exact MIME allowlist. Reject or warn on unsupported
payloads. Object URLs belong to a preview/audit resolver, never to `ImportedWork` or compiled HTML.

### 8.2 Compiler and allowlist integration

- Add a narrowly scoped packaged-asset reference recognized only when generated from a registered
  asset.
- Ensure `absolutize` does not rewrite the token.
- Extend the allowlist to accept only the proven token/path form for supported media elements.
- Teach the audit frame to project registered packaged paths to object URLs while retaining final
  compiled markup as the authoritative bytes.
- Add parity tests that fail if anything besides URL resolution changes.

### 8.3 Exporter

Extend `buildManifest` and `buildCartridge` according to the successful Canvas probe:

- add deterministic asset entries;
- write each deduplicated binary exactly once;
- include required manifest declarations;
- retain `CompiledSection.html` verbatim;
- verify every packaged reference resolves and every emitted asset is referenced; and
- report asset count and total bytes in Plan.

Update `writeZip` tests with binary fixtures and duplicate assets. Confirm CRC and byte preservation
for non-text entries.

### 8.4 Optional direct push

In the first release, `buildPlan` adds a blocker when the destination is direct Canvas push and an
imported selection contains packaged assets. Text-only imported selections may use the current
push path if every other gate passes.

A later plan may add Canvas Files upload, stable file matching, URL rewriting, rollback, required
scopes, and live verification. Do not smuggle that work into the cartridge slice.

Gate: the generated cartridge passes structural tests and the real-Canvas image acceptance gate.

## 9. Phase 6: PDF Inspector

- Add a dedicated PDF Worker so selecting a PDF does not load AnyDoc.
- Run detection/classification before extraction.
- Serialize parser type, version, page count, OCR pages, encoding issues, complex-layout indicators,
  and recovered Markdown into the import result/report.
- Treat any OCR-required page as a blocker in the first release.
- Convert extracted Markdown through the controlled Markdown adapter.
- Preserve page markers internally for provenance without turning every physical page into a
  Canvas page.
- Add a visible warning when figures or complex layout cannot be proven complete.

Corpus groups:

- simple born-digital prose;
- two-column prose;
- headings and lists;
- data tables;
- math/STEM;
- CJK and RTL;
- scanned;
- mixed scanned/text;
- broken encoding;
- encrypted; and
- malformed/resource-limit fixtures.

Gate: only the PDF groups meeting the content-fidelity requirements receive a stable support label.
Everything else fails closed or remains preview support.

## 10. Phase 7: optional Firecrawl acquisition

### 10.1 Credential store

Create a Firecrawl credential holder modeled on `src/canvas/credentials.ts`, but with no persistent
non-secret fields required. The key is module-scoped memory only. Add tests proving a new holder
after reload cannot recover it and `forget()` clears it.

### 10.2 Firecrawl port and adapter

Define the internal `FirecrawlPort` around the one operation the product uses: acquire one public
URL as main-content Markdown plus canonical metadata. The production adapter uses direct browser
`fetch`; tests use a fake.

The adapter:

- accepts only HTTPS;
- refuses URL credentials and known private/reserved destinations before calling Firecrawl;
- sets the key only in the `Authorization` header;
- sends no target-site headers or cookies;
- requests one page, not crawl/map/search;
- uses a bounded timeout and `AbortSignal`;
- maps 401, 402/credit, 408/timeout, 429, and 5xx responses to stable safe errors;
- omits response bodies from credential-related UI errors; and
- never calls `/relay`.

### 10.3 URL UI and disclosure

Before the key field, explain:

- the browser sends the key and URL directly to Firecrawl;
- oer2canvas does not receive or store the key;
- the request may consume Firecrawl credits; and
- Firecrawl's own data handling terms apply.

Include a visible Forget key control whenever a key is held. Do not offer "remember me."

Gate: mocked browser tests prove destination, headers, redaction, cancellation, storage absence,
and no dependency of file imports on Firecrawl.

## 11. Phase 8: presentation and legacy-format graduation

Run PPTX/PPTM/PPSX/PPSM and ODP through a presentation-specific corpus before marking them stable.
The corpus covers titled and untitled slides, multiple text boxes, tables, images, speaker notes,
internal slide links, equations, charts, SmartArt/diagrams, and reading order.

Because AnyDoc's current public model does not guarantee explicit slide boundaries, do not promise
one Canvas page per slide unless a tested parser version exposes that identity. Otherwise split on
reliable slide-title headings and make ambiguity visible in preview.

Legacy DOC/PPT formats receive a separate corpus. Do not infer their quality from DOCX/PPTX.

Gate: product copy names what is retained and what is flattened; unsupported visual relationships
produce findings rather than disappearing silently.

## 12. Phase 9: spreadsheet decision

AnyDoc can parse spreadsheet families, but parsing alone does not define an accessible Canvas
experience. Before enabling them, decide and test:

- worksheet identity and ordering;
- whether each worksheet becomes a page;
- header-row and header-column selection;
- merged cells;
- blank spacer rows/columns;
- formulas versus displayed values;
- charts and named ranges;
- maximum rows/columns per Canvas table; and
- whether large data belongs in a Canvas page at all.

If AnyDoc's public document model still omits worksheet identity or cell provenance, keep
spreadsheets disabled rather than inventing structure. CSV may ship separately with explicit header
selection.

## 13. Test plan

### 13.1 Unit tests

- capability table and content detection;
- normalized-type invariants;
- source and asset hashing;
- AnyDoc AST renderer;
- Markdown and HTML adapters;
- page splitting and editing;
- report/error mapping;
- metadata and attribution;
- Firecrawl request and redaction;
- packaged-asset reference validation;
- manifest and ZIP assets; and
- Plan blockers and summaries.

### 13.2 Browser tests

- real Worker initialization and transferable buffers;
- real tiny AnyDoc and PDF conversions;
- cancellation and replacement;
- parser lazy loading;
- object URL lifecycle;
- import chooser/preview keyboard workflow;
- axe coverage for all import states;
- compile/review/plan/export end to end; and
- reload privacy behavior.

### 13.3 Security fixtures

- ZIP/decompression bomb or AnyDoc resource-limit fixture;
- encrypted office and EPUB containers;
- macro-enabled inputs proving macros do not execute;
- malicious SVG;
- HTML scripts, event handlers, forms, iframes, unsafe URL schemes, and CSS overlays;
- external relationships to private networks and file URLs;
- malformed nested documents; and
- filenames, titles, authors, and alt text containing markup and path traversal.

### 13.4 Artifact and live tests

- extend `scripts/smoke-dist.mjs` to exercise one real browser import and cartridge build;
- inspect built output for lazily emitted WASM and Worker assets;
- extend production verification without uploading a document;
- build deterministic probe cartridges in CI; and
- run the documented Canvas import probe before release candidates.

Every implementation slice runs:

```sh
npm run typecheck
npm test
npm run build
npm run test:dist
```

## 14. Documentation and policy updates

Before release, update:

- `README.md`: supported formats, local processing, scanned-PDF limitation, and optional Firecrawl;
- `PRIVACY.md`: uploaded bytes stay in-browser; explicit Firecrawl exception and key lifecycle;
- `SECURITY.md`: parser trust model, asset policy, Firecrawl destination, and unchanged relay;
- `ACCESSIBILITY.md`: import uncertainty and required source-fidelity review;
- `THIRD-PARTY-NOTICES.md`: AnyDoc, PDF Inspector, and the selected Markdown parser;
- `docs/OPERATIONS.md`: parser asset deployment checks and Firecrawl CORS availability; and
- user-facing accepted-format and limitation help.

Do not advertise a format until its capability flag and corpus gate are enabled in the same change.

## 15. Rollout and observability without telemetry

The project has no analytics, so release confidence comes from deterministic local diagnostics and
opt-in bug reports.

- Include a copyable import report with parser version, format, counts, finding codes, and source
  hash prefix, but no source content, key, full local path, or private URL query.
- Add a feature flag or capability flag per format so a failing parser version can disable one
  family without removing document import.
- Keep the old publisher flow available throughout rollout.
- Start with text, DOCX/ODT/RTF, and EPUB after their gates; graduate PDF and presentations only
  after their own gates.
- Provide a documented downgrade path for parser versions in the lockfile.

## 16. File-by-file change forecast

Expected existing-file changes:

| Existing file/module | Planned change |
| --- | --- |
| `package.json`, `package-lock.json` | Add pinned browser parsers and GFM parser |
| `vite.config.ts` | Lazy Worker/WASM build and PWA cache exclusions/runtime cache |
| `src/sources/types.ts` | Publisher/content source split, optional local provenance, packaged assets |
| `src/engine/compile/context.ts` | One normalized document profile |
| `src/engine/compile/steps/absolutize.ts` | Explicit local/protected packaged-path behavior |
| `src/engine/compile/steps/attribution.ts` | Non-link attribution for local sources |
| `src/engine/allowlist.ts` | Narrow app-generated packaged-media path support |
| `src/engine/audit/iframe-runner.ts` | Internal asset render projection |
| `src/engine/index.ts` | Pass imported asset context without exposing parser details |
| `src/contracts/index.ts` | Import-resource/report references only if required downstream |
| `src/engine/export/cartridge.ts` | Manifest and binary asset entries, verbatim HTML retained |
| `src/engine/export/zip.ts` | Verify binary/deduplicated entries; implementation may remain unchanged |
| `src/shell/phases.ts` | User-facing Content label and import-aware counts/reasons |
| `src/shell/plan.ts` | Asset counts and direct-push blocker |
| `src/App.tsx` | Orchestrate import state and hand confirmed chapters to existing preparation |
| `src/components/SourceBrowser.tsx` | Add upload, paste, and URL acquisition choices |
| policy/project Markdown files | Document behavior, privacy, security, accessibility, and licenses |

## 17. Completion definition

The feature is complete when:

1. release-enabled document formats parse in a Worker and source bytes remain in-browser;
2. users can inspect and edit the proposed Canvas page plan;
3. normalized content passes through the existing compiler, queue, audit, and publication gate;
4. embedded supported images survive into and through a real Canvas cartridge import;
5. unsupported or uncertain content produces explicit findings and required blockers;
6. scanned/mixed PDFs cannot silently publish partial text;
7. Firecrawl is optional, direct, user-funded, memory-only, and isolated from the Worker relay;
8. existing publisher workflows remain unchanged and fully tested;
9. privacy, security, accessibility, and third-party notices match the implementation; and
10. all standard verification commands and the real-Canvas artifact probe pass.
