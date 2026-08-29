# 09 — Harden packaged assets across document formats

**What to build:** Make embedded raster assets reliable across supported document formats by deduplicating bytes, enforcing limits and media policies, preserving audit/render parity, and clearly blocking workflows that cannot yet carry the assets safely.

**Blocked by:** 08 — Ship one embedded-image import tracer.

**Design:** [09-harden-packaged-assets-design.md](../09-harden-packaged-assets-design.md)

**Plan:** [09-harden-packaged-assets-plan.md](../09-harden-packaged-assets-plan.md)

**Status:** resolved

**Rescoped 2026-08-28.** Issue 08's design absorbed five of the seven criteria below, because
unblocking all four validated media types and all four anydoc formats made them part of the tracer
rather than a hardening pass on top of it. They are recorded as satisfied, with the reason, so the
history shows they were met deliberately rather than dropped. What remains is genuine hardening.

Satisfied by issue 08:

- [x] Asset identity uses content hashing — issue 08 identifies assets by `sha256` and dedupes across chapters.
- [x] Blob URLs are revoked when assets or imports are discarded — issue 08 revokes on unmount. Session-discard revocation remains open below.
- [x] Multiple pages reference one packaged asset without duplicate payloads — issue 08 dedupes by content hash; issue 07 measured that Canvas resolves the shared reference to a single File.
- [x] Direct Canvas push is unavailable when an import contains embedded assets — moved into issue 08, which is what creates the hazard.
- [x] Validated raster types are supported consistently — issue 08 covers PNG, JPEG, GIF and WebP. Active and malformed asset handling remains open below.

Remaining:

- [x] SVG and other active-content assets fail safely with findings, refused on their content rather than on their extension. `sniffRaster` (`src/import/assets.ts`) only recognizes the four supported raster signatures and refuses everything else — including SVG — as `unsupported-type` regardless of declared media type or filename. `src/import/assets.test.ts`'s `refusal is decided by content, never by the origin filename` pins that a PNG wearing an `.svg` name still packages and an SVG wearing a `.png` name is still refused. `src/import/parsers/anydoc-html.test.ts`'s `every reason an image was refused is reported, with counts` uses a real SVG asset to prove it lands a blocking `embedded-content` finding plus its visible `[Embedded image: alt]` placeholder.
- [x] Malformed and adversarial assets — truncated headers, declared/actual type mismatches, decompression bombs — fail closed with findings. Truncated headers and declared/actual type mismatches were already refused pre-branch (`refuses a truncated header rather than guessing a size`, `sniffed type wins over a lying declared type`, both in `src/import/assets.test.ts`). This branch closes the remaining gap: a small file can declare an enormous bitmap in its header and decode to gigabytes of RGBA, which byte budgets alone never bounded. `maximumAssetPixels` (40,000,000) in `PARSER_PROBE_LIMITS` (`src/import/parser-limit-values.ts`) rejects any asset whose sniffed `width * height` exceeds it as `too-many-pixels`, checked in `prepareAssets` (`src/import/assets.ts`) right after sniffing. All three causes route through the same counted `embedded-content` blocker and visible placeholder.
- [x] Asset counts, total bytes, and unsupported-asset findings are visible before export and obey established byte budgets. `PlanScreen` (`src/shell/PlanScreen.tsx`) now discloses packaged bytes against the enforced budget — `Packaged assets: N (X of Y budget).`, reading both numbers from `PARSER_PROBE_LIMITS.maximumAssetBytes` rather than a literal, with the byte clause correctly omitted (not "0 KB") when nothing was packaged. `normalizeAnyDocDocument` (`src/import/parsers/anydoc-html.ts`) now collects every refusal cause during the walk and emits one deterministic, counted `embedded-content` finding naming all of them at once — e.g. "3 images that could not be packaged: 1 in an unsupported or corrupt format, 1 over the size budget, 1 with missing or unreadable bytes." — instead of dropping every cause but the first encountered.
- [x] Preview references are revoked when a session or import is discarded, not only when a component unmounts. `App.tsx`'s `clearDerivedOutput` (`src/App.tsx:348-357`) calls `setPrepared([])` on every discard path (cancel, replan, or starting a new import), which unmounts the `ChapterView` preview subtree exactly as `unmount()` does. `src/components/packaged-preview.browser.test.tsx`'s `discarding the import revokes its object urls` pins that this actually revokes the blob URL, with a precondition asserting it is not revoked while still on screen.
- [x] Direct Canvas push gains a proven Files-API upload design, or issue 08's block is made permanent and documented as such. The block is now documented as permanent rather than pending. `src/shell/plan.ts`'s comment records the reason: uploading through the Canvas Files API would rewrite the packaged reference into a Canvas file url AFTER the accessibility gate approved the html, breaking the invariant that the audited bytes are the published bytes — cartridge export is the only route that carries images. `src/shell/plan.test.ts`'s `the push blocker does not describe itself as temporary` pins that the blocker message names the real remedy (cartridge export) and never implies the restriction is provisional.
- [x] Structural, security, audit-parity, and Canvas acceptance fixtures cover the complete packaged-asset workflow across all four formats. Structural (`$format reaches deterministic ImportedWork...`), security (`$format malformed input fails explicitly`, `a packageable embedded $format image becomes a cartridge reference, not a blocker`), and audit-parity (`$format uses the shared compile, audit, and cartridge path`) fixtures across EPUB/ODT/RTF already existed pre-branch in `src/import/document.browser.test.ts`, with DOCX's matching coverage in `src/import/file.browser.test.ts` — both from issue 08. This branch adds the missing piece: `src/import/packaged-cartridge.browser.test.ts`'s new `test.each(DOCUMENT_FIXTURE_CASES)` asserts, offline, that docx, epub, odt and rtf all converge on the identical cartridge manifest shape issue 07 measured Canvas accepts — a standalone `webcontent` resource with a matching `<file>` child and no `<dependency>` — completing Canvas-acceptance coverage across all four formats without re-running the one live Canvas import from issue 08 four times.

## Answer

Packaged assets are hardened against the size of the file AND the size of what the file decodes to.
Byte budgets (`maximumAssetCount` 64, `maximumAssetBytes` 8 MiB, `maximumIndividualAssetBytes` 4 MiB)
bound what a document can claim to carry, but a small PNG can declare an enormous `IHDR` and decode to
gigabytes of RGBA the moment a preview renders it — a decompression bomb no byte budget catches. A new
`maximumAssetPixels` (40,000,000 — roughly 8000x5000, comfortably beyond any legitimate textbook figure
or full-page scan) in `PARSER_PROBE_LIMITS` closes that gap: `prepareAssets` refuses any asset whose
sniffed `width * height` exceeds it as `too-many-pixels`, checked right after sniffing since the sniffed
header is the only size claim available before decode.

Every refusal now speaks with one voice instead of the first one encountered. `finding()` deduped on
code, so a document with images refused for different reasons — an SVG, an oversized PNG, a truncated
header — only ever reported the cause the walk hit first. `normalizeAnyDocDocument` now collects every
refusal cause and emits one deterministic, counted `embedded-content` finding naming all of them at
once, in a fixed order independent of which image the walk reaches first, while the per-image
`[Embedded image: alt]` placeholder and `unavailableAssets` count are unchanged.

The Plan screen now discloses packaged bytes against the budget that will refuse them, not just a count:
`Packaged assets: 3 (1.2 MB of 8 MB budget).`, reading both numbers from `PARSER_PROBE_LIMITS` so the
figure shown can never drift from the one actually enforced, with the byte clause correctly absent
(never an invented "0 KB") when nothing was packaged.

Direct Canvas push stays blocked while packaged assets are present, and that block is now permanent
rather than pending a design. It was considered and rejected: uploading through the Canvas Files API
would mean rewriting the packaged reference into a Canvas file url AFTER the accessibility gate approved
the html, breaking the invariant that the audited bytes are the published bytes — the whole reason the
gate's approval means anything. Cartridge export is the only route that carries images, and the plan
screen's blocker names it as the remedy rather than describing the restriction as temporary.

Verification: both TypeScript projects and the full suite — 110 test files, 1060 tests — pass, including
a new offline fixture proving docx, epub, odt and rtf all converge on the identical cartridge manifest
shape issue 07 measured Canvas accepts.
