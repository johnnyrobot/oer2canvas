# Harden packaged assets — design

Design for document-import issue 09. Issue 08 made embedded raster images publishable; this closes
the security and disclosure gaps that deliberately stayed open, and settles the direct-push question.

## What issue 08 already settled

Read [`08-embedded-image-tracer-design.md`](08-embedded-image-tracer-design.md) first. The relevant
inheritance:

- Assets are identified by `sha256` and deduped across chapters.
- Media type and extension come from sniffing the bytes; the document's declared `mediaType` is never
  trusted.
- The `$IMS-CC-FILEBASE$` token is written before the accessibility gate, so the audited bytes and the
  cartridge bytes are the same string. Intrinsic `width`/`height` are what let the audit frame reserve
  the true box for an image it deliberately never fetches.
- Anything that cannot be packaged keeps the `embedded-content` blocker and a visible
  `[Embedded image: alt]` placeholder.

## Two criteria that are already met

Recorded here so they are closed by evidence rather than by new code.

**Refusal is content-based, not extension-based.** Nothing in the pipeline reads a filename to decide
anything. Every `extension` value in the system is an *output* of `sniffRaster`, never an input:
`prepareAssets` sniffs the bytes, and `packagedAssetName` is handed the sniffed extension. SVG is
refused because it matches none of the four signatures, not because of how it is named. This design
adds tests that pin the property; it changes no code.

**Preview references are revoked on session discard.** `setConfirmedImport(undefined)`
(`src/App.tsx:357`) drops the assets, which unmounts the consuming component and fires
`usePackagedAssetUrls`'s cleanup. Again: a test, not a change.

## Decisions

| Decision | Choice |
| --- | --- |
| Direct Canvas push | Block is **permanent**. No Files-API upload. |
| Decoded-size limit | 40 MP (`MAXIMUM_ASSET_PIXELS = 40_000_000`), refuse over it |
| Failure disclosure | One finding, counts per cause |
| Canvas acceptance breadth | One live import; per-format cartridge shape asserted offline |

## The decompression bomb

The existing budgets bound the *file* — 4 MiB per asset, 8 MiB per document, 64 assets. None bounds
the *decoded bitmap*. A 4 MiB flat-colour PNG can legitimately declare 20000×20000, which decodes to
roughly 1.6 GB of RGBA in the preview.

`sniffRaster` already returns intrinsic `width`/`height`, so the check is nearly free. `prepareAssets`
gains a comparison against `MAXIMUM_ASSET_PIXELS` and a new `AssetRejection` variant,
`'too-many-pixels'`.

It must be a distinct rejection rather than folding into `sniffRaster`'s `undefined`: the disclosure
below counts causes, and "refused because it would decode to 400 MP" is a different thing to tell a
user than "not a recognised image format".

40 MP is roughly 8000×5000 — comfortably above any legitimate textbook figure or full-page scan,
while capping decoded RGBA near 160 MB. The limit lives in `src/import/parser-limit-values.ts` beside
the byte budgets, because it exists for the same reason they do: a bound on what one document can make
the browser do.

## Disclosure

`finding()` in `anydoc-html.ts` dedupes on `code`, so today the first cause encountered speaks for
every refused image. A document with one SVG and one oversized image reports only the SVG.

The image branch stops raising `embedded-content` per image. Instead it collects each
`AssetRejection` during the render walk, and after the walk one blocker is emitted whose message
counts each cause:

> 3 images could not be packaged: 1 unsupported or corrupt format, 1 over the 4 MB per-image budget,
> 1 with missing bytes.

The per-image `[Embedded image: alt]` placeholder is unchanged. That division is deliberate: the
placeholder says *where* something is missing, the finding says *why*, and neither can do the other's
job.

`ImportReport.counts` gains `packagedAssetBytes`. `PlanScreen`'s existing disclosure becomes:

> Packaged assets: 3 (1.2 MB of 8 MB budget).

The budget figure is read from `PARSER_PROBE_LIMITS`, never written as a literal, so the number shown
cannot drift from the number enforced.

## Direct push is permanently blocked

Issue 08 blocked direct Canvas push whenever an import carries packaged assets, because
`src/canvas/client.ts` writes `wiki_page.body` and has no upload path at all. That block is now
permanent, and the reason is stronger than "not built yet".

Uploading assets through the Canvas Files API would mean rewriting each `$IMS-CC-FILEBASE$` reference
into a Canvas file URL **after** the gate had approved the HTML. The audited bytes would no longer be
the published bytes — the invariant issue 08 was built around, and the one that makes the
accessibility audit mean anything. Buying direct-push image support with that invariant is a bad
trade for a route whose alternative already works.

`buildPlan`'s blocker message and comment stop describing the block as awaiting issue 09, and state it
as settled: cartridge export is the route that carries images.

## Audit-parity: closing an asserted-but-unmeasured claim

The token cannot be fetched in the audit frame. `width`/`height` are the entire reason the audited
layout still matches the published layout — that is what makes the token-in-gated-bytes design
defensible instead of a compromise.

Nothing measures it. The compile golden proves the attributes are *emitted*; no test proves they *do
the job*. A browser test must assert that an unresolved packaged image occupies the same layout box as
a resolved one in the audit frame.

Left unmeasured, the design's central justification would rest on reasoning while everything around it
rests on measurement. That is the standard issue 07 set, and this is the one place issue 08 did not
meet it.

## Files

| File | Change |
| --- | --- |
| `src/import/parser-limit-values.ts` | `MAXIMUM_ASSET_PIXELS` |
| `src/import/assets.ts` | `'too-many-pixels'` rejection; pixel check in `prepareAssets` |
| `src/import/parsers/anydoc-html.ts` | Collect rejections; emit one counted finding |
| `src/import/types.ts`, `src/import/document.ts` | `counts.packagedAssetBytes` |
| `src/shell/PlanScreen.tsx`, `src/App.tsx` | Show packaged bytes against the budget |
| `src/shell/plan.ts` | Push block stated as permanent |
| `src/engine/audit/*.browser.test.*` | Unresolved-image layout-box parity test |

## Testing

**Pixel cap.** Just under 40 MP packages; just over is refused as `'too-many-pixels'`. The fixture
that matters is a *small* file declaring huge dimensions — a flat-colour PNG at 20000×20000 — because
that is the actual attack, and a test that only uses genuinely large files would pass while the hole
stayed open.

**Per-cause counts.** A document carrying an unsupported format, an over-budget asset and missing
bytes simultaneously must report all three with correct counts in one finding. This fails today.

**The two already-met criteria.** An SVG whose origin path ends `.png` is still refused; a PNG whose
origin path ends `.svg` still packages. Clearing the import revokes the object URLs, observed through
a spy on `URL.revokeObjectURL`.

**Audit parity.** An unresolved packaged image reserves its true box, matching a resolved one.

**Canvas acceptance.** One live import, unchanged from issue 08. Per-format coverage is asserted
offline by building a cartridge from each of DOCX, EPUB, ODT and RTF and checking the manifest and
archive shape. All four converge on identical cartridge structure well before export — the format only
determines how the bytes were extracted, which the offline suite already covers per format. A second
live import would re-measure Canvas, not this codebase.

## Non-goals

- Uploading assets through the Canvas Files API. Decided against above, not deferred.
- Downscaling, recompressing or otherwise transforming image bytes. Assets are packaged as extracted.
- SVG or any active-content format, in any form.
- Per-image finding detail. The disclosure decision was counts per cause.
