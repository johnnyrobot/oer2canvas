# Harden packaged assets — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the security and disclosure gaps issue 08 deliberately left open: bound the decoded
size of a packaged image, tell the user every reason an image was refused rather than only the first,
show packaged bytes against the budget, and settle the direct-push block as permanent.

**Architecture:** All changes sit on existing flows. The pixel cap becomes a new `AssetRejection`
variant so its cause survives to the user. The parser stops raising a per-image blocker and instead
collects refusal causes, emitting one counted finding after the render walk. Two of issue 09's
criteria are already satisfied by issue 08's design and are closed with tests, not code.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (jsdom + Chromium browser projects).

**Spec:** [`09-harden-packaged-assets-design.md`](09-harden-packaged-assets-design.md)

## Global Constraints

- The decoded-size limit is **40,000,000 pixels**, named `maximumAssetPixels` inside
  `PARSER_PROBE_LIMITS`. (The spec writes it `MAXIMUM_ASSET_PIXELS`; the repo's limits object uses
  camelCase keys, and consistency with its neighbours wins.)
- Existing budgets are unchanged: `maximumAssetCount` 64, `maximumAssetBytes` 8 MiB,
  `maximumIndividualAssetBytes` 4 MiB.
- Every refused image keeps BOTH a blocking finding and its visible `[Embedded image: alt]`
  placeholder. Nothing may publish with a silent hole.
- Media type and extension come from sniffing bytes; the declared `mediaType` is never trusted.
- Direct Canvas push stays blocked when packaged assets are present. Do NOT implement a Files-API
  upload — it is an explicit non-goal.
- Numbers shown to the user are read from `PARSER_PROBE_LIMITS`, never written as literals.
- Run `npm run typecheck && npx vitest run` before every commit; the ENTIRE suite must pass
  (currently 109 files / 1041 tests). There is a known pre-existing intermittent flake in
  `src/components/DocumentImporter.browser.test.tsx` — rerun and say so; do not "fix" it.
- House style: substantial comments explaining WHY, not what.

---

### Task 1: Bound the decoded size of a packaged image

The existing budgets bound the file, not the bitmap. A 4 MiB flat-colour PNG can declare
20000×20000 and decode to roughly 1.6 GB of RGBA in the preview.

**Files:**
- Modify: `src/import/parser-limit-values.ts`
- Modify: `src/import/assets.ts` (`AssetRejection` line 20; `prepareAssets` around line 210)
- Test: `src/import/assets.test.ts`

**Interfaces:**
- Consumes: `sniffRaster(bytes)` returning `{ mediaType, extension, width, height }`.
- Produces: `PARSER_PROBE_LIMITS.maximumAssetPixels: number`; `AssetRejection` gains
  `'too-many-pixels'`.

- [ ] **Step 1: Write the failing tests**

Add to `src/import/assets.test.ts`:

```ts
import { PARSER_PROBE_LIMITS } from './parser-limit-values'

/**
 * A PNG header declaring `width` x `height`, with no image data behind it.
 * `sniffRaster` reads dimensions from the IHDR alone, which is exactly the
 * property an attacker exploits: a tiny file can claim an enormous bitmap.
 */
function pngHeaderDeclaring(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const be = (value: number, at: number) => {
    bytes[at] = (value >>> 24) & 0xff
    bytes[at + 1] = (value >>> 16) & 0xff
    bytes[at + 2] = (value >>> 8) & 0xff
    bytes[at + 3] = value & 0xff
  }
  be(width, 16)
  be(height, 20)
  return bytes
}

test('a small file declaring an enormous bitmap is refused', async () => {
  // The attack is a DECLARED size, not a large file: these bytes are 24 long.
  const bomb = pngHeaderDeclaring(20_000, 20_000)
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'word/media/bomb.png', data: bomb },
  ])
  expect(prepared.get(0)).toEqual({ rejected: 'too-many-pixels' })
})

test('an image just under the pixel budget still packages', async () => {
  const side = Math.floor(Math.sqrt(PARSER_PROBE_LIMITS.maximumAssetPixels)) - 1
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a.png', data: pngHeaderDeclaring(side, side) },
  ])
  expect(prepared.get(0)).toMatchObject({ width: side, height: side })
})

test('an image just over the pixel budget is refused', async () => {
  const side = Math.ceil(Math.sqrt(PARSER_PROBE_LIMITS.maximumAssetPixels)) + 1
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a.png', data: pngHeaderDeclaring(side, side) },
  ])
  expect(prepared.get(0)).toEqual({ rejected: 'too-many-pixels' })
})

test('the ordinary fixtures are nowhere near the pixel budget', async () => {
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a.png', data: RASTER_FIXTURES.png.bytes },
  ])
  expect(prepared.get(0)).toMatchObject({ width: 16, height: 16 })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/assets.test.ts`
Expected: FAIL — `maximumAssetPixels` is undefined and the bomb is prepared rather than rejected.

- [ ] **Step 3: Add the limit**

In `src/import/parser-limit-values.ts`, inside `PARSER_PROBE_LIMITS`:

```ts
  /*
   * A bound on the DECODED bitmap, which the byte budgets do not give.
   * Compression means a small file can declare an enormous image: a flat-colour
   * PNG well under `maximumIndividualAssetBytes` can claim 20000x20000 and
   * decode to roughly 1.6 GB of RGBA when the preview renders it.
   *
   * 40 MP is about 8000x5000 — comfortably beyond any legitimate textbook
   * figure or full-page scan, while capping decoded RGBA near 160 MB.
   */
  maximumAssetPixels: 40_000_000,
```

- [ ] **Step 4: Add the rejection and the check**

In `src/import/assets.ts`, extend the union at line 20:

```ts
export type AssetRejection =
  | 'unavailable' | 'unsupported-type' | 'too-large' | 'too-many' | 'too-many-pixels'
```

In `prepareAssets`, immediately after the `if (!sniffed) { … }` block:

```ts
    /*
     * A distinct rejection rather than folding into `sniffRaster` returning
     * undefined: the import findings count causes separately, and "would decode
     * to 400 MP" is a different thing to tell a user than "not a recognised
     * image format". Checked after sniffing because the dimensions come from the
     * sniffed header, which is the only size claim we have.
     */
    if (sniffed.width * sniffed.height > PARSER_PROBE_LIMITS.maximumAssetPixels) {
      prepared.set(asset.id, { rejected: 'too-many-pixels' })
      continue
    }
```

- [ ] **Step 5: Run to verify it passes**

Run: `npx vitest run --project unit src/import/assets.test.ts && npm run typecheck`
Expected: PASS. Typecheck will flag `BLOCKED_REASON` in `src/import/parsers/anydoc-html.ts` as
missing the new key — add `'too-many-pixels': 'an image too large to decode safely'` there so the
suite stays green; Task 2 replaces that whole table.

- [ ] **Step 6: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/parser-limit-values.ts src/import/assets.ts src/import/assets.test.ts src/import/parsers/anydoc-html.ts
git commit -m "feat: bound the decoded size of a packaged image"
```

---

### Task 2: Report every reason an image was refused, not just the first

`finding()` dedupes on `code`, so a document with an SVG and an oversized image reports only
whichever was encountered first.

**Files:**
- Modify: `src/import/parsers/anydoc-html.ts` (`BLOCKED_REASON` ~line 76; image branch ~line 249;
  the post-render section ~line 346)
- Test: `src/import/parsers/anydoc-html.test.ts`

**Interfaces:**
- Consumes: `AssetRejection` including `'too-many-pixels'` (Task 1).
- Produces: no exported API change; the `embedded-content` finding's message format changes.

- [ ] **Step 1: Write the failing test**

```ts
test('every reason an image was refused is reported, with counts', async () => {
  const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
  const oversized = new Uint8Array(PARSER_PROBE_LIMITS.maximumIndividualAssetBytes + 1)
  oversized.set(RASTER_FIXTURES.png.bytes)
  const assets = [
    { id: 0, mediaType: 'image/svg+xml', originPart: 'a.svg', data: svg },
    { id: 1, mediaType: 'image/png', originPart: 'b.png', data: oversized },
  ]
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', content: [
      { kind: 'image', alt: 'A', source: { kind: 'asset', assetId: 0 } },
      { kind: 'image', alt: 'B', source: { kind: 'asset', assetId: 1 } },
      { kind: 'image', alt: 'C', source: { kind: 'unavailable' } },
    ] }],
    assets, notes: [],
  } as never

  const result = normalizeAnyDocDocument(document, 'docx', await prepareAssets(assets))
  const blocker = result.findings.find((f) => f.code === 'embedded-content')!

  // One finding, not three — but it must name all three causes with counts.
  expect(result.findings.filter((f) => f.code === 'embedded-content')).toHaveLength(1)
  expect(blocker.message).toMatch(/3 images/)
  expect(blocker.message).toMatch(/1 in an unsupported or corrupt format/)
  expect(blocker.message).toMatch(/1 over the size budget/)
  expect(blocker.message).toMatch(/1 with missing or unreadable bytes/)
  // Every one still leaves a visible placeholder.
  expect(result.html.match(/\[Embedded image/g)).toHaveLength(3)
  expect(result.unavailableAssets).toBe(3)
})

test('a single refusal reads naturally rather than as a list of one', async () => {
  const assets = [{
    id: 0, mediaType: 'image/svg+xml', originPart: 'a.svg',
    data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  }]
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', content: [
      { kind: 'image', alt: 'A', source: { kind: 'asset', assetId: 0 } },
    ] }],
    assets, notes: [],
  } as never
  const result = normalizeAnyDocDocument(document, 'docx', await prepareAssets(assets))
  const blocker = result.findings.find((f) => f.code === 'embedded-content')!
  expect(blocker.message).toMatch(/1 image could not be packaged/)
  expect(blocker.message).toMatch(/unsupported or corrupt format/)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/parsers/anydoc-html.test.ts`
Expected: FAIL — the message names one cause and does not count.

- [ ] **Step 3: Replace the reason table with cause labels**

In `normalizeAnyDocDocument`, replace `BLOCKED_REASON` with:

```ts
  /**
   * Why an image could not be packaged, as a noun phrase that completes
   * "N images ... ". These are COUNTED and joined, so they must read correctly
   * in a list and must not repeat the word "image".
   *
   * `external-unsafe` is not an `AssetRejection` — `prepareAssets` never saw
   * those bytes, because an external image has none to see — but it refuses
   * publication for the same reason and belongs in the same tally.
   */
  type RefusalCause = AssetRejection | 'external-unsafe'
  const CAUSE_LABEL: Record<RefusalCause, string> = {
    'unsupported-type': 'in an unsupported or corrupt format',
    'too-many-pixels': 'too large to decode safely',
    'too-large': 'over the size budget',
    'too-many': 'beyond the number of images this workflow can package',
    unavailable: 'with missing or unreadable bytes',
    'external-unsafe': 'hosted at a network address that cannot be safely embedded',
  }
  const refusals: RefusalCause[] = []
```

- [ ] **Step 4: Collect instead of raising, per image**

In the image branch, replace the `const reason = …` / `finding('embedded-content', …)` pair with:

```ts
      refusals.push(
        entry && 'rejected' in entry
          ? entry.rejected
          : inline.source?.kind === 'external'
            ? 'external-unsafe'
            : 'unavailable',
      )
```

Leave `unavailableAssets += 1` and the returned placeholder `<span>` exactly as they are.

- [ ] **Step 5: Emit one counted finding after the walk**

After `const html = renderBlocks(document.blocks)` and beside the other post-walk findings:

```ts
  /*
   * ONE finding for every refused image, not one per image and not one per
   * cause. `finding()` dedupes on code, so raising this inside the walk meant
   * the first cause encountered spoke for all of them — a document with an SVG
   * and an oversized image reported only the SVG. The placeholder in the page
   * says WHERE something is missing; this says WHY, for every reason at once.
   */
  if (refusals.length > 0) {
    const counted = (Object.keys(CAUSE_LABEL) as RefusalCause[])
      .map((cause) => ({ cause, count: refusals.filter((refusal) => refusal === cause).length }))
      .filter(({ count }) => count > 0)
      .map(({ cause, count }) => `${count} ${CAUSE_LABEL[cause]}`)
    finding(
      'embedded-content',
      'blocker',
      `This ${sourceLabel} contains ${refusals.length === 1 ? '1 image' : `${refusals.length} images`}` +
        ` that could not be packaged: ${counted.join(', ')}.` +
        ' Remove or replace them before publishing.',
    )
  }
```

Note the fixed iteration order over `CAUSE_LABEL`'s keys: the message must be deterministic, not
dependent on which image the walk happened to reach first.

- [ ] **Step 6: Run to verify it passes**

Run: `npx vitest run --project unit src/import/parsers/anydoc-html.test.ts && npm run typecheck`
Expected: PASS. Other suites assert on the old message text — `src/import/file.browser.test.ts` and
`src/components/DocumentImporter.browser.test.tsx` both match `/cannot package|corrupt/i`. Check
whether the new wording still satisfies them; where it does not, update the matcher to pin the new
REASON rather than deleting the assertion.

- [ ] **Step 7: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/parsers/ src/import/file.browser.test.ts src/components/DocumentImporter.browser.test.tsx
git commit -m "fix: report every reason an image could not be packaged"
```

---

### Task 3: Show packaged bytes against the budget, and settle the push block

**Files:**
- Modify: `src/import/types.ts` (`ImportReport.counts`), `src/import/document.ts`,
  `src/import/text.ts`, `src/import/markup.ts` (whichever construct `counts`)
- Modify: `src/shell/PlanScreen.tsx:57-61`, `src/App.tsx:803`
- Modify: `src/shell/plan.ts:152-158` (the push-block comment and message)
- Test: `src/shell/PlanScreen.test.tsx` (exists), `src/shell/plan.test.ts`

**Interfaces:**
- Produces: `ImportReport.counts.packagedAssetBytes: number`; `PlanScreen` prop
  `assetBytes?: number`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/shell/plan.test.ts — the block is permanent, and says so.
test('the push blocker does not describe itself as temporary', () => {
  const plan = buildPlan(chaptersWithAsset, { kind: 'canvas', courseId: 1, courseName: 'S' }, 0, [])
  const blocker = plan.blockers.find((b) => /image/i.test(b))!
  expect(blocker).toMatch(/cartridge/i)
  expect(blocker).not.toMatch(/yet|for now|currently|not supported yet/i)
})
```

```tsx
// PlanScreen: bytes shown against the enforced budget.
test('discloses packaged bytes against the budget', () => {
  render(<PlanScreen chapters={chapters} unansweredCount={0} assetCount={3} assetBytes={1_258_291} />)
  const line = screen.getByText(/Packaged assets/)
  expect(line.textContent).toMatch(/3/)
  expect(line.textContent).toMatch(/1\.2 MB/)
  expect(line.textContent).toMatch(/8 MB/)   // from PARSER_PROBE_LIMITS, not a literal
})

test('says nothing about bytes when nothing was packaged', () => {
  render(<PlanScreen chapters={chapters} unansweredCount={0} />)
  expect(screen.queryByText(/Packaged assets/)).toBeNull()
})
```

`src/shell/PlanScreen.test.tsx` already exists — match its render helper and required props rather
than inventing new ones.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/shell/`
Expected: FAIL — the blocker still says "Issue 09 owns…" in its comment and the message has no
byte disclosure.

- [ ] **Step 3: Carry the byte total**

`src/import/types.ts`, inside `ImportReport.counts`:

```ts
    /** Total bytes of assets actually packaged, for pre-export disclosure. */
    packagedAssetBytes: number
```

`src/import/document.ts`, in the `counts` object:

```ts
        packagedAssetBytes: parsed.normalized.packagedAssets.reduce(
          (total, asset) => total + asset.bytes.byteLength,
          0,
        ),
```

Set `packagedAssetBytes: 0` in the other `counts` constructors the typechecker flags.

- [ ] **Step 4: Disclose it**

`src/App.tsx`, beside `assetCount`:

```tsx
            assetBytes: confirmedImport.report.counts.packagedAssetBytes,
```

`src/shell/PlanScreen.tsx` — add the prop, and replace the disclosure:

```tsx
{assetCount !== undefined && (
  <p className="mt-1 text-sm text-neutral-700 dark:text-neutral-300">
    Packaged assets: {assetCount.toLocaleString()}
    {assetBytes !== undefined && ` (${formatBytes(assetBytes)} of ${formatBytes(PARSER_PROBE_LIMITS.maximumAssetBytes)} budget)`}.
  </p>
)}
```

with, near the top of the file:

```tsx
/*
 * The budget shown is read from the same constant the importer ENFORCES, never
 * written as a literal, so the number a user is told cannot drift from the
 * number that actually refuses their images.
 */
const formatBytes = (bytes: number): string =>
  bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
```

- [ ] **Step 5: State the block as settled**

In `src/shell/plan.ts`, replace the trailing sentence of the push-block comment
("Issue 09 owns the Files-API design that would lift this.") with:

```ts
   * This is settled, not pending. Uploading through the Canvas Files API would
   * mean rewriting the packaged reference into a Canvas file url AFTER the gate
   * approved the html, so the audited bytes would stop being the published
   * bytes — the invariant that makes the accessibility audit mean anything.
   * Cartridge export is the route that carries images.
```

Leave the user-facing message as it is: it already names the remedy and never claimed to be
temporary.

- [ ] **Step 6: Run and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/types.ts src/import/document.ts src/import/text.ts src/import/markup.ts src/App.tsx src/shell/
git commit -m "feat: disclose packaged bytes against the budget; settle the push block"
```

---

### Task 4: Pin the two criteria issue 08 already satisfied

These need tests, not code. Both properties hold today; without tests, nothing would notice if they
stopped holding.

**Files:**
- Test: `src/import/assets.test.ts`, `src/components/packaged-preview.browser.test.tsx`

- [ ] **Step 1: Write the extension-independence tests**

```ts
test('refusal is decided by content, never by the origin filename', async () => {
  const svgBytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')
  // An SVG wearing a .png name is still refused …
  const disguised = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'media/diagram.png', data: svgBytes },
  ])
  expect(disguised.get(0)).toEqual({ rejected: 'unsupported-type' })

  // … and a real PNG wearing a .svg name still packages, with the sniffed
  // extension rather than the one in its path.
  const mislabelled = await prepareAssets([
    { id: 0, mediaType: 'image/svg+xml', originPart: 'media/diagram.svg', data: RASTER_FIXTURES.png.bytes },
  ])
  expect(mislabelled.get(0)).toMatchObject({ mediaType: 'image/png', extension: 'png' })
  expect((mislabelled.get(0) as { name: string }).name).toMatch(/\.png$/)
})
```

- [ ] **Step 2: Write the session-discard revocation test**

In `src/components/packaged-preview.browser.test.tsx`, following the existing revocation test's
spy pattern:

```tsx
test('discarding the import revokes its object urls', async () => {
  const revoked: string[] = []
  const realRevoke = URL.revokeObjectURL
  URL.revokeObjectURL = (url: string) => { revoked.push(url); realRevoke.call(URL, url) }
  try {
    const { rerender, container } = render(<ChapterView chapter={chapterWithPackagedImage} /* real props */ />)
    const used = container.querySelector('img')!.getAttribute('src')!
    expect(used).toMatch(/^blob:/)
    // Discarding the import is what `setConfirmedImport(undefined)` does to
    // this subtree: the consumer goes away and its urls must go with it.
    rerender(<></>)
    expect(revoked).toContain(used)
  } finally {
    URL.revokeObjectURL = realRevoke
  }
})
```

- [ ] **Step 3: Run both**

Run: `npx vitest run --project unit src/import/assets.test.ts && npx vitest run --project browser src/components/packaged-preview.browser.test.tsx`
Expected: PASS on the first run — these pin existing behaviour. If either FAILS, stop: you have found
a real defect, and it is more important than the rest of this plan. Report it rather than adjusting
the test.

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npx vitest run
git add src/import/assets.test.ts src/components/packaged-preview.browser.test.tsx
git commit -m "test: pin content-based refusal and revocation on discard"
```

---

### Task 5: Measure the claim the whole design rests on

The packaged token cannot be fetched in the audit frame. `width`/`height` are the only reason the
audited layout matches the published layout. The compile golden proves those attributes are
*emitted*; nothing proves they *work*.

**Files:**
- Create: `src/engine/audit/packaged-image-layout.browser.test.ts`

- [ ] **Step 1: Write the test**

```ts
/**
 * The load-bearing claim of issue 08's design, measured rather than asserted.
 *
 * A packaged reference is a Canvas token, not a url: in the audit frame it
 * cannot load, and a broken image with no dimensions collapses to a few pixels.
 * If that happened, the audited layout would not be the published layout and the
 * whole reason for putting the token in the gated bytes would be gone.
 */
import { RASTER_FIXTURES } from '../../import/testing/raster-fixtures'

const box = (html: string) => {
  const host = document.createElement('div')
  host.style.width = '1280px'
  host.innerHTML = html
  document.body.appendChild(host)
  const rect = host.querySelector('img')!.getBoundingClientRect()
  host.remove()
  return { width: rect.width, height: rect.height }
}

test('an unresolved packaged image reserves the same box as a resolved one', async () => {
  const unresolved = box(
    '<img src="$IMS-CC-FILEBASE$/oer2canvas/diagram-a3f91c2e.png" alt="A diagram" width="16" height="16">',
  )

  const url = URL.createObjectURL(new Blob([RASTER_FIXTURES.png.bytes], { type: 'image/png' }))
  try {
    const host = document.createElement('div')
    host.innerHTML = `<img src="${url}" alt="A diagram" width="16" height="16">`
    document.body.appendChild(host)
    const image = host.querySelector('img')!
    if (!image.complete) await new Promise((done) => image.addEventListener('load', done))
    const resolved = image.getBoundingClientRect()
    host.remove()

    expect(unresolved).toEqual({ width: resolved.width, height: resolved.height })
    expect(unresolved.width).toBe(16)
  } finally {
    URL.revokeObjectURL(url)
  }
})

test('without width and height the box collapses — which is why they are emitted', () => {
  // The negative control. If this ever matched the sized case, the test above
  // would be passing for the wrong reason and would pin nothing.
  const sized = box('<img src="$IMS-CC-FILEBASE$/oer2canvas/x-a3f91c2e.png" alt="x" width="16" height="16">')
  const unsized = box('<img src="$IMS-CC-FILEBASE$/oer2canvas/x-a3f91c2e.png" alt="x">')
  expect(unsized.width).not.toBe(sized.width)
})
```

- [ ] **Step 2: Run it**

Run: `npx vitest run --project browser src/engine/audit/packaged-image-layout.browser.test.ts`
Expected: PASS. If the first test fails, the design's central justification does not hold — stop and
report it; do not weaken the assertion.

- [ ] **Step 3: Commit**

```bash
npm run typecheck && npx vitest run
git add src/engine/audit/packaged-image-layout.browser.test.ts
git commit -m "test: measure that an unresolved packaged image reserves its true box"
```

---

### Task 6: Assert cartridge shape for all four formats offline

Issue 09 asks for acceptance across all four formats. The Canvas-side behaviour depends on the
cartridge, and all four converge on identical cartridge structure before export — so this is asserted
offline, and the single live import from issue 08 is unchanged.

**Files:**
- Modify: `src/import/packaged-cartridge.browser.test.ts`

**Interfaces:**
- Consumes: `DOCUMENT_FIXTURE_CASES` from `src/import/testing/document-fixture-cases.ts`; the
  pipeline helpers the existing test already uses.

- [ ] **Step 1: Parameterise the existing test over all four formats**

Keep the existing DOCX artifact-writing test as it is — issue 08's live acceptance depends on the
artifact it emits. Add beside it:

Add this import at the top of the file:

```ts
import { DOCUMENT_FIXTURE_CASES } from './testing/document-fixture-cases'
```

and this test beside the existing one. It reuses the same pipeline calls the DOCX test makes —
`importStructuredDocument`, `toChapter`, `compileAndAuditChapter` with no `deps` override, and
`buildCartridge` — so there is only one way to build a cartridge in this file:

```ts
test.each(DOCUMENT_FIXTURE_CASES)(
  '$format produces a cartridge with the manifest shape Canvas accepts',
  async ({ format, fixture, mediaType }) => {
    const file = new File([await fixture({ embeddedImage: true })], `diagram.${format}`, {
      type: mediaType,
    })
    const imported = await importStructuredDocument(file, { metadata })
    const compiled = await compileAndAuditChapter(toChapter(imported.work), { profile: DOCUMENT })

    // Same gate assertion as the DOCX case: if the reference did not survive,
    // the manifest checks below would be inspecting an empty cartridge and
    // would pass while proving nothing.
    expect(compiled.sections[0]?.gate?.html ?? '').toContain('$IMS-CC-FILEBASE$/oer2canvas/')

    const entries = buildCartridge([compiled])
    const assetEntries = entries.filter((entry) => entry.name.startsWith('web_resources/oer2canvas/'))
    expect(assetEntries).toHaveLength(1)

    const manifest = new TextDecoder().decode(
      entries.find((entry) => entry.name === 'imsmanifest.xml')!.data,
    )
    // Issue 07 measured this exact shape as one Canvas accepts: a standalone
    // webcontent resource with a matching file child, and no page dependencies.
    expect(manifest).toContain(`type="webcontent" href="${assetEntries[0]!.name}"`)
    expect(manifest).toContain(`<file href="${assetEntries[0]!.name}"/>`)
    expect(manifest).not.toContain('<dependency')
  },
)
```

`DOCUMENT_FIXTURE_CASES` supplies `{ format, fixture, mediaType }` for all four formats. If a fixture
rejects `{ embeddedImage: true }`, check its signature in
`src/import/testing/structured-document-fixtures.ts` — the option names differ per container, and the
EPUB/ODT/RTF fixtures gained image support during issue 08.

- [ ] **Step 2: Run it**

Run: `npx vitest run --project browser src/import/packaged-cartridge.browser.test.ts`
Expected: PASS for all four. A failure here is a real per-format packaging defect, not a fixture
problem — investigate rather than skipping the format.

- [ ] **Step 3: Resolve the issue and update the map**

Tick issue 09's remaining criteria in `.scratch/document-import/issues/09-harden-packaged-assets.md`,
set `Status: resolved`, add an `## Answer` recording the pixel cap, the counted findings, the byte
disclosure, and that direct push is permanently blocked with the reason. Move the frontier in
`.scratch/document-import/map.md` to 11.

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npx vitest run
git add src/import/packaged-cartridge.browser.test.ts .scratch/document-import/
git commit -m "test: assert cartridge shape across all four formats"
```
