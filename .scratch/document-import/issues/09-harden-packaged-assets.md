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
- [x] Malformed and adversarial assets — truncated headers, declared/actual type mismatches, decompression bombs — fail closed with findings. Truncated headers and declared/actual type mismatches were already refused pre-branch (`refuses a truncated header rather than guessing a size`, `sniffed type wins over a lying declared type`, both in `src/import/assets.test.ts`). This branch closes the remaining gap: a small file can declare an enormous bitmap in its header and decode to gigabytes of RGBA, which byte budgets alone never bounded. `maximumAssetPixels` (40,000,000) in `PARSER_PROBE_LIMITS` (`src/import/parser-limit-values.ts`) rejects any asset whose sniffed `width * height` exceeds it as `too-many-pixels`, checked in `prepareAssets` (`src/import/assets.ts`) right after sniffing, with `an image of exactly the pixel budget packages, and one row more is refused` pinning the comparison itself rather than merely straddling it. That cap is only worth as much as the sniffed size, so `jpeg()` now FAILS CLOSED on any marker chain it cannot walk the way a real decoder does — `FF01`/`FFD0`-`FFD7` are parameterless, and a `+2+length` walk over them lands in attacker-chosen padding and reads a decoy frame header there. `a jpeg whose marker chain cannot be walked deterministically is refused` builds that file: before the fix it sniffed 16x16 and packaged; it is now an `unsupported-type` refusal. All four causes route through the same counted `embedded-content` blocker and visible placeholder, pinned end to end (including `too-many-pixels` and its "too large to decode safely" label) by `every reason an image was refused is reported, with counts` in `src/import/parsers/anydoc-html.test.ts`.
- [x] Asset counts, total bytes, and unsupported-asset findings are visible before export and obey established byte budgets. `PlanScreen` (`src/shell/PlanScreen.tsx`) now discloses packaged bytes alongside the enforced budget — `Packaged assets: N (X packaged; the per-document budget is Y).`, with the byte clause correctly omitted (not "0 KiB") when nothing was packaged. Only the BUDGET is read from `PARSER_PROBE_LIMITS.maximumAssetBytes` rather than a literal; the first number is the measured `counts.packagedAssetBytes` (`src/App.tsx:804`). The wording keeps them as two separate facts on purpose, because they are two different measures: `packagedAssetBytes` is the cartridge's weight, deduped by hash and packaged-only, while the budget is enforced in `prepareAssets` against a running per-occurrence total that also includes duplicates and images later refused by the sniff or the pixel check. "X of Y budget" would have implied a progress relationship that does not exist. `normalizeAnyDocDocument` (`src/import/parsers/anydoc-html.ts`) now collects every refusal cause during the walk and emits one deterministic, counted `embedded-content` finding naming all of them at once — e.g. "3 images that could not be packaged: 1 in an unsupported or corrupt format, 1 over the size budget, 1 with missing or unreadable bytes." — instead of dropping every cause but the first encountered.
- [x] Preview references are revoked when a session or import is discarded, not only when a component unmounts. PINNED: `src/components/packaged-preview.browser.test.tsx`'s `unmounting the preview subtree revokes its object urls — the mechanism discard uses` measures that unmounting the preview subtree revokes the blob URL, with a precondition asserting it is not revoked while still on screen. ARGUED, not pinned: that the product's discard paths reach that unmount. `App.tsx`'s `clearDerivedOutput` (`src/App.tsx:348-357`) calls `setPrepared([])` on every discard path (cancel, replan, or starting a new import), and the preview subtree renders only under `prepared.length > 0` (`src/App.tsx:784-786`), so clearing it unmounts the subtree exactly as `unmount()` does. That chain is read from the source and has been verified by hand twice; no test drives discard end to end. Closing the gap would need an App-level test that imports, discards, and observes revocation.
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

That cap is only as good as the size it reads, which made `sniffRaster`'s JPEG walk load-bearing in a
way it had not been before. It assumed every marker carries a 2-byte length; `FF01` (TEM) and
`FFD0`-`FFD7` (RSTn) carry none, so a crafted chain could steer the walk 65281 bytes into a comment
segment's attacker-chosen padding and have it read a decoy `SOF0` declaring 16x16 while Chrome walked
past the comment to a real 8000x6000 frame header — 48 MP, about 192 MB of RGBA, under a cap enforced
against a header the browser never reads. `jpeg()` now returns `undefined` on every divergence from
what a real decoder would do (a parameterless marker, a fill or stuffed byte, a length under 2, a
marker outside the segment range), so such a file becomes an `unsupported-type` refusal — which keeps
its blocking finding and its visible placeholder, so nothing publishes with a silent hole. Refusing an
unusual-but-valid JPEG is the safe direction here; all four committed raster fixtures and all eight
real JPEGs in `src/sources/fixtures` still sniff their true sizes.

Every refusal now speaks with one voice instead of the first one encountered. `finding()` deduped on
code, so a document with images refused for different reasons — an SVG, an oversized PNG, a truncated
header — only ever reported the cause the walk hit first. `normalizeAnyDocDocument` now collects every
refusal cause and emits one deterministic, counted `embedded-content` finding naming all of them at
once, in a fixed order independent of which image the walk reaches first, while the per-image
`[Embedded image: alt]` placeholder and `unavailableAssets` count are unchanged.

The Plan screen now discloses packaged bytes alongside the budget that will refuse them, not just a
count: `Packaged assets: 3 (1.2 MiB packaged; the per-document budget is 8 MiB).` The BUDGET is read
from `PARSER_PROBE_LIMITS` so the figure shown can never drift from the one actually enforced; the
first number is the measured `counts.packagedAssetBytes` (`src/App.tsx:804`). They are stated as two
facts rather than one fraction because they measure different things — the cartridge's deduped,
packaged-only weight versus a per-occurrence pre-sniff accumulator that also counts duplicates and
images later refused — so "X of Y budget" would have claimed a relationship that is not true. The byte
clause is correctly absent (never an invented "0 KiB") when nothing was packaged.

Direct Canvas push stays blocked while packaged assets are present, and that block is now permanent
rather than pending a design. It was considered and rejected: uploading through the Canvas Files API
would mean rewriting the packaged reference into a Canvas file url AFTER the accessibility gate approved
the html, breaking the invariant that the audited bytes are the published bytes — the whole reason the
gate's approval means anything. Cartridge export is the only route that carries images, and the plan
screen's blocker names it as the remedy rather than describing the restriction as temporary.

### Known residual: no aggregate decoded-pixel cap

`maximumAssetPixels` bounds ONE image. Nothing bounds the document total, and the existing budgets do
not close that: 64 flat-colour 6300x6300 PNGs fit inside both the 8 MiB byte budget and the 64-asset
count limit while declaring roughly 2.5 Gpx between them. This is recorded as a deliberate residual,
not an oversight, and it is not a claim that the situation is safe.

An aggregate cap was considered and ruled against for this branch. Any value picked now would be
unmeasured, and the plausible legitimate worst case — 64 full-page 300-dpi scans at about 8.4 MP each,
roughly 540 MP — sits ABOVE any cap that would meaningfully bound the attack. A cap chosen today would
therefore refuse real textbook scans in order to blunt a hazard that already requires a crafted file
and is bounded by the existing byte and count budgets to a tab-level denial of service against the
importing user's own session. It is recorded in the design's Non-goals and should be revisited with
measurement rather than a guess.

Verification: both TypeScript projects and the full suite — 110 test files, 1060 tests — pass, including
a new offline fixture proving docx, epub, odt and rtf all converge on the identical cartridge manifest
shape issue 07 measured Canvas accepts.
