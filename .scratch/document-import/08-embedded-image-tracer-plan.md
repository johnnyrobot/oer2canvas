# Embedded-image import tracer — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user import an EPUB, DOCX, ODT or RTF containing raster images, preview and audit
those images as part of the remediated page, and export a cartridge that renders them after Canvas
import.

**Architecture:** The Canvas-bound `$IMS-CC-FILEBASE$` reference is written into the HTML *before*
the gate runs, so the audited bytes and the cartridge bytes are literally identical. Intrinsic
`width`/`height`, decoded from the image header, let the audit frame reserve the true box without
fetching anything. Preview surfaces resolve the token to a `blob:` URL in the live DOM only.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (jsdom + Chromium browser projects), Playwright,
`@firecrawl/anydoc-wasm`.

**Spec:** [`08-embedded-image-tracer-design.md`](08-embedded-image-tracer-design.md)

## Global Constraints

- Packaged reference form, exactly: `$IMS-CC-FILEBASE$/oer2canvas/<name>`.
- Archive path, exactly: `web_resources/oer2canvas/<name>`.
- Manifest resource shape, exactly: standalone `<resource type="webcontent" identifier="…"
  href="web_resources/oer2canvas/<name>"><file href="web_resources/oer2canvas/<name>"/></resource>`.
  No page `<dependency>` elements.
- Validated media types only: `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
- Media type and extension come from the **sniffed signature**, never from the document's declared
  `mediaType`.
- Existing limits are enforced, not redefined: `PARSER_PROBE_LIMITS.maximumAssetCount` (64),
  `maximumAssetBytes` (8 MiB), `maximumIndividualAssetBytes` (4 MiB).
- Gated HTML is never rewritten after the gate. `auditedHtml()` bytes go into the cartridge verbatim.
- Anything that cannot be packaged keeps the existing `embedded-content` blocker and the
  `[Embedded image: alt]` placeholder.
- Run `npm run typecheck && npx vitest run` before every commit.

---

### Task 1: Canvas-proven raster fixtures

Shared 16×16 rasters for every later test. They are the exact bytes issue 07 imported into Canvas,
so a fixture can never drift from what was actually proven to render.

**Files:**
- Create: `src/import/testing/raster-fixtures.ts`
- Test: `src/import/testing/raster-fixtures.test.ts`

**Interfaces:**
- Consumes: `PROBE_ASSETS` re-exported from `scripts/canvas-image-probes.mjs` (already exported as
  `ASSETS`).
- Produces: `RASTER_FIXTURES: Record<'png'|'jpeg'|'gif'|'webp', { bytes: Uint8Array; mediaType: string; width: 16; height: 16 }>`

- [ ] **Step 1: Generate the fixture file from the probe generator's own bytes**

Do not transcribe base64 by hand. Run:

```bash
node --input-type=module -e "
import { ASSETS } from './scripts/canvas-image-probes.mjs'
const pick = { png: 'raster.png', jpeg: 'raster.jpg', gif: 'shared.gif', webp: 'raster.webp' }
const b64 = (u8) => Buffer.from(u8).toString('base64')
const entries = Object.entries(pick).map(([key, file]) => {
  const asset = ASSETS.find((a) => a.path.endsWith('/' + file))
  return \`  \${key}: { base64: '\${b64(asset.data)}', mediaType: '\${asset.mediaType}' },\`
})
console.log(entries.join('\n'))
" > /tmp/raster-entries.txt
cat /tmp/raster-entries.txt
```

Then create `src/import/testing/raster-fixtures.ts`, pasting the generated lines into `SOURCE`:

```ts
/**
 * The exact 16x16 rasters issue 07 imported into a live Canvas and measured
 * rendering for. Generated from `scripts/canvas-image-probes.mjs`; the adjacent
 * test pins them to that generator so a fixture can never drift from the bytes
 * Canvas actually accepted.
 *
 * 16x16 rather than 1x1: a one-pixel image is indistinguishable from a broken
 * one, and degenerate for the dimension decoder.
 */
const SOURCE = {
  // <paste the generated lines here>
} as const

const decode = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))

export const RASTER_FIXTURES = Object.fromEntries(
  Object.entries(SOURCE).map(([key, { base64, mediaType }]) => [
    key,
    { bytes: decode(base64), mediaType, width: 16, height: 16 },
  ]),
) as Record<'png' | 'jpeg' | 'gif' | 'webp', {
  bytes: Uint8Array
  mediaType: string
  width: 16
  height: 16
}>
```

- [ ] **Step 2: Write the test that pins fixtures to the Canvas-proven bytes**

```ts
import { ASSETS } from '../../../scripts/canvas-image-probes.mjs'
import { RASTER_FIXTURES } from './raster-fixtures'

const PROBE_FILE = { png: 'raster.png', jpeg: 'raster.jpg', gif: 'shared.gif', webp: 'raster.webp' }

test.each(Object.entries(PROBE_FILE))(
  '%s fixture is byte-identical to the raster issue 07 proved in Canvas',
  (key, file) => {
    const probe = ASSETS.find((asset) => asset.path.endsWith(`/${file}`))!
    const fixture = RASTER_FIXTURES[key as keyof typeof RASTER_FIXTURES]
    expect(Array.from(fixture.bytes)).toEqual(Array.from(probe.data))
    expect(fixture.mediaType).toBe(probe.mediaType)
  },
)
```

- [ ] **Step 3: Run and confirm it passes**

Run: `npx vitest run --project unit src/import/testing/raster-fixtures.test.ts`
Expected: 4 passing.

- [ ] **Step 4: Commit**

```bash
git add src/import/testing/raster-fixtures.ts src/import/testing/raster-fixtures.test.ts
git commit -m "test: share the Canvas-proven raster fixtures"
```

---

### Task 2: Packaged-asset identity, sniffing and dimensions

The pure core. No I/O, no DOM, no parser coupling.

**Files:**
- Create: `src/import/assets.ts`
- Test: `src/import/assets.test.ts`

**Interfaces:**
- Consumes: `RASTER_FIXTURES` (Task 1), `sha256Hex` from `src/import/common.ts`,
  `PARSER_PROBE_LIMITS` from `src/import/parser-limit-values.ts`.
- Produces:
  - `sniffRaster(bytes: Uint8Array): { mediaType: string; extension: string; width: number; height: number } | undefined`
  - `packagedAssetName(originPart: string, sha256: string, extension: string): string`
  - `packagedArchivePath(name: string): string`
  - `packagedReference(name: string): string`
  - `isPackagedReference(value: string): boolean`
  - `PACKAGED_ASSET_DIRECTORY = 'oer2canvas'`
  - `type AssetRejection = 'unavailable' | 'unsupported-type' | 'undecodable' | 'too-large' | 'too-many'`
  - `prepareAssets(assets: readonly { id: number; mediaType: string; originPart: string; data: Uint8Array }[]): Promise<Map<number, PreparedAsset | { rejected: AssetRejection }>>`
  - `interface PreparedAsset { assetId: number; sha256: string; name: string; archivePath: string; reference: string; mediaType: string; extension: string; width: number; height: number; bytes: Uint8Array; originPart: string }`

- [ ] **Step 1: Write the failing tests**

```ts
import { RASTER_FIXTURES } from './testing/raster-fixtures'
import {
  isPackagedReference, packagedArchivePath, packagedAssetName, packagedReference,
  prepareAssets, sniffRaster,
} from './assets'

test.each(['png', 'jpeg', 'gif', 'webp'] as const)('sniffs %s and reads its true size', (key) => {
  const fixture = RASTER_FIXTURES[key]
  const sniffed = sniffRaster(fixture.bytes)
  expect(sniffed).toMatchObject({ mediaType: fixture.mediaType, width: 16, height: 16 })
})

test('refuses bytes that are not a validated raster', () => {
  expect(sniffRaster(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined()
  expect(sniffRaster(new Uint8Array([0, 1, 2, 3]))).toBeUndefined()
})

test('refuses a truncated header rather than guessing a size', () => {
  expect(sniffRaster(RASTER_FIXTURES.png.bytes.slice(0, 12))).toBeUndefined()
})

test('the sniffed type wins over a lying declared type', async () => {
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/gif', originPart: 'word/media/image1.bin', data: RASTER_FIXTURES.png.bytes },
  ])
  expect(prepared.get(0)).toMatchObject({ mediaType: 'image/png', extension: 'png' })
})

test('names an asset from its origin basename plus a hash suffix', () => {
  const name = packagedAssetName('word/media/image1.png', 'a3f91c2e5d6b7a8c', 'png')
  expect(name).toBe('image1-a3f91c2e.png')
  expect(packagedArchivePath(name)).toBe('web_resources/oer2canvas/image1-a3f91c2e.png')
  expect(packagedReference(name)).toBe('$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png')
})

test('falls back to a safe slug when the origin name is unusable', () => {
  expect(packagedAssetName('', 'a3f91c2e5d6b7a8c', 'png')).toBe('image-a3f91c2e.png')
  expect(packagedAssetName('media/../../etc/passwd', 'a3f91c2e5d6b7a8c', 'png')).toBe('passwd-a3f91c2e.png')
  expect(packagedAssetName('media/Ünïcødé Näme!.png', 'a3f91c2e5d6b7a8c', 'png')).toBe('unicode-name-a3f91c2e.png')
})

test('identical bytes prepare to one identity regardless of origin name', async () => {
  const prepared = await prepareAssets([
    { id: 0, mediaType: 'image/png', originPart: 'a/one.png', data: RASTER_FIXTURES.png.bytes },
    { id: 1, mediaType: 'image/png', originPart: 'b/two.png', data: RASTER_FIXTURES.png.bytes },
  ])
  // Same content hash, so the same archive entry — which issue 07 proved Canvas
  // resolves to a single File shared across pages.
  expect((prepared.get(0) as { sha256: string }).sha256).toBe((prepared.get(1) as { sha256: string }).sha256)
  expect((prepared.get(0) as { archivePath: string }).archivePath)
    .toBe((prepared.get(1) as { archivePath: string }).archivePath)
})

test('rejects an oversized asset and an over-count document', async () => {
  const huge = new Uint8Array(4 * 1024 * 1024 + 1)
  huge.set(RASTER_FIXTURES.png.bytes)
  const overSize = await prepareAssets([{ id: 0, mediaType: 'image/png', originPart: 'a.png', data: huge }])
  expect(overSize.get(0)).toEqual({ rejected: 'too-large' })

  const many = Array.from({ length: 65 }, (_, index) => ({
    id: index, mediaType: 'image/png', originPart: `a${index}.png`, data: RASTER_FIXTURES.png.bytes,
  }))
  const overCount = await prepareAssets(many)
  expect(overCount.get(64)).toEqual({ rejected: 'too-many' })
})

test('recognises only its own reference form', () => {
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png')).toBe(true)
  // Every rejection below is a way the allowlist could otherwise be widened.
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/../../etc/passwd')).toBe(false)
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/a.png?x=1')).toBe(false)
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/a%2Fb.png')).toBe(false)
  expect(isPackagedReference('$IMS-CC-FILEBASE$/elsewhere/a.png')).toBe(false)
  expect(isPackagedReference('$IMS-CC-FILEBASE$/oer2canvas/a.svg')).toBe(false)
  expect(isPackagedReference('https://example.com/a.png')).toBe(false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/assets.test.ts`
Expected: FAIL, cannot resolve `./assets`.

- [ ] **Step 3: Implement `src/import/assets.ts`**

```ts
/**
 * Identity, verification and naming for raster assets packaged into a cartridge.
 *
 * The declared `mediaType` comes from the source document's own metadata and is
 * never trusted: type and extension are decided by sniffing the signature, and
 * intrinsic size is read from the same header. An asset whose size cannot be
 * read is refused rather than shipped without width/height, because those
 * attributes are what let the audit frame reserve the true box for an image it
 * deliberately never fetches.
 */
import { sha256Hex } from './common'
import { PARSER_PROBE_LIMITS } from './parser-limit-values'

export const PACKAGED_ASSET_DIRECTORY = 'oer2canvas'
const FILEBASE = '$IMS-CC-FILEBASE$'

export type AssetRejection = 'unavailable' | 'unsupported-type' | 'undecodable' | 'too-large' | 'too-many'

export interface PreparedAsset {
  assetId: number
  sha256: string
  name: string
  archivePath: string
  reference: string
  mediaType: string
  extension: string
  width: number
  height: number
  bytes: Uint8Array
  originPart: string
}

export interface SniffedRaster {
  mediaType: string
  extension: string
  width: number
  height: number
}

const starts = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte)

const u16be = (b: Uint8Array, i: number) => (b[i]! << 8) | b[i + 1]!
const u32be = (b: Uint8Array, i: number) => ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0
const u16le = (b: Uint8Array, i: number) => b[i]! | (b[i + 1]! << 8)

/** PNG: IHDR is fixed at offset 16 and is always the first chunk. */
function png(bytes: Uint8Array): SniffedRaster | undefined {
  if (bytes.length < 24 || !starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return undefined
  if (!starts(bytes, [0x49, 0x48, 0x44, 0x52], 12)) return undefined
  return { mediaType: 'image/png', extension: 'png', width: u32be(bytes, 16), height: u32be(bytes, 20) }
}

/** GIF: logical screen descriptor is little-endian, immediately after the header. */
function gif(bytes: Uint8Array): SniffedRaster | undefined {
  if (bytes.length < 10 || !starts(bytes, [0x47, 0x49, 0x46, 0x38])) return undefined
  return { mediaType: 'image/gif', extension: 'gif', width: u16le(bytes, 6), height: u16le(bytes, 8) }
}

/** WebP: VP8/VP8L/VP8X each store size differently; all sit inside a RIFF container. */
function webp(bytes: Uint8Array): SniffedRaster | undefined {
  if (bytes.length < 30 || !starts(bytes, [0x52, 0x49, 0x46, 0x46]) || !starts(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return undefined
  }
  const chunk = String.fromCharCode(...bytes.slice(12, 16))
  const found = (width: number, height: number): SniffedRaster =>
    ({ mediaType: 'image/webp', extension: 'webp', width, height })
  if (chunk === 'VP8 ') return found(u16le(bytes, 26) & 0x3fff, u16le(bytes, 28) & 0x3fff)
  if (chunk === 'VP8L') {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24)
    return found((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
  }
  if (chunk === 'VP8X') {
    const dim = (i: number) => (bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16)) + 1
    return found(dim(24), dim(27))
  }
  return undefined
}

/** JPEG: walk the marker chain to the first frame header, which carries the size. */
function jpeg(bytes: Uint8Array): SniffedRaster | undefined {
  if (bytes.length < 4 || !starts(bytes, [0xff, 0xd8])) return undefined
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return undefined
    const marker = bytes[offset + 1]!
    // SOF0..SOF15, excluding the non-frame markers DHT (c4), JPGA (c8) and DAC (cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { mediaType: 'image/jpeg', extension: 'jpg', height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) }
    }
    offset += 2 + u16be(bytes, offset + 2)
  }
  return undefined
}

export function sniffRaster(bytes: Uint8Array): SniffedRaster | undefined {
  const found = png(bytes) ?? gif(bytes) ?? webp(bytes) ?? jpeg(bytes)
  if (!found || found.width <= 0 || found.height <= 0) return undefined
  return found
}

export function packagedAssetName(originPart: string, sha256: string, extension: string): string {
  const basename = originPart.split(/[\\/]/).pop() ?? ''
  const slug = basename
    .replace(/\.[^.]*$/, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'image'}-${sha256.slice(0, 8)}.${extension}`
}

export const packagedArchivePath = (name: string): string => `web_resources/${PACKAGED_ASSET_DIRECTORY}/${name}`
export const packagedReference = (name: string): string => `${FILEBASE}/${PACKAGED_ASSET_DIRECTORY}/${name}`

/**
 * Exactly our own reference form and nothing else. Anchored, with no traversal,
 * query, encoded separator, or foreign prefix — this predicate is what the
 * allowlist widens `img.src` by, so every character it admits is a decision.
 */
const PACKAGED_REFERENCE = /^\$IMS-CC-FILEBASE\$\/oer2canvas\/[A-Za-z0-9._-]+\.(?:png|jpe?g|gif|webp)$/

export function isPackagedReference(value: string): boolean {
  return PACKAGED_REFERENCE.test(value) && !value.includes('..')
}

export async function prepareAssets(
  assets: readonly { id: number; mediaType: string; originPart: string; data: Uint8Array }[],
): Promise<Map<number, PreparedAsset | { rejected: AssetRejection }>> {
  const prepared = new Map<number, PreparedAsset | { rejected: AssetRejection }>()
  let total = 0
  for (const [index, asset] of assets.entries()) {
    if (index >= PARSER_PROBE_LIMITS.maximumAssetCount) {
      prepared.set(asset.id, { rejected: 'too-many' })
      continue
    }
    if (asset.data.byteLength === 0) {
      prepared.set(asset.id, { rejected: 'unavailable' })
      continue
    }
    if (asset.data.byteLength > PARSER_PROBE_LIMITS.maximumIndividualAssetBytes) {
      prepared.set(asset.id, { rejected: 'too-large' })
      continue
    }
    total += asset.data.byteLength
    if (total > PARSER_PROBE_LIMITS.maximumAssetBytes) {
      prepared.set(asset.id, { rejected: 'too-large' })
      continue
    }
    const sniffed = sniffRaster(asset.data)
    if (!sniffed) {
      prepared.set(asset.id, { rejected: 'unsupported-type' })
      continue
    }
    const sha256 = await sha256Hex(asset.data)
    const name = packagedAssetName(asset.originPart, sha256, sniffed.extension)
    prepared.set(asset.id, {
      assetId: asset.id,
      sha256,
      name,
      archivePath: packagedArchivePath(name),
      reference: packagedReference(name),
      mediaType: sniffed.mediaType,
      extension: sniffed.extension,
      width: sniffed.width,
      height: sniffed.height,
      bytes: asset.data,
      originPart: asset.originPart,
    })
  }
  return prepared
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/assets.test.ts`
Expected: all PASS. If the `unicode-name` case fails, check the NFKD strip — `Ü` must decompose
before the `[^a-z0-9]` reduction.

- [ ] **Step 5: Commit**

```bash
git add src/import/assets.ts src/import/assets.test.ts
git commit -m "feat: verify and name packaged raster assets"
```

---

### Task 3: Allow the packaged reference on `img.src`

**Files:**
- Modify: `src/engine/allowlist.ts` (import, and the `filterAttrs` scheme check near line 505)
- Test: `src/engine/allowlist.test.ts`

**Interfaces:**
- Consumes: `isPackagedReference` (Task 2).
- Produces: allowlist behaviour only; no new exports.

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/allowlist.test.ts`:

```ts
import { validateAllowlist } from './allowlist'

test('keeps a packaged cartridge reference on img src', async () => {
  const { html } = await validateAllowlist(
    '<p><img src="$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png" alt="A diagram" width="16" height="16"></p>',
  )
  expect(html).toContain('$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png')
  expect(html).toContain('alt="A diagram"')
})

test.each([
  ['traversal', '$IMS-CC-FILEBASE$/oer2canvas/../../etc/passwd'],
  ['query', '$IMS-CC-FILEBASE$/oer2canvas/a.png?x=1'],
  ['foreign prefix', '$IMS-CC-FILEBASE$/elsewhere/a.png'],
  ['unvalidated type', '$IMS-CC-FILEBASE$/oer2canvas/a.svg'],
  ['bare token', '$IMS-CC-FILEBASE$'],
])('drops a %s src that only resembles a packaged reference', async (_label, src) => {
  const { html } = await validateAllowlist(`<p><img src="${src}" alt="x"></p>`)
  expect(html).not.toContain('IMS-CC-FILEBASE')
})

test('the packaged form does not leak to other url-bearing elements', async () => {
  const { html } = await validateAllowlist(
    '<p><iframe src="$IMS-CC-FILEBASE$/oer2canvas/a.png"></iframe>' +
      '<video src="$IMS-CC-FILEBASE$/oer2canvas/a.png"></video></p>',
  )
  expect(html).not.toContain('IMS-CC-FILEBASE')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/engine/allowlist.test.ts`
Expected: the first test FAILS — the src is stripped because the value has no allowed scheme.

- [ ] **Step 3: Widen `img.src` only**

Add the import at the top of `src/engine/allowlist.ts`:

```ts
import { isPackagedReference } from '../import/assets';
```

Then replace the scheme check inside `filterAttrs` (around line 505):

```ts
    const schemeSet = urlAttrs?.[name];
    if (schemeSet && value !== null && !isSchemeAllowed(value, schemeSet)) {
      /*
       * A packaged cartridge asset is not a URL and has no scheme, so it can
       * never satisfy `isSchemeAllowed`. It is admitted here rather than by
       * adding a pseudo-scheme to HTTP_SCHEMES, which is shared with iframe,
       * embed, object, audio and video — widening that set would widen all of
       * them. `isPackagedReference` is anchored to our own prefix and rejects
       * traversal, queries and encoded separators.
       */
      if (!(tag === 'img' && name === 'src' && isPackagedReference(value))) continue;
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/engine/allowlist.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/allowlist.ts src/engine/allowlist.test.ts
git commit -m "feat: allow packaged cartridge references on img src"
```

---

### Task 4: Stop `absolutize` from corrupting the token

**Files:**
- Modify: `src/engine/compile/steps/absolutize.ts`
- Test: `src/engine/compile/steps/absolutize.test.ts`

**Interfaces:**
- Consumes: `isPackagedReference` (Task 2).
- Produces: behaviour only.

- [ ] **Step 1: Write the failing test**

```ts
test('leaves a packaged cartridge reference exactly as written', () => {
  const html = runStep(
    '<p><img src="$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png" alt="A diagram"></p>',
    { baseUrl: 'https://example.org/books/1/pages/2' },
  )
  expect(html).toContain('src="$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png"')
  expect(html).not.toContain('example.org')
})
```

Match the file's existing helper for invoking the step — reuse whatever wrapper the neighbouring
tests already use rather than introducing a second one.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/engine/compile/steps/absolutize.test.ts`
Expected: FAIL — the token is resolved against the base URL into an `https://example.org/...` URL.

- [ ] **Step 3: Skip packaged references in the rewriter**

In the per-attribute rewrite loop, before attempting `new URL(...)`:

```ts
        // A packaged cartridge reference is resolved by Canvas at import time,
        // not by a browser against a base URL. Absolutizing it would produce a
        // URL that points at the publisher's site instead of the packaged file.
        if (isPackagedReference(value)) continue;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/engine/compile/steps/absolutize.test.ts`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/compile/steps/absolutize.ts src/engine/compile/steps/absolutize.test.ts
git commit -m "fix: never absolutize a packaged cartridge reference"
```

---

### Task 5: Emit packaged images from the parser

**Files:**
- Modify: `src/import/parsers/probe.ts` (extend `ParserProbeNormalizedContent`)
- Modify: `src/import/parsers/anydoc-html.ts` (image branch ~line 124; document-level blocker ~line 217)
- Modify: `src/import/workers/anydoc.worker.ts` (~line 131, prepare assets before normalizing)
- Test: `src/import/parsers/anydoc-html.test.ts`

**Interfaces:**
- Consumes: `prepareAssets`, `PreparedAsset`, `AssetRejection` (Task 2); `RASTER_FIXTURES` (Task 1).
- Produces:
  - `ParserProbeNormalizedContent` gains `packagedAssets: PackagedAssetRecord[]`
  - `interface PackagedAssetRecord { sha256: string; name: string; archivePath: string; mediaType: string; extension: string; bytes: Uint8Array; originPart: string }`
  - `normalizeAnyDocDocument(document, sourceFormat?, prepared?)` — third parameter is the map from
    `prepareAssets`; omitted means no asset is packageable, which preserves today's behaviour.

- [ ] **Step 1: Write the failing tests**

```ts
import { prepareAssets } from '../assets'
import { RASTER_FIXTURES } from '../testing/raster-fixtures'
import { normalizeAnyDocDocument } from './anydoc-html'

const documentWith = (assets: { id: number; mediaType: string; originPart: string; data: Uint8Array }[]) => ({
  kind: 'document',
  blocks: [{
    kind: 'paragraph',
    inlines: assets.map((asset) => ({
      kind: 'image', alt: `Figure ${asset.id}`, source: { kind: 'asset', assetId: asset.id },
    })),
  }],
  assets, notes: [],
}) as never

test('packages a validated raster as a cartridge reference with its true size', async () => {
  const assets = [{ id: 0, mediaType: 'image/png', originPart: 'word/media/image1.png', data: RASTER_FIXTURES.png.bytes }]
  const result = normalizeAnyDocDocument(documentWith(assets), 'docx', await prepareAssets(assets))

  expect(result.html).toContain('src="$IMS-CC-FILEBASE$/oer2canvas/image1-')
  expect(result.html).toContain('alt="Figure 0"')
  expect(result.html).toContain('width="16"')
  expect(result.html).toContain('height="16"')
  expect(result.html).not.toContain('[Embedded image')
  expect(result.findings.some((finding) => finding.code === 'embedded-content')).toBe(false)
  expect(result.packagedAssets).toHaveLength(1)
})

test('two references to identical bytes package once and share one reference', async () => {
  const bytes = RASTER_FIXTURES.gif.bytes
  const assets = [
    { id: 0, mediaType: 'image/gif', originPart: 'a/one.gif', data: bytes },
    { id: 1, mediaType: 'image/gif', originPart: 'b/two.gif', data: bytes },
  ]
  const result = normalizeAnyDocDocument(documentWith(assets), 'epub', await prepareAssets(assets))
  const references = [...result.html.matchAll(/src="([^"]+)"/g)].map((match) => match[1])
  expect(references).toHaveLength(2)
  expect(references[0]).toBe(references[1])
  expect(result.packagedAssets).toHaveLength(1)
})

test('an unsupported asset keeps the blocker and the visible placeholder', async () => {
  const assets = [{
    id: 0, mediaType: 'image/svg+xml', originPart: 'a.svg',
    data: new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
  }]
  const result = normalizeAnyDocDocument(documentWith(assets), 'docx', await prepareAssets(assets))
  expect(result.html).toContain('[Embedded image: Figure 0]')
  expect(result.findings.some((finding) => finding.code === 'embedded-content')).toBe(true)
  expect(result.packagedAssets).toHaveLength(0)
})

test('an unavailable image still blocks even when other assets package', async () => {
  const assets = [{ id: 0, mediaType: 'image/png', originPart: 'ok.png', data: RASTER_FIXTURES.png.bytes }]
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', inlines: [
      { kind: 'image', alt: 'Fine', source: { kind: 'asset', assetId: 0 } },
      { kind: 'image', alt: 'Gone', source: { kind: 'unavailable' } },
    ] }],
    assets, notes: [],
  } as never
  const result = normalizeAnyDocDocument(document, 'docx', await prepareAssets(assets))
  expect(result.html).toContain('$IMS-CC-FILEBASE$')
  expect(result.html).toContain('[Embedded image: Gone]')
  expect(result.findings.some((finding) => finding.code === 'embedded-content')).toBe(true)
})

test('an external image is left as a remote url, not packaged', async () => {
  const document = {
    kind: 'document',
    blocks: [{ kind: 'paragraph', inlines: [
      { kind: 'image', alt: 'Remote', source: { kind: 'external', url: 'https://example.org/a.png' } },
    ] }],
    assets: [], notes: [],
  } as never
  const result = normalizeAnyDocDocument(document, 'epub', await prepareAssets([]))
  expect(result.html).toContain('src="https://example.org/a.png"')
  expect(result.packagedAssets).toHaveLength(0)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/parsers/anydoc-html.test.ts`
Expected: FAIL — every image still renders as `[Embedded image: …]`.

- [ ] **Step 3: Extend the normalized-content type**

In `src/import/parsers/probe.ts`:

```ts
export interface PackagedAssetRecord {
  sha256: string
  name: string
  archivePath: string
  mediaType: string
  extension: string
  bytes: Uint8Array
  originPart: string
}

export interface ParserProbeNormalizedContent {
  html: string
  findings: ParserProbeFinding[]
  equations: number
  notes: number
  unavailableAssets: number
  packagedAssets: PackagedAssetRecord[]
}
```

- [ ] **Step 4: Rewrite the image branch**

In `src/import/parsers/anydoc-html.ts`, add imports and a third parameter:

```ts
import type { AssetRejection, PreparedAsset } from '../assets'

export function normalizeAnyDocDocument(
  document: Document,
  sourceFormat = 'document',
  prepared: ReadonlyMap<number, PreparedAsset | { rejected: AssetRejection }> = new Map(),
): ParserProbeNormalizedContent {
```

Inside the function, beside the other counters:

```ts
  const packaged = new Map<string, PackagedAssetRecord>()

  const BLOCKED_REASON: Record<AssetRejection, string> = {
    unavailable: 'an image whose bytes are missing or unreadable',
    'unsupported-type': 'an image in a format this workflow cannot package',
    undecodable: 'an image whose dimensions could not be read',
    'too-large': 'an image larger than the packaging budget',
    'too-many': 'more images than the packaging budget allows',
  }
```

Replace the whole `if (inline.kind === 'image')` branch with:

```ts
    if (inline.kind === 'image') {
      const alt = inline.alt ?? ''
      if (inline.source?.kind === 'external' && inline.source.url) {
        const href = safeHref(inline.source.url)
        if (href) return `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}">`
      }

      const entry = inline.source?.kind === 'asset' && inline.source.assetId !== undefined
        ? prepared.get(inline.source.assetId)
        : undefined

      if (entry && !('rejected' in entry)) {
        // Dedupe by content hash: identical bytes become one archive entry, which
        // issue 07 measured Canvas resolving to a single shared File.
        if (!packaged.has(entry.sha256)) {
          packaged.set(entry.sha256, {
            sha256: entry.sha256, name: entry.name, archivePath: entry.archivePath,
            mediaType: entry.mediaType, extension: entry.extension,
            bytes: entry.bytes, originPart: entry.originPart,
          })
        }
        return (
          `<img src="${escapeHtml(entry.reference)}" alt="${escapeHtml(alt)}"` +
          ` width="${entry.width}" height="${entry.height}">`
        )
      }

      if (inline.source?.kind === 'unavailable') unavailableAssets += 1
      const reason = entry && 'rejected' in entry
        ? BLOCKED_REASON[entry.rejected]
        : BLOCKED_REASON.unavailable
      finding(
        'embedded-content',
        'blocker',
        `This ${sourceLabel} contains ${reason}. Remove or replace it before publishing.`,
      )
      return `<span>[Embedded image${alt ? `: ${escapeHtml(alt)}` : ''}]</span>`
    }
```

- [ ] **Step 5: Fix the document-level blocker and the evaluation-order hazard**

Replace the unconditional `if (document.assets.length > 0)` block (~line 217) with nothing — the
per-image branch now raises the finding only when an image genuinely cannot be packaged.

Then make the render order explicit, because `packagedAssets` is now read in the same object literal
that renders the HTML:

```ts
  // Rendering populates `packaged`, `findings` and the counters, so it must
  // complete before the result object reads them. Relying on object-literal key
  // order for that would be a trap for the next edit.
  const html = renderBlocks(document.blocks)

  if (document.notes.length > 0) {
    finding('unsupported-note', 'blocker', `This ${sourceLabel} contains notes that the text-oriented workflow cannot publish yet.`)
  }

  return {
    html,
    findings,
    equations,
    notes: document.notes.length,
    unavailableAssets,
    packagedAssets: [...packaged.values()],
  }
```

- [ ] **Step 6: Prepare assets in the worker**

In `src/import/workers/anydoc.worker.ts`, import `prepareAssets` from `../assets`, and replace the
`normalized:` line (~131):

```ts
          normalized: normalizeAnyDocDocument(
            document,
            detectedFormat ?? 'document',
            await prepareAssets(document.assets),
          ),
```

The enclosing handler is already `async`, so `await` needs no other change.

- [ ] **Step 7: Run to verify it passes**

Run: `npx vitest run --project unit src/import/parsers/ && npm run typecheck`
Expected: all PASS. Fix any other `ParserProbeNormalizedContent` construction the new required field
breaks — `src/import/markup.ts` and `src/import/text.ts` both build one and need
`packagedAssets: []`.

- [ ] **Step 8: Commit**

```bash
git add src/import/parsers/ src/import/workers/anydoc.worker.ts src/import/markup.ts src/import/text.ts
git commit -m "feat: package embedded rasters as cartridge references"
```

---

### Task 6: Carry assets to the chapter

**Files:**
- Modify: `src/import/types.ts` (no shape change; `ImportedAsset` is finally populated)
- Modify: `src/import/document.ts:75`
- Modify: `src/sources/types.ts:31` (`Chapter`)
- Modify: `src/import/to-chapter.ts`
- Test: `src/import/to-chapter.test.ts`

**Interfaces:**
- Consumes: `packagedAssets` from Task 5.
- Produces: `Chapter.assets?: readonly ImportedAsset[]`; `ImportedWork.assets` populated.

- [ ] **Step 1: Write the failing test**

```ts
import { toChapter } from './to-chapter'

test('carries packaged assets onto the chapter', () => {
  const asset = {
    id: 'a3f91c2e', mediaType: 'image/png', extension: 'png',
    bytes: new Uint8Array([1, 2, 3]), sha256: 'a3f91c2e', originPart: 'word/media/image1.png',
  }
  const chapter = toChapter({
    id: 'w', title: 'T', format: 'docx',
    sections: [{ id: 's', title: 'T', order: 0, html: '<p>x</p>' }],
    assets: [asset],
    provenance: { kind: 'local-file', rights: { authority: 'own', acknowledged: true } },
  })
  expect(chapter.assets).toEqual([asset])
})

test('a chapter with no assets carries none rather than an empty promise', () => {
  const chapter = toChapter({
    id: 'w', title: 'T', format: 'text',
    sections: [{ id: 's', title: 'T', order: 0, html: '<p>x</p>' }],
    assets: [],
    provenance: { kind: 'paste', rights: { authority: 'own', acknowledged: true } },
  })
  expect(chapter.assets).toEqual([])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/to-chapter.test.ts`
Expected: FAIL — `chapter.assets` is `undefined`.

- [ ] **Step 3: Thread assets through**

In `src/sources/types.ts`, add to `Chapter`:

```ts
  /**
   * Raster assets packaged into the cartridge alongside this chapter's pages.
   * Absent for catalog sources, whose images are remote URLs rather than
   * packaged bytes.
   */
  assets?: readonly ImportedAsset[]
```

with `import type { ImportedAsset } from '../import/types'`.

In `src/import/to-chapter.ts`, add `assets: work.assets` to the returned chapter.

In `src/import/document.ts`, replace `assets: []` (line 75) with:

```ts
      assets: parsed.normalized.packagedAssets.map((asset) => ({
        id: asset.sha256,
        mediaType: asset.mediaType,
        extension: asset.extension,
        bytes: asset.bytes,
        sha256: asset.sha256,
        originPart: asset.originPart,
      })),
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/ && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sources/types.ts src/import/to-chapter.ts src/import/document.ts src/import/to-chapter.test.ts
git commit -m "feat: carry packaged assets onto the chapter"
```

---

### Task 7: Package assets into the cartridge

**Files:**
- Modify: `src/engine/export/cartridge.ts` (`buildManifest` ~119, `buildCartridge` ~244)
- Test: `src/engine/export/cartridge.test.ts`

**Interfaces:**
- Consumes: `Chapter.assets` (Task 6); `packagedAssetName`, `packagedArchivePath`,
  `packagedReference` (Task 2); `auditedHtml` from `src/contracts`.
- Produces:
  - `collectPackagedAssets(chapters: readonly CompiledChapter[]): PackagedAsset[]` (exported for tests)
  - `class UnresolvedPackagedReferenceError extends Error`
  - `buildCartridge` emits asset entries and `webcontent` resources.

- [ ] **Step 1: Write the failing tests**

```ts
import { buildCartridge, buildManifest, collectPackagedAssets } from './cartridge'

// Build `chapters` with the file's existing helper; give one section the html
// `<p><img src="$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png" alt="A" width="16" height="16"></p>`
// and its chapter one asset whose sha256 is `a3f91c2e…` and extension `png`.

test('packages each asset once, at the validated archive path', () => {
  const entries = buildCartridge(chaptersWithSharedAsset)
  const assetEntries = entries.filter((entry) => entry.name.startsWith('web_resources/'))
  expect(assetEntries.map((entry) => entry.name)).toEqual(['web_resources/oer2canvas/image1-a3f91c2e.png'])
})

test('declares each asset as a standalone webcontent resource', () => {
  const manifest = buildManifest(chaptersWithAsset)
  expect(manifest).toContain('<resource identifier="asset-a3f91c2e" type="webcontent" href="web_resources/oer2canvas/image1-a3f91c2e.png">')
  expect(manifest).toContain('<file href="web_resources/oer2canvas/image1-a3f91c2e.png"/>')
  // Issue 07 measured page dependencies as optional and changed-nothing.
  expect(manifest).not.toContain('<dependency')
})

test('dedupes one asset shared across two chapters', () => {
  const entries = buildCartridge(twoChaptersSameAsset)
  expect(entries.filter((entry) => entry.name.startsWith('web_resources/'))).toHaveLength(1)
})

test('refuses to build when a reference resolves to nothing', () => {
  // The reference survives the gate but no asset backs it — a hand-written token
  // in publisher markup, or a naming bug on our side.
  expect(() => buildCartridge(chaptersWithDanglingReference))
    .toThrow(/\$IMS-CC-FILEBASE\$\/oer2canvas\/ghost-00000000\.png/)
})

test('page html is written byte-identically to the gated bytes', () => {
  const entries = buildCartridge(chaptersWithAsset)
  const page = entries.find((entry) => entry.name.startsWith('wiki_content/'))!
  expect(new TextDecoder().decode(page.data)).toContain(
    '<img src="$IMS-CC-FILEBASE$/oer2canvas/image1-a3f91c2e.png" alt="A" width="16" height="16">',
  )
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/engine/export/cartridge.test.ts`
Expected: FAIL — no `web_resources/` entries exist.

- [ ] **Step 3: Implement collection, manifest resources, entries and the integrity check**

```ts
export interface PackagedAsset {
  sha256: string
  archivePath: string
  mediaType: string
  bytes: Uint8Array
  resourceId: string
}

export class UnresolvedPackagedReferenceError extends Error {
  constructor(references: readonly string[]) {
    super(
      'Cartridge references no packaged file: ' + references.join(', ') +
        '. Every $IMS-CC-FILEBASE$ reference must resolve to an entry in this archive.',
    )
    this.name = 'UnresolvedPackagedReferenceError'
  }
}

const PACKAGED_REFERENCE_IN_HTML = /\$IMS-CC-FILEBASE\$\/oer2canvas\/[^"'\s>]+/g

/**
 * Every distinct asset the pages actually reference, deduped by content hash.
 *
 * The archive path is RECOMPUTED from the asset via `packagedAssetName` — the
 * same pure function the parser used to write the reference — rather than parsed
 * back out of the HTML. Reconstructing it by splitting the filename would make
 * the archive's shape depend on string surgery over publisher-influenced text;
 * recomputing it means a reference and its entry can only agree or loudly
 * disagree.
 */
export function collectPackagedAssets(chapters: readonly CompiledChapter[]): PackagedAsset[] {
  const byReference = new Map<string, PackagedAsset>()
  for (const compiled of chapters) {
    for (const asset of compiled.chapter.assets ?? []) {
      const name = packagedAssetName(asset.originPart, asset.sha256, asset.extension)
      const reference = packagedReference(name)
      if (byReference.has(reference)) continue
      byReference.set(reference, {
        sha256: asset.sha256,
        archivePath: packagedArchivePath(name),
        mediaType: asset.mediaType,
        bytes: asset.bytes,
        resourceId: `asset-${asset.sha256.slice(0, 8)}`,
      })
    }
  }

  // Referential integrity, both directions that matter. Every reference the gated
  // bytes carry must have an entry; an asset nothing references is simply not
  // packaged, so the archive holds exactly what the pages ask for.
  const referenced = new Set<string>()
  for (const compiled of chapters) {
    for (const section of compiled.sections) {
      for (const reference of auditedHtml(section).match(PACKAGED_REFERENCE_IN_HTML) ?? []) {
        referenced.add(reference)
      }
    }
  }
  const unresolved = [...referenced].filter((reference) => !byReference.has(reference))
  if (unresolved.length > 0) throw new UnresolvedPackagedReferenceError(unresolved)

  return [...byReference.entries()]
    .filter(([reference]) => referenced.has(reference))
    .map(([, asset]) => asset)
}
```

Import the three helpers at the top of `cartridge.ts`:

```ts
import { packagedArchivePath, packagedAssetName, packagedReference } from '../../import/assets';
```

In `buildManifest`, after the page resources, append one resource per asset:

```ts
  const assetResources = collectPackagedAssets(chapters).map((asset) =>
    `    <resource identifier="${asset.resourceId}" type="webcontent" href="${asset.archivePath}">\n` +
    `      <file href="${asset.archivePath}"/>\n` +
    '    </resource>',
  ).join('\n')
```

and include `assetResources` in the emitted `<resources>` block.

In `buildCartridge`, after the page loop:

```ts
  for (const asset of collectPackagedAssets(chapters)) {
    entries.push({ name: asset.archivePath, data: asset.bytes })
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/engine/export/ && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/export/cartridge.ts src/engine/export/cartridge.test.ts
git commit -m "feat: package assets into the cartridge with webcontent resources"
```

---

### Task 8: Block direct Canvas push while assets are packaged

`src/canvas/client.ts` pushes `wiki_page.body` and nothing else, so a pushed page carrying a
packaged reference renders a broken image.

**Files:**
- Modify: `src/shell/plan.ts:66` (`buildPlan`)
- Test: `src/shell/plan.test.ts`

**Interfaces:**
- Consumes: `Chapter.assets` (Task 6).
- Produces: no type change. `buildPlan` appends to the existing `Plan.blockers` when assets are
  present and the destination is `{ kind: 'canvas' }`.

- [ ] **Step 1: Write the failing tests**

```ts
const canvasDestination = { kind: 'canvas', courseId: 1, courseName: 'Sandbox' } as const
const cartridgeDestination = { kind: 'cartridge' } as const

test('a canvas destination blocks while an import carries packaged assets', () => {
  const plan = buildPlan(chaptersWithAsset, canvasDestination, 0, [])
  expect(plan.blockers.some((blocker) => /cartridge/i.test(blocker))).toBe(true)
})

test('cartridge export is unblocked with packaged assets', () => {
  const plan = buildPlan(chaptersWithAsset, cartridgeDestination, 0, [])
  expect(plan.blockers.some((blocker) => /image/i.test(blocker))).toBe(false)
})

test('a canvas destination is unaffected when nothing is packaged', () => {
  const plan = buildPlan(chaptersWithoutAssets, canvasDestination, 0, [])
  expect(plan.blockers.some((blocker) => /image/i.test(blocker))).toBe(false)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/shell/plan.test.ts`
Expected: FAIL — the first test reports `ready: true`.

- [ ] **Step 3: Implement the block in `buildPlan`**

`Plan` already carries `blockers: string[]`, documented as "everything standing between here and a
commit. Empty means ready." Push onto that rather than adding a parallel field — `PlanScreen`
already renders blockers, so no new UI is needed.

```ts
  /*
   * Direct push writes `wiki_page.body` and nothing else — see
   * `src/canvas/client.ts`, which has no file-upload path at all. A page carrying
   * a packaged reference would therefore import with a broken image. Cartridge
   * export is the only route that carries the bytes, so the plan says so rather
   * than letting the push half-succeed. Issue 09 owns the Files-API design that
   * would lift this.
   */
  const packagedAssetCount = chapters.reduce(
    (total, compiled) => total + (compiled.chapter.assets?.length ?? 0),
    0,
  )
  if (packagedAssetCount > 0 && destination?.kind === 'canvas') {
    blockers.push(
      `This import packages ${plural(packagedAssetCount, 'image', 'images')}. ` +
        'Pushing to a course cannot upload them, so export a cartridge instead.',
    )
  }
```

Add this beside the existing blocker pushes in `buildPlan`, using the same `blockers` array and the
file's own `plural` helper. `Destination` is `{ kind: 'canvas'; courseId; courseName } | { kind:
'cartridge' }` (`src/shell/phases.ts:37`) — the discriminant value is `'canvas'`, not `'course'`.

No `PlanScreen.tsx` change is required.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/shell/ && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shell/plan.ts src/shell/plan.test.ts
git commit -m "feat: block direct push while an import packages assets"
```

---

### Task 9: Resolve packaged references for preview

**Files:**
- Create: `src/components/usePackagedAssetUrls.ts`
- Modify: `src/components/ChapterView.tsx:62`, `src/components/ImportPlanEditor.tsx:368`
- Test: `src/components/packaged-preview.browser.test.tsx`

**Interfaces:**
- Consumes: `Chapter.assets` (Task 6), `packagedAssetName` and `packagedReference` (Task 2).
- Produces: `usePackagedAssetUrls(assets?: readonly ImportedAsset[]): (html: string) => string`

- [ ] **Step 1: Write the failing browser test**

```ts
import { render } from '@testing-library/react'
import { RASTER_FIXTURES } from '../import/testing/raster-fixtures'

test('the preview shows a real image while the stored html keeps the token', async () => {
  const { container } = render(<ChapterView chapter={chapterWithPackagedImage} /* … */ />)
  const image = container.querySelector('img')!
  expect(image.getAttribute('src')).toMatch(/^blob:/)
  await new Promise((resolve) => { image.complete ? resolve(null) : image.addEventListener('load', resolve) })
  expect(image.naturalWidth).toBe(16)
  // The gated bytes must be untouched: only the live DOM was resolved.
  expect(chapterWithPackagedImage.sections[0].gate.html).toContain('$IMS-CC-FILEBASE$/oer2canvas/')
})

test('a reference with no matching asset is left alone rather than guessed at', () => {
  const { container } = render(<ChapterView chapter={chapterWithDanglingReference} /* … */ />)
  expect(container.querySelector('img')!.getAttribute('src')).toContain('$IMS-CC-FILEBASE$')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project browser src/components/packaged-preview.browser.test.tsx`
Expected: FAIL — src is still the token.

- [ ] **Step 3: Implement the hook**

```ts
/**
 * Map packaged references to blob URLs for display only.
 *
 * The stored HTML is never mutated: what the gate approved is what the cartridge
 * gets, and a preview that rewrote those bytes would make the audit a claim
 * about markup nobody publishes. Only the string handed to the DOM is resolved.
 */
import { useEffect, useMemo } from 'react'
import type { ImportedAsset } from '../import/types'
import { packagedAssetName, packagedReference } from '../import/assets'

export function usePackagedAssetUrls(assets: readonly ImportedAsset[] = []): (html: string) => string {
  const urls = useMemo(() => {
    const map = new Map<string, string>()
    for (const asset of assets) {
      const blob = new Blob([asset.bytes], { type: asset.mediaType })
      const name = packagedAssetName(asset.originPart, asset.sha256, asset.extension)
      map.set(packagedReference(name), URL.createObjectURL(blob))
    }
    return map
  }, [assets])

  useEffect(() => () => { for (const url of urls.values()) URL.revokeObjectURL(url) }, [urls])

  return useMemo(() => (html: string) =>
    html.replace(/\$IMS-CC-FILEBASE\$\/oer2canvas\/[^"'\s>]+/g, (reference) =>
      // Keyed on the reference the same pure function produced, so preview and
      // export cannot disagree about which bytes a page means. An unmatched
      // reference is left visibly broken: substituting anything would hide a
      // packaging bug behind a picture.
      urls.get(reference) ?? reference), [urls])
}
```

Then in both preview surfaces, call the hook and wrap the html:

```tsx
const resolve = usePackagedAssetUrls(chapter.assets)
// …
dangerouslySetInnerHTML={{ __html: resolve(s.gate.html) }}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project browser src/components/ && npm run typecheck`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/
git commit -m "feat: resolve packaged references for preview only"
```

---

### Task 10: Update the tests that assert the old blocker, and add a golden

The behaviour change must be an explicit edit, never something that quietly turns green.

**Files:**
- Modify: `src/import/file.browser.test.ts:74`
- Modify: `src/components/ImportPlanEditor.test.tsx:183`
- Modify: `src/import/testing/docx-fixture.ts`, `src/import/testing/structured-document-fixtures.ts`
- Create: `src/engine/compile/__goldens__/page-packaged-image.compiled.html`

- [ ] **Step 1: Give every format fixture a real raster**

Replace `ONE_PIXEL_PNG` in `docx-fixture.ts` with `RASTER_FIXTURES.png.bytes`, and add an embedded
16×16 image to the EPUB, ODT and RTF fixtures in `structured-document-fixtures.ts`, following each
container's existing part-writing pattern in that file.

- [ ] **Step 2: Update the two tests that assert the old behaviour**

In `src/import/file.browser.test.ts`, the DOCX-with-image case must now expect a packaged reference
and **no** `embedded-content` finding. Add a sibling case with an SVG asset that still expects the
blocker, so both halves of the split are pinned.

In `src/components/ImportPlanEditor.test.tsx`, keep the blocker fixture — it is testing how a
blocker renders, not that images block — but rename it so it no longer implies images always block.

- [ ] **Step 3: Add the golden**

Follow the existing golden pattern in `src/engine/compile/golden.test.ts`, adding a fixture whose
section contains one packaged image. The golden is what makes accidental post-gate rewriting show up
as a diff.

- [ ] **Step 4: Run the whole suite**

Run: `npm run typecheck && npx vitest run`
Expected: all PASS. Every remaining failure is a real behaviour change to inspect, not a fixture to
force green.

- [ ] **Step 5: Commit**

```bash
git add src/import/testing/ src/import/file.browser.test.ts src/components/ImportPlanEditor.test.tsx src/engine/compile/
git commit -m "test: pin the packaged-image split across all four formats"
```

---

### Task 11: Live Canvas acceptance

Two halves meeting at an artifact. The pipeline half runs in CI; only the import needs credentials.

**Files:**
- Create: `src/import/packaged-cartridge.browser.test.ts`
- Create: `scripts/verify-canvas-image-tracer.mjs`
- Modify: `package.json` (add `verify:canvas-image-tracer`)

**Interfaces:**
- Consumes: the whole pipeline; `canvas-image-probe-run.mjs`'s Canvas helpers.
- Produces: `artifacts/packaged-image-tracer/tracer.imscc`

- [ ] **Step 1: Emit a real cartridge from a browser test**

```ts
/**
 * Produces the acceptance artifact from the REAL pipeline — anydoc Worker,
 * compile, gate, buildCartridge — so what Canvas is handed is what a user would
 * get. Driving the UI instead would rest the acceptance on selectors and prove
 * nothing extra about packaging.
 */
test('emits a cartridge whose packaged image survives the gate', async () => {
  const bytes = await semanticDocxFixture({ embeddedImage: true })
  const imported = await importDocument(/* the file/metadata shape file.browser.test.ts already uses */)
  const compiled = await compileAndAudit(toChapter(imported.work))
  const cartridge = await writeZip(buildCartridge([compiled]))

  expect(compiled.sections[0].gate.html).toContain('$IMS-CC-FILEBASE$/oer2canvas/')
  await server.commands.writeFile('artifacts/packaged-image-tracer/tracer.imscc', cartridge)
})
```

Use whatever file-writing command this Vitest browser setup exposes; if none is available, return
the bytes as base64 from the test and have the Node script in Step 2 regenerate them by running this
test with `--reporter=json`.

- [ ] **Step 2: Import the artifact into Canvas**

Create `scripts/verify-canvas-image-tracer.mjs`, importing the Canvas helpers from
`canvas-image-probe-run.mjs` (export `Canvas`, `createCourse`, `importCartridge`, `readCourseContent`
and `renderPages` from that module first — they are currently module-private):

```js
const canvas = new Canvas(required('CANVAS_BASE_URL'), required('CANVAS_TOKEN'))
const course = await createCourse(canvas, accountId, `oer2canvas image tracer ${Date.now()}`)
try {
  const result = await importCartridge(canvas, course.id, CARTRIDGE, 'tracer.imscc')
  if (result.workflowState !== 'completed') throw new Error(`import ${result.workflowState}`)
  const content = await readCourseContent(canvas, course.id)
  await renderPages(context, baseUrl, course.id, content.pages, evidenceDir, 'tracer')
  const images = content.pages.flatMap((page) => page.renderedImages ?? [])
  if (images.length === 0) throw new Error('no images rendered')
  for (const image of images) {
    if (!image.naturalWidth) throw new Error(`image did not decode: ${image.currentSrc}`)
    if (!image.alt) throw new Error('alt text did not survive the import')
  }
  console.log(`PASS ${images.length} packaged image(s) rendered with alt text intact`)
} finally {
  await canvas.request(`/api/v1/courses/${course.id}?event=delete`, { method: 'DELETE' })
}
```

Add to `package.json`:

```json
"verify:canvas-image-tracer": "node --env-file-if-exists=.env.local scripts/verify-canvas-image-tracer.mjs"
```

- [ ] **Step 3: Run both halves**

```bash
npx vitest run --project browser src/import/packaged-cartridge.browser.test.ts
npm run verify:canvas-image-tracer
```

Expected: `PASS N packaged image(s) rendered with alt text intact`, and the course deleted.

- [ ] **Step 4: Record the evidence and resolve the issue**

Write the outcome to `docs/evidence/packaged-image-tracer-<date>.md`, redacting the Canvas hostname
and operator name as `docs/evidence/canvas-image-probes-2026-08-28.md` does. Then tick issue 08's
criteria, set `Status: resolved`, and move the frontier in `.scratch/document-import/map.md` to 09.

- [ ] **Step 5: Commit**

```bash
git add scripts/ src/import/packaged-cartridge.browser.test.ts package.json docs/evidence/ .scratch/
git commit -m "test: prove a packaged image renders after Canvas import"
```
