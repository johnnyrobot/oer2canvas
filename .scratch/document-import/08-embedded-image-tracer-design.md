# Embedded-image import tracer — design

Design for document-import issue 08. Lets a user import a structured document containing raster
images, preview and audit those images as part of the remediated page, and export a cartridge that
renders them after Canvas import using the packaging validated in issue 07.

## What issue 07 settled

These are measured facts, not assumptions, from
[`docs/evidence/canvas-image-probes-2026-08-28.md`](../../docs/evidence/canvas-image-probes-2026-08-28.md):

- A packaged asset must be a standalone `<resource type="webcontent">` whose `href` and `<file>`
  both name the archive path. Page-owned `<file>` children and `associatedcontent` **fail** — Canvas
  reports the import as completed and attaches no course files at all.
- Page `<dependency>` elements are optional and changed nothing on any measured dimension.
- Canvas emits `$IMS-CC-FILEBASE$/<path relative to `web_resources/`>`. It also accepts the
  archive-root form, but production emits the form Canvas itself emits.
- Canvas strips `web_resources/` when placing files: `web_resources/probe/x.png` becomes
  `course files/probe/x.png`.
- Canvas does **not** deduplicate byte-identical files, but one asset referenced by two pages
  resolves to a single Canvas File and stays single through a course copy.
- PNG, JPEG, GIF and WebP each render, decided individually.

## Decisions

| Decision | Choice |
| --- | --- |
| Media types unblocked | PNG, JPEG, GIF, WebP — all four validated in issue 07 |
| Formats unblocked | EPUB, DOCX, ODT, RTF — the whole shared anydoc path |
| Images that cannot be packaged | Keep today's `embedded-content` blocker |
| Asset naming | Readable slug from `originPart` + short sha256 suffix; dedupe by sha256 |
| Reference form | `$IMS-CC-FILEBASE$/oer2canvas/<name>` in the gated bytes |
| Audit surface | Sees the token unresolved; layout carried by `width`/`height` |

Unblocking all four media types and all four formats deliberately takes scope that issue 09
(*Harden packaged assets*) might otherwise have carried. Concretely, this design satisfies four of
issue 09's seven criteria — content-hash identity, consistent raster support with safe failure, blob
revocation, and one asset shared across pages without duplicate payloads — and takes its
direct-push criterion as well, because issue 08 is what creates that hazard. Issue 09 has been
rescoped to what genuinely remains rather than left to become a stub. Issue 07 measured each media type
individually and the four formats share one parser and one image code path, so gating a subset would
mean adding conditionals to hold back paths already proven to work.

## Why the token lives in the gated bytes

Issue 08 requires that *the exact HTML bytes that passed the gate are written into the cartridge
without post-audit rewriting*. `auditedHtml()` returns `section.gate?.html ?? section.html` and
`buildCartridge` writes those bytes verbatim, so the Canvas-bound reference must already be present
before the gate runs. That rules out carrying a `blob:` URL through the gate and rewriting it at
export.

It leaves one tension. `absolutize.ts` exists because *"unresolved they 404 in the audit frame, so
the audited layout is not the published layout"* — this codebase deliberately makes images resolve
during audit, for layout fidelity. A `$IMS-CC-FILEBASE$` token cannot resolve in the audit frame.

The resolution is to carry intrinsic `width`/`height` on every packaged image, decoded from the
image header at import. The audit frame then reserves the true box without fetching anything, so
audited layout still matches published layout, and the audited bytes stay literally identical to the
cartridge bytes. `collectImages` reads only attributes (`alt`, `src`, `role`, `aria-hidden`) and
axe's alt checks need no pixels, so nothing in the audit actually requires the image to load.

The rejected alternative was resolving the token to a blob inside the audit frame. It saves the
header decoder but trades the invariant `iframe-runner.ts` is built around — *"auditing anything but
the exact bytes to be published would be theater"* — and would make `collectImages` report a `blob:`
src that can never appear in output.

## Data flow

**Parse** — `src/import/parsers/anydoc-html.ts`. The `inline.kind === 'image'` branch splits on
`source.kind` rather than blocking unconditionally:

- `external` — unchanged. Remains a remote `http(s)` URL handled by `absolutize`.
- `asset`, validated media type — resolve `document.assets[assetId]`, record an `ImportedAsset`,
  emit `<img src="$IMS-CC-FILEBASE$/oer2canvas/<name>" alt="…" width="W" height="H">`.
- `asset`, any other media type, or `unavailable` — today's blocker and `[Embedded image: alt]`
  placeholder, with the message naming the specific cause.

**Identity** — `sha256(bytes)` is the identity. The packaged name is
`<slug>-<sha256 first 8>.<ext>`, where `slug` is the *basename* of `originPart` without its
extension, lowercased and reduced to `[a-z0-9-]` (`word/media/image1.png` → `image1`), falling back
to `image` when nothing usable survives. `ext` comes from the sniffed signature, not from the source
filename. The archive path is `web_resources/oer2canvas/<name>`.
Identical bytes dedupe to one entry and therefore to one Canvas File, which issue 07 proved works
across pages and survives a course copy.

**Carry** — `ImportedAsset[]` is populated for the first time (`src/import/types.ts:38` declares the
shape today, and every path sets `assets: []`). `assets` becomes an optional field on `Chapter` so
`toChapter` carries it and catalog sources simply never set it.

Intrinsic dimensions are decoded at parse time and written straight into the `<img>`; they are not
stored on `ImportedAsset`, because nothing downstream reads them again.

**Compile** — `absolutize` skips packaged references; its `URL_ATTRS` includes `img.src`, so without
this it would resolve the token against the source URL and corrupt it. `steps/alt.ts` is unchanged:
a packaged image gets the same alt remediation as any other image, which satisfies the issue's
missing-alt criterion without new code.

**Export** — `buildCartridge` collects assets across chapters, dedupes by `sha256`, and emits
`web_resources/oer2canvas/*` entries plus one standalone `<resource type="webcontent">` per asset.
Cross-chapter dedup is required because per-chapter dedup is insufficient once a cartridge holds
several chapters.

**Preview** — the two `dangerouslySetInnerHTML` surfaces (`ChapterView.tsx`,
`ImportPlanEditor.tsx`) resolve the token to a `blob:` URL in the live DOM for display only, using
the sniffed MIME type, revoked on unmount. Stored HTML is never mutated.

## Policy and safety

**Allowlist.** `img.src` gains one anchored exact-match rule:

```
^\$IMS-CC-FILEBASE\$/oer2canvas/[A-Za-z0-9._-]+\.(png|jpg|jpeg|gif|webp)$
```

It is added as a predicate for `img.src` specifically, not as a new entry in `HTTP_SCHEMES`, which
is shared with `iframe`, `embed`, `object`, `audio` and `video` and must not be loosened. No
traversal, no query, no encoded separators, no other prefix.

**Referential integrity at export.** The allowlist rule alone is not sufficient. Once the token form
is accepted, publisher HTML could contain one — the Markdown/HTML import path takes arbitrary author
markup — and a hand-written token would survive the gate while pointing at nothing, or collide with
a real packaged asset. So export verifies that every `$IMS-CC-FILEBASE$` reference in the gated HTML
resolves to an actually-packaged entry; any that does not is a blocker. This mirrors the check the
issue-06 probe generator already applies to itself, and it catches compiler defects as well as
hostile input.

**Bytes are verified, not trusted.** `mediaType` comes from the source document's own metadata, so
the packaged type is decided by sniffing the actual signature; a claimed/actual mismatch blocks. The
dimension decoder reads the same header, so an image whose intrinsic size cannot be decoded also
blocks rather than shipping without `width`/`height`.

**Limits.** No new limits are needed. `PARSER_PROBE_LIMITS` already carries `maximumAssetCount` (64),
`maximumAssetBytes` (8 MiB) and `maximumIndividualAssetBytes` (4 MiB), each backed by the measured
2026-08-27 parser benchmark. This work enforces them at packaging time rather than redefining them.

## Failure modes

Every one converges on today's behaviour — the `embedded-content` blocker plus the visible
`[Embedded image: alt]` placeholder — with a message naming the cause:

| Cause | Detection |
| --- | --- |
| Bytes unavailable | `source.kind === 'unavailable'` |
| Unsupported media type | Sniffed signature outside the four validated types |
| Signature mismatch | Sniffed signature disagrees with the declared `mediaType` |
| Undecodable dimensions | Header decoder cannot read intrinsic size |
| Over size limit | Per-asset or per-document cap exceeded |
| Unresolvable reference | Export-time referential integrity check |

Nothing publishes with a silent hole, which is the stance `gate.ts` already takes.

## Direct Canvas push must be blocked

`src/canvas/client.ts:271` pushes `wiki_page.body` and nothing else; the direct-push path has no
file-upload capability at all. A page containing `$IMS-CC-FILEBASE$/oer2canvas/<name>` pushed that
way renders a broken image, because the token only means anything during cartridge import.

This hazard is created by issue 08, so issue 08 must close it, even though issue 09 is where the
criterion was originally written. When any selected chapter carries packaged assets and the
destination is a Canvas course, the plan is **not ready**, and the screen says why and points at
cartridge export instead.

The rule lives in `buildPlan` (`src/shell/plan.ts:66`), which already decides readiness and whose
own comment requires that such rules be resolved by the function the push writes with rather than
restated at the screen. Cartridge export is unaffected.

Uploading assets through the Canvas Files API is deliberately out of scope: that workflow needs its
own proven upload design, which is issue 09's business.

## Files

| File | Change |
| --- | --- |
| `src/import/parsers/anydoc-html.ts` | Split the image branch by `source.kind`; emit packaged refs |
| `src/import/assets.ts` *(new)* | Identity, naming, dedup, signature sniffing, dimension decoding |
| `src/import/types.ts` | Populate `ImportedAsset`; `mediaType` and `extension` hold the **sniffed** values, never the document's declared ones |
| `src/import/to-chapter.ts` | Carry `assets` onto `Chapter` |
| `src/sources/types.ts` | Optional `assets` on `Chapter` |
| `src/engine/allowlist.ts` | Packaged-reference predicate for `img.src` |
| `src/engine/compile/steps/absolutize.ts` | Skip packaged references |
| `src/engine/export/cartridge.ts` | Asset entries, `webcontent` resources, integrity check |
| `src/components/ChapterView.tsx`, `src/components/ImportPlanEditor.tsx` | Blob resolution for preview |
| `src/shell/plan.ts` | Block direct push when packaged assets are present |
| `src/import/testing/*` | 16×16 raster fixtures; images in EPUB/ODT/RTF fixtures |

## Testing

**Unit.** Asset extraction per `source.kind`; identity, dedup, naming; the header decoder across all
four types plus truncated and corrupt headers; the allowlist predicate's *rejections* — traversal,
query strings, encoded separators, wrong extension, foreign prefix; `absolutize` leaving packaged
references untouched; the integrity check failing on an unresolvable token; cartridge manifest and
entry shape matching issue 07's winning form.

**Golden.** A packaged-image page joins `src/engine/compile/__goldens__`, so accidental post-gate
rewriting shows up as a diff rather than a silent regression.

**Browser.** Preview resolves the token to a blob and the image decodes; the audit frame sees the
unresolved token and still lays out at the true box; `preview-parity` continues to pass — that is
the invariant this design trades on.

**Fixtures.** `ONE_PIXEL_PNG` is replaced by 16×16 rasters reused from the issue-06 probe generator,
which are deterministic and already proven to render in Canvas. A 1×1 image is visually
indistinguishable from a broken one and degenerate for the dimension decoder. EPUB/ODT/RTF fixtures
gain embedded images; they currently have none.

**Existing tests that must change deliberately.** `src/import/file.browser.test.ts:74` and
`src/components/ImportPlanEditor.test.tsx:183` assert the current unconditional blocker. Both are
updated to assert the new split, so the behaviour change is an explicit edit rather than something
that quietly turns green.

**Live Canvas acceptance.** Split into two halves that meet at an artifact, rather than driving the
UI with Playwright. Driving the UI would re-test the interface to prove something about packaging,
and would rest the acceptance on brittle selectors.

1. A browser test runs the real pipeline in Chromium — anydoc Worker, compile, gate,
   `buildCartridge` — and emits the cartridge bytes as an artifact. The machinery exists:
   `structured-formats.browser.test.ts` already runs the real Worker, and `.vitest-attachments/` is
   already in use.
2. A Node script imports that artifact into Canvas and measures rendering, reusing
   `scripts/canvas-image-probe-run.mjs`'s `content_migrations`, page-reading and render-measurement
   code unchanged.

Only the second half needs a Canvas instance and credentials; the first runs in CI. This also makes
issue 09's Canvas-acceptance criterion a matter of adding fixtures rather than building
infrastructure.

## Non-goals

- Vector and other raster formats (SVG, TIFF, AVIF). They keep the blocker.
- Images from the PDF, Markdown/HTML, and URL import paths. Those are issues 11, 05 and 12.
- Image optimisation, resizing, or recompression. Bytes are packaged as extracted.
- Relying on Canvas deduplication. Issue 07 measured that it does not happen.
- Uploading assets through the Canvas Files API so direct push can carry images. Issue 09.
