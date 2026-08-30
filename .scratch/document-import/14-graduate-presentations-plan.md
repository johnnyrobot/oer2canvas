# Graduate presentation formats — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decide, on evidence, whether PPTX-family decks and ODP decks can become Canvas
pages a person can trust — and enable exactly those that can, with every loss named.

**Architecture:** anydoc has no slide in its model and silently drops diagrams, charts,
media, and the boundary of an untitled slide, while emitting speaker notes as an ordinary
blockquote. So a second, small reader over the deck package supplies what anydoc cannot: the
Worker inflates named XML parts out of the zip (it holds the transferred bytes), the main
thread parses them into a `PresentationIndex` (it has `DOMParser`), and a pure reconciler
walks the index against the normalized HTML's top-level blocks, wrapping each slide in a
`<section>` and raising a finding for every disagreement.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (jsdom `unit` + Chromium `browser`
projects), `DecompressionStream('deflate-raw')`, `DOMParser`. No new runtime dependency.

**Spec:** [`14-graduate-presentations-design.md`](14-graduate-presentations-design.md) — read
its `## Measured facts` section first. Eight facts are already measured against anydoc 0.2.4
on 2026-08-29; **do not re-derive them.**

**Issue:** [`issues/14-graduate-presentations.md`](issues/14-graduate-presentations.md)

## Global Constraints

- **This issue adds no new runtime dependency, no OCR, no relay change, and no second
  browser project.** If a task appears to need one, stop and escalate.
- **A Worker has no `DOMParser`.** Nothing under `src/import/workers/` may parse XML or
  HTML. This is the seam the design is built on — see its "Where the work happens" section.
- **`tsconfig.json` deliberately omits node types**, so a `process` or `node:` reference in
  `src/` is a compile error. Use vite's `?raw` or a browser API.
- **Every number is read from an existing constant or justified in a comment.** Never a bare
  literal. `DOCUMENT_IMPORT_LIMITS` (`src/import/limits.ts`) is the source for existing
  budgets; Task 1 adds the only new ones, and labels them REASONED rather than measured,
  following `maximumAssetPixels`'s precedent in `parser-limit-values.ts`.
- **Where a comment cites a measurement, cite the date.** Measurements taken in this issue
  are 2026-08-29 or later.
- **Every corpus case names the real-world property it stands in for.** `corpus.test.ts`
  enforces it. A fixture with no `standsInFor` is an incomplete task.
- **A test that asserts "does not crash" documents nothing.** Every refusal names its code
  and its message.
- **Findings carry the slide number in `sourcePage`.** `ImportFinding` already has the
  field and the PDF path already uses it for pages. Do not add a new field.
- **Run `npm run typecheck && npx vitest run` before every commit; the whole suite must
  pass.** Two pre-existing intermittent flakes live in
  `src/components/DocumentImporter.browser.test.tsx` and
  `src/components/TextContentImporter.test.tsx` — rerun and say so; do NOT "fix" them.
- **Every commit in this repository's history is green.**

## File structure

| File | Responsibility |
| --- | --- |
| `src/import/zip-read.ts` (new) | Enumerate a zip's central directory; inflate named parts under explicit ceilings. No DOM. |
| `src/import/zip-read.test.ts` (new) | Round-trip against `writeZip`, plus every refusal. |
| `src/import/presentation/parts.ts` (new) | Which part paths an index needs, per package kind. Pure path matching; shared by the Worker and its tests. |
| `src/import/presentation/index.ts` (new) | Parts → `PresentationIndex`, using `DOMParser`. Main thread. |
| `src/import/presentation/index.test.ts` (new) | PPTX and ODP index parsing. |
| `src/import/presentation/reconcile.ts` (new) | `PresentationIndex` + normalized HTML → sectioned HTML + findings. Pure. |
| `src/import/presentation/reconcile.test.ts` (new) | The whole decision table, without WASM. |
| `src/import/workers/anydoc.worker.ts` | Extract presentation parts alongside the parse. |
| `src/import/parsers/probe.ts` | Carry `presentation?` on `ParserProbeResult`. |
| `src/import/page-plan.ts` | Honour `data-plan-label` in `blocksOf`. |
| `src/import/capability.ts` | Two new entries: `pptx` (four extensions) and `odp`. |
| `src/import/document.ts` | Route presentations through the reconciler. |
| `src/import/testing/presentation-fixtures.ts` (new) | Synthetic PPTX/ODP builders. |
| `src/import/testing/corpus.ts` | Presentation corpus cases. |
| `src/import/security.browser.test.ts` | Zip bomb, lying header, traversal name, macro deck. |

---

### Task 1: A zip reader that refuses before it inflates

**Files:**
- Create: `src/import/zip-read.ts`
- Create: `src/import/zip-read.test.ts`

**Interfaces:**
- Consumes: `crc32` from `src/engine/export/zip.ts` (already exported).
- Produces: `readZipParts(bytes: Uint8Array, wanted: (path: string) => boolean): Promise<Map<string, string>>`, and `ZipReadError` with `code: 'malformed' | 'resource-limit'`. `PRESENTATION_PACKAGE_LIMITS`.

This is a new hostile-input surface. The ordering below is the point: **every ceiling is
checked before or during inflation, never after.** A reader that inflates first and asks
questions later has no ceiling at all.

- [ ] **Step 1: Write the failing test**

```ts
// src/import/zip-read.test.ts
import { writeZip } from '../engine/export/zip'
import { readZipParts, ZipReadError, PRESENTATION_PACKAGE_LIMITS } from './zip-read'

const utf8 = (value: string) => new TextEncoder().encode(value)

test('reads only the parts the caller asked for', async () => {
  const bytes = await writeZip([
    { name: 'ppt/presentation.xml', data: utf8('<p:presentation/>') },
    { name: 'ppt/media/image1.png', data: new Uint8Array(1024) },
    { name: 'ppt/slides/slide1.xml', data: utf8('<p:sld/>') },
  ])
  const parts = await readZipParts(bytes, (path) => path.endsWith('.xml'))

  expect([...parts.keys()].sort()).toEqual(['ppt/presentation.xml', 'ppt/slides/slide1.xml'])
  expect(parts.get('ppt/slides/slide1.xml')).toBe('<p:sld/>')
})

test('a stored (uncompressed) entry reads back identically', async () => {
  // `writeZip` stores rather than deflates when deflate does not help, so both
  // methods appear in real packages and both must round-trip.
  const bytes = await writeZip([{ name: 'content.xml', data: utf8('<x/>') }], { compress: false })
  const parts = await readZipParts(bytes, () => true)

  expect(parts.get('content.xml')).toBe('<x/>')
})

test('refuses a package with more entries than the ceiling', async () => {
  const entries = Array.from(
    { length: PRESENTATION_PACKAGE_LIMITS.maximumPackageEntries + 1 },
    (_unused, index) => ({ name: `part${index}.xml`, data: utf8('<x/>') }),
  )
  const bytes = await writeZip(entries)

  await expect(readZipParts(bytes, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'resource-limit',
    message: expect.stringMatching(/entries/),
  })
})

test('refuses a part whose declared size exceeds the ceiling, before inflating it', async () => {
  const oversized = utf8('<x/>'.repeat(PRESENTATION_PACKAGE_LIMITS.maximumIndexedPartBytes))
  const bytes = await writeZip([{ name: 'big.xml', data: oversized }])

  await expect(readZipParts(bytes, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'resource-limit',
  })
})

test('refuses an entry whose header lies about its uncompressed size', async () => {
  // The classic zip-bomb shape: a small declared size hiding a large payload.
  // Patching the central-directory AND local-header size fields to 4 leaves a
  // valid-looking archive whose inflate must be stopped mid-stream.
  const bytes = await writeZip([{ name: 'lie.xml', data: utf8('<x/>'.repeat(100_000)) }])
  const patched = patchUncompressedSizes(bytes, 4)

  await expect(readZipParts(patched, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'malformed',
  })
})

test('refuses a part name that escapes the package', async () => {
  const bytes = await writeZip([{ name: '../../etc/passwd', data: utf8('x') }])

  await expect(readZipParts(bytes, () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'malformed',
    message: expect.stringMatching(/path/),
  })
})

test('refuses bytes with no end-of-central-directory record', async () => {
  await expect(readZipParts(new Uint8Array(64), () => true)).rejects.toMatchObject({
    name: 'ZipReadError',
    code: 'malformed',
  })
})

/**
 * Rewrites every uncompressed-size field (central directory and local header)
 * to `declared`, leaving the payload untouched — which is exactly what a
 * hand-built hostile archive does.
 */
function patchUncompressedSizes(zip: Uint8Array, declared: number): Uint8Array {
  const patched = zip.slice()
  const view = new DataView(patched.buffer, patched.byteOffset, patched.byteLength)
  for (let at = 0; at + 4 <= patched.length; at += 1) {
    const signature = view.getUint32(at, true)
    if (signature === 0x02014b50) view.setUint32(at + 24, declared, true)
    if (signature === 0x04034b50) view.setUint32(at + 22, declared, true)
  }
  return patched
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/import/zip-read.test.ts`
Expected: FAIL — `Failed to resolve import "./zip-read"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/import/zip-read.ts
import { crc32 } from '../engine/export/zip'

/**
 * A ZIP reader, the deliberate counterpart to `engine/export/zip.ts`'s writer.
 *
 * That module states it "only ever WRITES", and that this is what makes owning it
 * cheaper than a dependency. This one changes that bargain, so it is scoped to
 * exactly what the presentation index needs: enumerate the central directory, and
 * inflate the NAMED parts a caller asks for. A deck with a thousand media files
 * inflates none of them.
 *
 * IT TRUSTS NOTHING IT READS. Every ceiling is checked before or during inflation,
 * never after: a reader that inflates first and asks questions later has no ceiling.
 * Every part's CRC is verified against its central-directory record, which is what
 * catches an entry whose header lies about what it holds.
 */

export class ZipReadError extends Error {
  readonly code: 'malformed' | 'resource-limit'

  constructor(code: ZipReadError['code'], message: string) {
    super(message)
    this.name = 'ZipReadError'
    this.code = code
  }
}

/**
 * REASONED bounds, not measured ones — they have no benchmark fixture and no
 * `DOCUMENT_IMPORT_LIMIT_EVIDENCE` entry, exactly like `maximumAssetPixels` in
 * `parser-limit-values.ts`. They exist to bound a hostile archive, not to describe
 * a legitimate deck.
 *
 * `maximumPackageEntries`: a 200-slide deck carries a slide, a layout reference, and
 * often a notes part each, plus masters, themes, and media — low hundreds of parts.
 * 4,096 is an order of magnitude above anything legitimate and still refuses an
 * archive built to make the central-directory walk itself the attack.
 *
 * `maximumIndexedPartBytes`: this bounds the TOTAL of the XML we inflate, not the
 * package. Slide XML is kilobytes; 8 MiB across every indexed part is far above any
 * real deck while staying half of `maximumInputBytes`, so indexing can never inflate
 * to more than the file we already accepted.
 */
export const PRESENTATION_PACKAGE_LIMITS = Object.freeze({
  maximumPackageEntries: 4_096,
  maximumIndexedPartBytes: 8 * 1024 * 1024,
})

const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50
/** The format's own maximum trailing-comment length, plus the 22-byte record. */
const MAX_EOCD_SCAN = 0xffff + 22

function malformed(message: string): ZipReadError {
  return new ZipReadError('malformed', `This package is not a readable archive: ${message}`)
}

function resourceLimit(message: string): ZipReadError {
  return new ZipReadError('resource-limit', message)
}

/**
 * A part path must stay inside the package. `..` segments, absolute paths, and
 * backslash separators are all refused rather than normalized: a package that
 * needs normalizing to be safe is a package we have no reason to trust.
 */
function safePartPath(name: string): string {
  if (name.startsWith('/') || name.includes('\\') || /(^|\/)\.\.(\/|$)/.test(name)) {
    throw malformed(`a part path escapes the package (${name})`)
  }
  return name
}

function findEndOfCentralDirectory(view: DataView): number {
  const from = Math.max(0, view.byteLength - MAX_EOCD_SCAN)
  for (let at = view.byteLength - 22; at >= from; at -= 1) {
    if (view.getUint32(at, true) === EOCD_SIGNATURE) return at
  }
  throw malformed('no end-of-central-directory record')
}

/**
 * Inflate, refusing the moment output passes `declared`.
 *
 * The cap is enforced INSIDE the read loop rather than on the finished buffer,
 * because "check the size after decompressing it" is the bomb working exactly as
 * intended. A stream that stops early is the whole defence.
 */
async function inflateRaw(payload: Uint8Array, declared: number): Promise<Uint8Array> {
  const stream = new DecompressionStream('deflate-raw')
  const writer = stream.writable.getWriter()
  void writer.write(payload as unknown as BufferSource)
  void writer.close()

  const reader = stream.readable.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.length
    if (total > declared) {
      await reader.cancel()
      throw malformed('an entry inflated past the size its header declared')
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

export async function readZipParts(
  bytes: Uint8Array,
  wanted: (path: string) => boolean,
): Promise<Map<string, string>> {
  if (bytes.byteLength < 22) throw malformed('too short to hold an archive')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = findEndOfCentralDirectory(view)
  const entryCount = view.getUint16(eocd + 10, true)
  if (entryCount > PRESENTATION_PACKAGE_LIMITS.maximumPackageEntries) {
    throw resourceLimit(
      `This package has ${entryCount} entries; the browser limit is ` +
      `${PRESENTATION_PACKAGE_LIMITS.maximumPackageEntries}.`,
    )
  }

  const decoder = new TextDecoder('utf-8', { fatal: false })
  const parts = new Map<string, string>()
  let indexedBytes = 0
  let at = view.getUint32(eocd + 16, true)

  for (let entry = 0; entry < entryCount; entry += 1) {
    if (at + 46 > bytes.byteLength || view.getUint32(at, true) !== CENTRAL_SIGNATURE) {
      throw malformed('a central-directory entry is truncated')
    }
    const method = view.getUint16(at + 10, true)
    const expectedCrc = view.getUint32(at + 16, true)
    const compressedSize = view.getUint32(at + 20, true)
    const uncompressedSize = view.getUint32(at + 24, true)
    const nameLength = view.getUint16(at + 28, true)
    const extraLength = view.getUint16(at + 30, true)
    const commentLength = view.getUint16(at + 32, true)
    const localOffset = view.getUint32(at + 42, true)
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength))
    at += 46 + nameLength + extraLength + commentLength

    // Path safety is checked for EVERY entry, not only wanted ones: a package
    // carrying a traversal path is malformed whether or not we meant to read it.
    safePartPath(name)
    if (!wanted(name)) continue

    // Declared size is checked BEFORE the payload is touched, so an entry that
    // announces a gigabyte costs nothing to refuse.
    indexedBytes += uncompressedSize
    if (indexedBytes > PRESENTATION_PACKAGE_LIMITS.maximumIndexedPartBytes) {
      throw resourceLimit(
        'The XML parts of this package exceed the 8 MiB the slide index may inflate.',
      )
    }

    if (localOffset + 30 > bytes.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw malformed(`the local header for "${name}" is missing`)
    }
    // The local header's own extra field may differ in length from the central
    // one, so the data offset is computed from the LOCAL record. Reading the
    // central length here is a classic off-by-a-few that yields garbage.
    const localNameLength = view.getUint16(localOffset + 26, true)
    const localExtraLength = view.getUint16(localOffset + 28, true)
    const dataAt = localOffset + 30 + localNameLength + localExtraLength
    if (dataAt + compressedSize > bytes.byteLength) throw malformed(`"${name}" is truncated`)
    const payload = bytes.subarray(dataAt, dataAt + compressedSize)

    let inflated: Uint8Array
    if (method === 0) {
      if (payload.length !== uncompressedSize) throw malformed(`"${name}" has an inconsistent size`)
      inflated = payload
    } else if (method === 8) {
      inflated = await inflateRaw(payload, uncompressedSize)
      if (inflated.length !== uncompressedSize) {
        throw malformed(`"${name}" inflated to a size its header did not declare`)
      }
    } else {
      throw malformed(`"${name}" uses an unsupported compression method (${method})`)
    }

    // The CRC is the archive's own statement about its contents. Checking it is
    // what turns "the sizes look plausible" into "these are the declared bytes".
    if (crc32(inflated) !== expectedCrc) throw malformed(`"${name}" failed its checksum`)
    parts.set(name, new TextDecoder('utf-8').decode(inflated))
  }

  return parts
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit src/import/zip-read.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npm run typecheck && npx vitest run`
Expected: PASS (bar the two known flakes named in Global Constraints).

- [ ] **Step 6: Commit**

```bash
git add src/import/zip-read.ts src/import/zip-read.test.ts
git commit -m "feat: read named parts out of a zip, refusing before inflating"
```

---

### Task 2: The Worker hands out the deck's XML parts

**Files:**
- Create: `src/import/presentation/parts.ts`
- Create: `src/import/presentation/parts.test.ts`
- Modify: `src/import/parsers/probe.ts` (add `presentation?` to `ParserProbeResult`)
- Modify: `src/import/workers/anydoc.worker.ts`

**Interfaces:**
- Consumes: `readZipParts` (Task 1).
- Produces: `wantedPresentationPart(kind, path): boolean`, and the `presentation?: { kind: 'pptx' | 'odp'; parts: Record<string, string> }` field on `ParserProbeResult`.

The Worker holds the transferred bytes and has no `DOMParser`, so it does zip and nothing
else. Choosing parts is path matching, which needs no parser.

- [ ] **Step 1: Write the failing test**

```ts
// src/import/presentation/parts.test.ts
import { wantedPresentationPart } from './parts'

test('a pptx index wants the presentation, its slides, their rels, and their notes', () => {
  const wanted = (path: string) => wantedPresentationPart('pptx', path)

  expect(wanted('ppt/presentation.xml')).toBe(true)
  expect(wanted('ppt/_rels/presentation.xml.rels')).toBe(true)
  expect(wanted('ppt/slides/slide12.xml')).toBe(true)
  expect(wanted('ppt/slides/_rels/slide12.xml.rels')).toBe(true)
  expect(wanted('ppt/notesSlides/notesSlide12.xml')).toBe(true)
})

test('a pptx index wants no media, theme, master, or macro part', () => {
  const wanted = (path: string) => wantedPresentationPart('pptx', path)

  // Media is what makes a deck large; inflating it to count slides would be
  // the whole cost of the parse for none of the benefit.
  expect(wanted('ppt/media/image1.png')).toBe(false)
  expect(wanted('ppt/theme/theme1.xml')).toBe(false)
  expect(wanted('ppt/slideMasters/slideMaster1.xml')).toBe(false)
  // A macro-enabled deck (.pptm/.ppsm) carries this. We never read it and
  // never execute it; this pins that it is not even inflated.
  expect(wanted('ppt/vbaProject.bin')).toBe(false)
})

test('an odp index wants only content.xml', () => {
  expect(wantedPresentationPart('odp', 'content.xml')).toBe(true)
  expect(wantedPresentationPart('odp', 'styles.xml')).toBe(false)
  expect(wantedPresentationPart('odp', 'Pictures/image1.png')).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/import/presentation/parts.test.ts`
Expected: FAIL — `Failed to resolve import "./parts"`.

- [ ] **Step 3: Write `parts.ts`**

```ts
// src/import/presentation/parts.ts
/**
 * Which parts of a deck package the slide index needs.
 *
 * Pure path matching, deliberately: it runs inside the anydoc Worker, which has
 * no `DOMParser` (see `parsers/probe.ts` on why the PDF path carries unsanitized
 * Markdown out to the main thread). Anything that needed to READ the XML to
 * decide would have to be a hand-rolled scanner over hostile input, which is the
 * wrong answer twice.
 */
export type PresentationPackageKind = 'pptx' | 'odp'

const PPTX_PATTERNS: readonly RegExp[] = [
  /^ppt\/presentation\.xml$/,
  /^ppt\/_rels\/presentation\.xml\.rels$/,
  /^ppt\/slides\/slide\d+\.xml$/,
  /^ppt\/slides\/_rels\/slide\d+\.xml\.rels$/,
  /^ppt\/notesSlides\/notesSlide\d+\.xml$/,
]

// ODP keeps every page, frame, and notes body in one part, so the index needs
// exactly that part and nothing else.
const ODP_PATTERNS: readonly RegExp[] = [/^content\.xml$/]

export function wantedPresentationPart(kind: PresentationPackageKind, path: string): boolean {
  const patterns = kind === 'pptx' ? PPTX_PATTERNS : ODP_PATTERNS
  return patterns.some((pattern) => pattern.test(path))
}
```

- [ ] **Step 4: Add the result field in `probe.ts`**

Insert alongside the other parser-specific fields on `ParserProbeResult` (after
`normalized`, before the PDF-only `detection`):

```ts
  /**
   * Presentations only. The deck's own XML parts, inflated in the Worker because
   * that is where the transferred bytes live, and parsed on the main thread
   * because that is where `DOMParser` lives. Keys are package paths.
   */
  presentation?: { kind: 'pptx' | 'odp'; parts: Record<string, string> }
```

- [ ] **Step 5: Extract the parts in the Worker**

In `src/import/workers/anydoc.worker.ts`, add the imports:

```ts
import { readZipParts } from '../zip-read'
import { wantedPresentationPart } from '../presentation/parts'
```

Then, inside the `try` block, after `const document = toDocument(bytes, detectedFormat)` and
before `send({ kind: 'result', ... })`:

```ts
    // The deck's own account of itself, alongside anydoc's. A failure to read it
    // is NOT fatal here: the main thread decides what an unreadable package means,
    // and `document.ts` refuses a presentation with no index rather than the
    // Worker deciding for every format at once.
    let presentation: { kind: 'pptx' | 'odp'; parts: Record<string, string> } | undefined
    if (detectedFormat === 'pptx' || detectedFormat === 'odp') {
      const kind = detectedFormat
      const parts = await readZipParts(bytes, (path) => wantedPresentationPart(kind, path))
      presentation = { kind, parts: Object.fromEntries(parts) }
    }
```

and add `presentation,` to the `result` object literal.

> **Note on `bytes`:** the Worker already holds `const bytes = new Uint8Array(request.bytes)`
> from the parse. Reuse that binding — do not re-wrap `request.bytes`.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project unit src/import/presentation/parts.test.ts && npm run typecheck`
Expected: PASS, 3 tests, and a clean typecheck.

- [ ] **Step 7: Commit**

```bash
git add src/import/presentation/parts.ts src/import/presentation/parts.test.ts \
        src/import/parsers/probe.ts src/import/workers/anydoc.worker.ts
git commit -m "feat: carry a deck's own xml parts out of the parser worker"
```

---

### Task 3: A PPTX package index

**Files:**
- Create: `src/import/presentation/index.ts`
- Create: `src/import/presentation/index.test.ts`
- Create: `src/import/testing/presentation-fixtures.ts`

**Interfaces:**
- Consumes: the `presentation.parts` record (Task 2).
- Produces: `PresentationSlideIndex`, `PresentationIndex`, `readPresentationIndex(kind, parts): PresentationIndex`. Also the fixture builders `pptxFixture(options)` and (Task 5) `odpFixture(options)`.

Everything this returns is something anydoc could not tell us. Design facts 3, 4, 5, and 6
are each one field here.

- [ ] **Step 1: Write the fixture builder**

Create `src/import/testing/presentation-fixtures.ts`. It follows
`structured-document-fixtures.ts`: hand-written OOXML into `writeZip`, with comments saying
what each construct stands for.

```ts
// src/import/testing/presentation-fixtures.ts
// @ts-expect-error -- shared browser/Node test fixture, like `structured-document-fixtures.ts`.
import { writeZip } from '../../engine/export/zip.ts'
// @ts-expect-error -- shared browser/Node test fixture; see above.
import { RASTER_FIXTURES } from './raster-fixtures.ts'

const utf8 = (value: string) => new TextEncoder().encode(value)
const xmlEscape = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** The same Canvas-proven PNG every other format's fixture embeds. */
const EMBEDDED_IMAGE_PNG = RASTER_FIXTURES.png.bytes

export interface PptxSlideSpec {
  /** Omitted means the slide has NO title placeholder — design fact 3. */
  title?: string
  body?: readonly string[]
  /** Speaker notes — design fact 5. */
  notes?: string
  /** Emit the title placeholder LAST in `spTree` — design fact 4. */
  titleLast?: boolean
  /** A picture, with `descr` as its alt text (omit for an undescribed image). */
  image?: { alt?: string }
  /** Content anydoc drops entirely — design fact 6. */
  diagram?: boolean
  chart?: boolean
  video?: boolean
  table?: boolean
}

const DIAGRAM_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'
const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table'

function textShape(id: number, name: string, paragraphs: readonly string[], placeholder: string): string {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr>` +
    `<p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>` +
    `<p:spPr><a:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1325563"/></a:xfrm></p:spPr>` +
    `<p:txBody><a:bodyPr/><a:lstStyle/>` +
    paragraphs.map((text) => `<a:p><a:r><a:rPr lang="en-US"/><a:t>${xmlEscape(text)}</a:t></a:r></a:p>`).join('') +
    `</p:txBody></p:sp>`
}

function graphicFrame(id: number, name: string, uri: string, payload: string): string {
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="${name}"/>` +
    `<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
    `<p:xfrm><a:off x="838200" y="365125"/><a:ext cx="7772400" cy="1325563"/></p:xfrm>` +
    `<a:graphic><a:graphicData uri="${uri}">${payload}</a:graphicData></a:graphic></p:graphicFrame>`
}

function slideXml(spec: PptxSlideSpec): string {
  const title = spec.title === undefined
    ? ''
    : textShape(2, 'Title 1', [spec.title], '<p:ph type="title"/>')
  const body = spec.body?.length
    ? textShape(3, 'Content Placeholder 2', spec.body, '<p:ph type="body" idx="1"/>')
    : ''
  const image = spec.image
    ? `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 4"` +
      `${spec.image.alt === undefined ? '' : ` descr="${xmlEscape(spec.image.alt)}"`}/>` +
      `<p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
      `<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
      `<p:spPr/></p:pic>`
    : ''
  // A SmartArt frame references four diagram parts by relationship; anydoc
  // emits nothing at all for it (design fact 6), so the index is the only
  // place its existence is ever recorded.
  const diagram = spec.diagram
    ? graphicFrame(5, 'Diagram 5', DIAGRAM_URI,
        '<dgm:relIds xmlns:dgm="http://schemas.openxmlformats.org/drawingml/2006/diagram" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
        'r:dm="rIdDm" r:lo="rIdLo" r:qs="rIdQs" r:cs="rIdCs"/>')
    : ''
  const chart = spec.chart
    ? graphicFrame(6, 'Chart 6', CHART_URI,
        '<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rIdChart"/>')
    : ''
  const video = spec.video
    ? `<p:pic><p:nvPicPr><p:cNvPr id="7" name="Lecture clip"/><p:cNvPicPr/>` +
      `<p:nvPr><a:videoFile r:link="rIdVideo"/></p:nvPr></p:nvPicPr>` +
      `<p:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr/></p:pic>`
    : ''
  const table = spec.table
    ? graphicFrame(8, 'Table 8', TABLE_URI,
        '<a:tbl><a:tblPr firstRow="1"/><a:tblGrid><a:gridCol w="3886200"/><a:gridCol w="3886200"/></a:tblGrid>' +
        '<a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Stage</a:t></a:r></a:p></a:txBody></a:tc>' +
        '<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Location</a:t></a:r></a:p></a:txBody></a:tc></a:tr>' +
        '<a:tr h="370840"><a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Calvin cycle</a:t></a:r></a:p></a:txBody></a:tc>' +
        '<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>Stroma</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>')
    : ''

  const shapes = spec.titleLast
    ? `${body}${image}${diagram}${chart}${video}${table}${title}`
    : `${title}${body}${image}${diagram}${chart}${video}${table}`

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${shapes}
  </p:spTree></p:cSld></p:sld>`
}

function notesXml(text: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:notes xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
         xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
         xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>
    ${textShape(2, 'Notes Placeholder 2', [text], '<p:ph type="body" idx="1"/>')}
  </p:spTree></p:cSld></p:notes>`
}

/** The main-part content type each PPTX-family extension carries (design fact 1). */
export const PPTX_CONTENT_TYPES = {
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
  ppsx: 'application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml',
  pptm: 'application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml',
  ppsm: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.main+xml',
} as const

export async function pptxFixture(
  slides: readonly PptxSlideSpec[],
  { container = 'pptx', withMacroPart = false }: {
    container?: keyof typeof PPTX_CONTENT_TYPES
    /** Adds `ppt/vbaProject.bin`, as a real .pptm/.ppsm does. Never executed. */
    withMacroPart?: boolean
  } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const overrides = slides.map((_unused, index) =>
    `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')
  const notesOverrides = slides.map((slide, index) => slide.notes
    ? `<Override PartName="/ppt/notesSlides/notesSlide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`
    : '').join('')
  const slideRels = slides.map((_unused, index) =>
    `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`).join('')
  const slideIds = slides.map((_unused, index) =>
    `<p:sldId id="${256 + index}" r:id="rId${index + 1}"/>`).join('')

  const entries: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: utf8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Default Extension="png" ContentType="image/png"/>` +
      `<Default Extension="bin" ContentType="application/vnd.ms-office.vbaProject"/>` +
      `<Override PartName="/ppt/presentation.xml" ContentType="${PPTX_CONTENT_TYPES[container]}"/>` +
      `${overrides}${notesOverrides}</Types>`) },
    { name: '_rels/.rels', data: utf8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>` +
      `</Relationships>`) },
    { name: 'ppt/presentation.xml', data: utf8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">` +
      `<p:sldIdLst>${slideIds}</p:sldIdLst><p:sldSz cx="9144000" cy="6858000"/></p:presentation>`) },
    { name: 'ppt/_rels/presentation.xml.rels', data: utf8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slideRels}</Relationships>`) },
  ]

  slides.forEach((slide, index) => {
    entries.push({ name: `ppt/slides/slide${index + 1}.xml`, data: utf8(slideXml(slide)) })
    const rels: string[] = []
    if (slide.notes) {
      rels.push(`<Relationship Id="rIdNotes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${index + 1}.xml"/>`)
      entries.push({ name: `ppt/notesSlides/notesSlide${index + 1}.xml`, data: utf8(notesXml(slide.notes)) })
    }
    if (slide.image) {
      rels.push('<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>')
    }
    if (rels.length > 0) {
      entries.push({ name: `ppt/slides/_rels/slide${index + 1}.xml.rels`, data: utf8(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`) })
    }
  })

  if (slides.some((slide) => slide.image)) {
    entries.push({ name: 'ppt/media/image1.png', data: EMBEDDED_IMAGE_PNG })
  }
  if (withMacroPart) {
    // Deliberately not valid VBA. Its only job is to exist, so a test can prove
    // it is neither inflated nor packaged.
    entries.push({ name: 'ppt/vbaProject.bin', data: utf8('macro payload placeholder') })
  }

  return writeZip(entries) as Promise<Uint8Array<ArrayBuffer>>
}
```

- [ ] **Step 2: Write the failing index test**

```ts
// src/import/presentation/index.test.ts
import { readZipParts } from '../zip-read'
import { pptxFixture } from '../testing/presentation-fixtures'
import { wantedPresentationPart } from './parts'
import { readPresentationIndex } from './index'

async function indexOf(bytes: Uint8Array) {
  const parts = await readZipParts(bytes, (path) => wantedPresentationPart('pptx', path))
  return readPresentationIndex('pptx', Object.fromEntries(parts))
}

test('slides are numbered in presentation order, not part-name order', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'Photosynthesis', body: ['Light reactions'] },
    { title: 'Where it happens', body: ['Stroma'] },
  ]))

  expect(index.slides.map((slide) => slide.number)).toEqual([1, 2])
  expect(index.slides.map((slide) => slide.title)).toEqual(['Photosynthesis', 'Where it happens'])
})

test('a slide with no title placeholder reports no title (design fact 3)', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'First slide' },
    { body: ['Body of an untitled slide'] },
    { title: 'Third slide' },
  ]))

  expect(index.slides[1]!.title).toBeUndefined()
  expect(index.slides[1]!.textRuns).toEqual(['Body of an untitled slide'])
})

test('a title authored last in spTree is reported out of order (design fact 4)', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'Title last in XML', body: ['Body first in XML'], titleLast: true },
  ]))

  expect(index.slides[0]!.titleOutOfOrder).toBe(true)
  // Runs stay in the deck's OWN order. The index reports the disagreement; it
  // never silently re-sorts, because re-sorting invents an order nobody claimed.
  expect(index.slides[0]!.textRuns).toEqual(['Body first in XML', 'Title last in XML'])
})

test('speaker notes are found and kept apart from slide text (design fact 5)', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'Photosynthesis', body: ['Light reactions'], notes: 'Mention the thylakoid membrane.' },
    { title: 'No notes here', body: ['Stroma'] },
  ]))

  expect(index.slides[0]!.notesText).toBe('Mention the thylakoid membrane.')
  expect(index.slides[0]!.textRuns).not.toContain('Mention the thylakoid membrane.')
  expect(index.slides[1]!.notesText).toBeUndefined()
})

test('diagrams, charts, and media are counted per slide (design fact 6)', async () => {
  const index = await indexOf(await pptxFixture([
    { title: 'Process overview', diagram: true, chart: true, video: true },
  ]))

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 1, charts: 1, media: 1 })
})

test('a table is not counted as unrepresentable, because anydoc emits it', async () => {
  const index = await indexOf(await pptxFixture([{ title: 'Where it happens', table: true }]))

  expect(index.slides[0]!.unrepresentable).toEqual({ diagrams: 0, charts: 0, media: 0 })
})
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run --project unit src/import/presentation/index.test.ts`
Expected: FAIL — `readPresentationIndex is not exported`.

- [ ] **Step 4: Write `index.ts` (PPTX half)**

```ts
// src/import/presentation/index.ts
import type { PresentationPackageKind } from './parts'

/**
 * The deck's own account of itself — every question anydoc cannot answer.
 *
 * Parsed on the MAIN THREAD with `DOMParser`, because a Worker has none; see the
 * design's "Where the work happens" section and `parsers/probe.ts`'s note on the
 * PDF path for the same constraint stated where it was first met.
 */
export interface PresentationSlideIndex {
  /** 1-based, in presentation order: `sldIdLst` order, or `draw:page` order. */
  number: number
  /** Title placeholder text as authored. Absent when the slide has no title. */
  title?: string
  /** Text runs on the slide in the deck's own reading order. */
  textRuns: readonly string[]
  /** Notes text, when the slide has a notes part that is not whitespace. */
  notesText?: string
  /** The title placeholder is not first in reading order. */
  titleOutOfOrder: boolean
  /** Content anydoc drops with no block and no asset. */
  unrepresentable: { diagrams: number; charts: number; media: number }
}

export interface PresentationIndex {
  kind: PresentationPackageKind
  slides: readonly PresentationSlideIndex[]
}

export class PresentationIndexError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PresentationIndexError'
  }
}

const DRAWING_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PML_NS = 'http://schemas.openxmlformats.org/presentationml/2006/main'
const RELS_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const DIAGRAM_URI = 'http://schemas.openxmlformats.org/drawingml/2006/diagram'
const CHART_URI = 'http://schemas.openxmlformats.org/drawingml/2006/chart'

function parseXml(xml: string, what: string): Document {
  const parsed = new DOMParser().parseFromString(xml, 'application/xml')
  // `DOMParser` reports an XML syntax error as a document containing
  // `<parsererror>` rather than by throwing, so a caller that does not look for
  // it treats a broken part as an empty one.
  if (parsed.getElementsByTagName('parsererror').length > 0) {
    throw new PresentationIndexError(`This presentation's ${what} is not readable XML.`)
  }
  return parsed
}

function collapse(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim()
}

/** Text of one shape: its `a:t` runs joined, paragraph by paragraph. */
function shapeText(shape: Element): string {
  return collapse([...shape.getElementsByTagNameNS(DRAWING_NS, 't')]
    .map((run) => run.textContent ?? '')
    .join(' '))
}

function isTitleShape(shape: Element): boolean {
  const placeholder = shape.getElementsByTagNameNS(PML_NS, 'ph')[0]
  const type = placeholder?.getAttribute('type') ?? ''
  // `title` and `ctrTitle` are the two placeholder types PowerPoint uses for a
  // slide's title; `ctrTitle` is what a title-layout slide carries.
  return type === 'title' || type === 'ctrTitle'
}

function relationshipTargets(relsXml: string | undefined, type: string): string[] {
  if (!relsXml) return []
  const document = parseXml(relsXml, 'relationship part')
  return [...document.getElementsByTagNameNS(RELS_NS, 'Relationship')]
    .filter((relationship) => relationship.getAttribute('Type') === `${R_NS}/${type}`)
    .map((relationship) => relationship.getAttribute('Target') ?? '')
    .filter(Boolean)
}

/** `../notesSlides/notesSlide1.xml` relative to `ppt/slides/` is `ppt/notesSlides/…`. */
function resolveFromSlides(target: string): string {
  return `ppt/${target.replace(/^\.\.\//, '')}`
}

function pptxIndex(parts: Record<string, string>): PresentationIndex {
  const presentation = parts['ppt/presentation.xml']
  if (!presentation) {
    throw new PresentationIndexError('This presentation has no presentation part to read slides from.')
  }
  const presentationDocument = parseXml(presentation, 'presentation part')
  const relationships = parts['ppt/_rels/presentation.xml.rels']
  if (!relationships) {
    throw new PresentationIndexError('This presentation has no relationship part naming its slides.')
  }
  const relsDocument = parseXml(relationships, 'relationship part')
  const targetById = new Map<string, string>()
  for (const relationship of relsDocument.getElementsByTagNameNS(RELS_NS, 'Relationship')) {
    targetById.set(relationship.getAttribute('Id') ?? '', relationship.getAttribute('Target') ?? '')
  }

  // `sldIdLst` order IS presentation order. Part NUMBERS are not: a deck whose
  // slides were reordered keeps its original `slideN.xml` names, so sorting on
  // the filename would show the author's first draft rather than their deck.
  const slideIds = [...presentationDocument.getElementsByTagNameNS(PML_NS, 'sldId')]
  const slides: PresentationSlideIndex[] = []

  slideIds.forEach((slideId, position) => {
    const target = targetById.get(slideId.getAttributeNS(R_NS, 'id') ?? '')
    const path = target ? `ppt/${target.replace(/^\.\.\//, '')}` : undefined
    const xml = path ? parts[path] : undefined
    if (!xml) {
      throw new PresentationIndexError(
        `This presentation names a slide (${position + 1}) whose part is missing from the package.`,
      )
    }
    const slideDocument = parseXml(xml, `slide ${position + 1}`)
    const tree = slideDocument.getElementsByTagNameNS(PML_NS, 'spTree')[0]
    if (!tree) {
      throw new PresentationIndexError(`Slide ${position + 1} has no shape tree to read.`)
    }

    const textRuns: string[] = []
    let title: string | undefined
    let titleIndex = -1
    const unrepresentable = { diagrams: 0, charts: 0, media: 0 }

    // Direct children only, in document order — which for PPTX IS reading order
    // (it is what PowerPoint's own Reading Order pane shows).
    for (const shape of tree.children) {
      if (shape.namespaceURI === PML_NS && shape.localName === 'sp') {
        const text = shapeText(shape)
        if (isTitleShape(shape)) {
          if (title === undefined) {
            title = text
            titleIndex = textRuns.length
          }
        }
        if (text) textRuns.push(text)
        continue
      }
      if (shape.namespaceURI === PML_NS && shape.localName === 'graphicFrame') {
        const data = shape.getElementsByTagNameNS(DRAWING_NS, 'graphicData')[0]
        const uri = data?.getAttribute('uri') ?? ''
        if (uri === DIAGRAM_URI) unrepresentable.diagrams += 1
        else if (uri === CHART_URI) unrepresentable.charts += 1
        // A table frame is deliberately NOT counted: anydoc emits it as a real
        // data table (design fact 8), so it is not a loss to report.
        continue
      }
      if (shape.namespaceURI === PML_NS && shape.localName === 'pic') {
        // A picture carrying `a:videoFile` (or `a:audioFile`) is media, which
        // anydoc drops entirely. A plain picture is an ordinary image and
        // travels the existing asset path.
        const isMedia = shape.getElementsByTagNameNS(DRAWING_NS, 'videoFile').length > 0 ||
          shape.getElementsByTagNameNS(DRAWING_NS, 'audioFile').length > 0
        if (isMedia) unrepresentable.media += 1
      }
    }

    const notesTarget = relationshipTargets(
      parts[`ppt/slides/_rels/${path!.split('/').pop()}.rels`],
      'notesSlide',
    )[0]
    const notesXml = notesTarget ? parts[resolveFromSlides(notesTarget)] : undefined
    const notesText = notesXml
      ? collapse([...parseXml(notesXml, 'notes part').getElementsByTagNameNS(DRAWING_NS, 't')]
          .map((run) => run.textContent ?? '').join(' ')) || undefined
      : undefined

    slides.push({
      number: position + 1,
      ...(title ? { title } : {}),
      textRuns,
      ...(notesText ? { notesText } : {}),
      titleOutOfOrder: titleIndex > 0,
      unrepresentable,
    })
  })

  return { kind: 'pptx', slides }
}

export function readPresentationIndex(
  kind: PresentationPackageKind,
  parts: Record<string, string>,
): PresentationIndex {
  return kind === 'pptx' ? pptxIndex(parts) : odpIndex(parts)
}
```

> `odpIndex` arrives in Task 5. Until then, stub it as
> `function odpIndex(_parts: Record<string, string>): PresentationIndex { throw new PresentationIndexError('ODP indexing arrives in Task 5.') }`
> and delete the stub in that task.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project unit src/import/presentation/index.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the full suite and typecheck, then commit**

```bash
npm run typecheck && npx vitest run
git add src/import/presentation/index.ts src/import/presentation/index.test.ts \
        src/import/testing/presentation-fixtures.ts
git commit -m "feat: read a pptx deck's slides, notes, and losses from its package"
```

---

### Task 4: Settle the layout-chain title question

**Files:**
- Modify: `src/import/presentation/index.ts`
- Modify: `src/import/presentation/index.test.ts`
- Modify: `.scratch/document-import/14-graduate-presentations-design.md` (record the answer)

This is the design's one open question, and it must be answered before the corpus is built,
because its answer changes what "untitled" means.

**The question:** Task 3's `isTitleShape` requires the slide itself to carry
`<p:ph type="title"/>`. Real decks inherit placeholders from a slide layout, and a slide may
identify its title only by `idx` reference into that layout. If that is common, every such
slide reads as untitled and every deck drowns in warnings.

- [ ] **Step 1: Measure it**

Write a throwaway script under `.scratch/` (delete it in Step 4) that builds a PPTX whose
title shape carries **only** `<p:ph type="title"/>` versus one whose title shape carries only
`<p:ph idx="0"/>` with the type living in the layout part, and run both through
`readPresentationIndex`. Also check what anydoc emits for each, since a slide anydoc does not
treat as a heading cannot be reconciled to one either.

Record in the design's `## Measured facts` as fact 9, with the date.

- [ ] **Step 2: Decide, and write the decision into the design**

Apply this rule, decided in advance so the measurement cannot be rationalized:

- **If a bare `<p:ph type="title"/>` is what PowerPoint actually writes on ordinary slides**
  (the likely case — the type is written on the slide, not only inherited), keep Task 3's
  implementation and record fact 9 as confirming it. Add a test pinning the `ctrTitle` case.
- **If titles are commonly identified only by `idx`**, extend the index to read the slide's
  layout part to resolve the placeholder type. This means adding
  `/^ppt\/slideLayouts\/slideLayout\d+\.xml$/` and its rels to `PPTX_PATTERNS`
  (`presentation/parts.ts`) and following `slideLayout` relationships from each slide.
- **In either case, an unresolvable title stays a warning, never a blocker.** An untitled
  slide is already a supported outcome with an editable generated title, so the worst
  consequence of a miss is a warning a user can act on.

- [ ] **Step 3: Add the test for whichever branch was taken**

```ts
test('a centre-title placeholder is a title (the layout PowerPoint gives slide 1)', async () => {
  const index = await indexOf(await pptxFixture([{ title: 'Photosynthesis' }]))
  expect(index.slides[0]!.title).toBe('Photosynthesis')
})
```

If the second branch was taken, add a fixture option emitting an `idx`-only placeholder and a
test proving the layout chain resolves it.

- [ ] **Step 4: Delete the throwaway script, run everything, commit**

```bash
npm run typecheck && npx vitest run
git add src/import/presentation/ .scratch/document-import/14-graduate-presentations-design.md
git commit -m "fix: settle how a slide names its title, and record what decks do"
```

---

### Task 5: An ODP package index

**Files:**
- Modify: `src/import/presentation/index.ts` (replace the `odpIndex` stub)
- Modify: `src/import/presentation/index.test.ts`
- Modify: `src/import/testing/presentation-fixtures.ts` (add `odpFixture`)

**Interfaces:**
- Produces: `odpFixture(pages, options?): Promise<Uint8Array<ArrayBuffer>>` and a working
  `readPresentationIndex('odp', parts)`.

ODP keeps every page in one `content.xml`, and marks roles explicitly with
`presentation:class`, so it needs no relationship walking at all.

- [ ] **Step 1: Add `odpFixture` to `presentation-fixtures.ts`**

```ts
const ODP_NS = {
  office: 'urn:oasis:names:tc:opendocument:xmlns:office:1.0',
  text: 'urn:oasis:names:tc:opendocument:xmlns:text:1.0',
  draw: 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0',
  presentation: 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0',
  svg: 'urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0',
  xlink: 'http://www.w3.org/1999/xlink',
}

export interface OdpPageSpec {
  title?: string
  body?: readonly string[]
  notes?: string
  /** Emit the title frame LAST in the page — ODP's form of design fact 4. */
  titleLast?: boolean
  image?: { alt?: string }
}

function odpFrame(name: string, presentationClass: string, paragraphs: readonly string[]): string {
  const attribute = presentationClass ? ` presentation:class="${presentationClass}"` : ''
  return `<draw:frame draw:name="${name}"${attribute} svg:width="20cm" svg:height="3cm" svg:x="2cm" svg:y="1cm">` +
    `<draw:text-box>${paragraphs.map((text) => `<text:p>${xmlEscape(text)}</text:p>`).join('')}</draw:text-box>` +
    `</draw:frame>`
}

export async function odpFixture(pages: readonly OdpPageSpec[]): Promise<Uint8Array<ArrayBuffer>> {
  const body = pages.map((page, index) => {
    const title = page.title === undefined ? '' : odpFrame(`Title ${index + 1}`, 'title', [page.title])
    const outline = page.body?.length ? odpFrame(`Body ${index + 1}`, 'outline', page.body) : ''
    const image = page.image
      ? `<draw:frame draw:name="Diagram ${index + 1}" svg:width="1cm" svg:height="1cm">` +
        `<draw:image xlink:href="Pictures/image1.png" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
        (page.image.alt === undefined ? '' : `<svg:desc>${xmlEscape(page.image.alt)}</svg:desc>`) +
        `</draw:frame>`
      : ''
    const notes = page.notes
      ? `<presentation:notes>${odpFrame(`Notes ${index + 1}`, 'notes', [page.notes])}</presentation:notes>`
      : ''
    const frames = page.titleLast ? `${outline}${image}${title}` : `${title}${outline}${image}`
    return `<draw:page draw:name="Slide ${index + 1}" draw:master-page-name="Default">${frames}${notes}</draw:page>`
  }).join('')

  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content ${Object.entries(ODP_NS).map(([prefix, uri]) => `xmlns:${prefix}="${uri}"`).join(' ')} office:version="1.2">
  <office:body><office:presentation>${body}</office:presentation></office:body>
</office:document-content>`

  const entries: { name: string; data: Uint8Array }[] = [
    { name: 'mimetype', data: utf8('application/vnd.oasis.opendocument.presentation') },
    { name: 'META-INF/manifest.xml', data: utf8(
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
      `<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.presentation"/>` +
      `<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>` +
      (pages.some((page) => page.image)
        ? `<manifest:file-entry manifest:full-path="Pictures/image1.png" manifest:media-type="image/png"/>`
        : '') +
      `</manifest:manifest>`) },
    { name: 'content.xml', data: utf8(content) },
  ]
  if (pages.some((page) => page.image)) {
    entries.push({ name: 'Pictures/image1.png', data: EMBEDDED_IMAGE_PNG })
  }
  return writeZip(entries) as Promise<Uint8Array<ArrayBuffer>>
}
```

- [ ] **Step 2: Write the failing tests**

```ts
// append to src/import/presentation/index.test.ts
import { odpFixture } from '../testing/presentation-fixtures'

async function odpIndexOf(bytes: Uint8Array) {
  const parts = await readZipParts(bytes, (path) => wantedPresentationPart('odp', path))
  return readPresentationIndex('odp', Object.fromEntries(parts))
}

test('odp pages are numbered in document order with their titles', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'Photosynthesis', body: ['Light reactions'] },
    { title: 'Where it happens', body: ['Stroma'] },
  ]))

  expect(index.kind).toBe('odp')
  expect(index.slides.map((slide) => slide.title)).toEqual(['Photosynthesis', 'Where it happens'])
})

test('an odp page with no title frame reports no title', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'First page' },
    { body: ['Body of an untitled page'] },
  ]))

  expect(index.slides[1]!.title).toBeUndefined()
})

test('odp notes are found and kept out of the page text', async () => {
  const index = await odpIndexOf(await odpFixture([
    { title: 'Photosynthesis', body: ['Light reactions'], notes: 'Mention the thylakoid membrane.' },
  ]))

  expect(index.slides[0]!.notesText).toBe('Mention the thylakoid membrane.')
  expect(index.slides[0]!.textRuns).not.toContain('Mention the thylakoid membrane.')
})

test('an odp title frame authored last is NOT out of order, because anydoc hoists it', async () => {
  /*
   * Design fact 4: measured 2026-08-29, ODP hoists a `presentation:class="title"`
   * frame to the top of its page while PPTX preserves `spTree` order. The index
   * reports what the CONSUMER will see, so ODP's title is in order even when it
   * is authored last — otherwise every such deck would carry a warning about a
   * disagreement that does not exist downstream.
   */
  const index = await odpIndexOf(await odpFixture([
    { title: 'Title last in XML', body: ['Body first in XML'], titleLast: true },
  ]))

  expect(index.slides[0]!.titleOutOfOrder).toBe(false)
  expect(index.slides[0]!.textRuns).toEqual(['Title last in XML', 'Body first in XML'])
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run --project unit src/import/presentation/index.test.ts`
Expected: FAIL — `ODP indexing arrives in Task 5.`

- [ ] **Step 4: Replace the `odpIndex` stub**

```ts
const ODF_OFFICE_NS = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0'
const ODF_DRAW_NS = 'urn:oasis:names:tc:opendocument:xmlns:drawing:1.0'
const ODF_PRESENTATION_NS = 'urn:oasis:names:tc:opendocument:xmlns:presentation:1.0'

function odpIndex(parts: Record<string, string>): PresentationIndex {
  const content = parts['content.xml']
  if (!content) {
    throw new PresentationIndexError('This presentation has no content part to read pages from.')
  }
  const document = parseXml(content, 'content part')
  const presentation = document.getElementsByTagNameNS(ODF_OFFICE_NS, 'presentation')[0]
  if (!presentation) {
    throw new PresentationIndexError('This presentation has no pages to read.')
  }

  const slides = [...presentation.getElementsByTagNameNS(ODF_DRAW_NS, 'page')].map((page, position) => {
    const notesElement = page.getElementsByTagNameNS(ODF_PRESENTATION_NS, 'notes')[0]
    const notesText = notesElement ? collapse(notesElement.textContent) || undefined : undefined
    // Notes live INSIDE the page element, so every text query below must exclude
    // that subtree — otherwise a note would be read as page text, which is the
    // exact confusion this index exists to prevent.
    const frames = [...page.getElementsByTagNameNS(ODF_DRAW_NS, 'frame')]
      .filter((frame) => !notesElement?.contains(frame))

    const textRuns: string[] = []
    let title: string | undefined
    for (const frame of frames) {
      const text = collapse(frame.textContent)
      if (frame.getAttributeNS(ODF_PRESENTATION_NS, 'class') === 'title' && title === undefined) {
        title = text
      }
      if (text) textRuns.push(text)
    }

    /*
     * ODP hoists a title frame to the top of its page regardless of where it was
     * authored (design fact 4, measured 2026-08-29), so a title is never out of
     * order downstream. Reporting the AUTHORED position here would raise a
     * warning about a disagreement the reader never sees. The runs are ordered
     * to match, title first.
     */
    const ordered = title === undefined
      ? textRuns
      : [title, ...textRuns.filter((run) => run !== title)]

    return {
      number: position + 1,
      ...(title ? { title } : {}),
      textRuns: ordered,
      ...(notesText ? { notesText } : {}),
      titleOutOfOrder: false,
      // ODF carries charts and media as embedded objects rather than as the
      // distinct frame kinds PPTX uses. Nothing in the corpus exercises one
      // yet, so nothing is claimed: this reports zero rather than guessing, and
      // Task 12's verdict records it as a known limit of the ODP evidence.
      unrepresentable: { diagrams: 0, charts: 0, media: 0 },
    }
  })

  return { kind: 'odp', slides }
}
```

- [ ] **Step 5: Run the tests, typecheck, commit**

```bash
npx vitest run --project unit src/import/presentation/index.test.ts
npm run typecheck && npx vitest run
git add src/import/presentation/index.ts src/import/presentation/index.test.ts \
        src/import/testing/presentation-fixtures.ts
git commit -m "feat: read an odp deck's pages, notes, and reading order"
```

---

### Task 6: The reconciler

**Files:**
- Create: `src/import/presentation/reconcile.ts`
- Create: `src/import/presentation/reconcile.test.ts`

**Interfaces:**
- Consumes: `blocksOf` from `../page-plan`, `PresentationIndex` from `./index`, `ImportFinding` from `../types`.
- Produces: `reconcilePresentation({ html, index, sourceLabel }): { html: string; findings: ImportFinding[] }`.

This is where every design decision becomes code. Read the design's "What each situation
produces" table before starting; each row below is one test.

- [ ] **Step 1: Write the failing tests**

```ts
// src/import/presentation/reconcile.test.ts
import { reconcilePresentation } from './reconcile'
import type { PresentationIndex } from './index'

const index = (slides: PresentationIndex['slides']): PresentationIndex => ({ kind: 'pptx', slides })

const slide = (
  number: number,
  overrides: Partial<PresentationIndex['slides'][number]> = {},
): PresentationIndex['slides'][number] => ({
  number,
  textRuns: [],
  titleOutOfOrder: false,
  unrepresentable: { diagrams: 0, charts: 0, media: 0 },
  ...overrides,
})

test('each slide becomes one section carrying its number', () => {
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><p>Light reactions</p><h2>Where it happens</h2><p>Stroma</p>',
    index: index([
      slide(1, { title: 'Photosynthesis', textRuns: ['Photosynthesis', 'Light reactions'] }),
      slide(2, { title: 'Where it happens', textRuns: ['Where it happens', 'Stroma'] }),
    ]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toBe(
    '<section data-slide="1" data-plan-label="Slide 1: Photosynthesis">' +
    '<h2 id="slide-1">Photosynthesis</h2><p>Light reactions</p></section>' +
    '<section data-slide="2" data-plan-label="Slide 2: Where it happens">' +
    '<h2 id="slide-2">Where it happens</h2><p>Stroma</p></section>',
  )
  expect(result.findings).toEqual([])
})

test('an untitled slide gets a generated, editable title and a warning', () => {
  const result = reconcilePresentation({
    html: '<h2>First slide</h2><p>Body of an untitled slide</p><h2>Third slide</h2>',
    index: index([
      slide(1, { title: 'First slide', textRuns: ['First slide'] }),
      slide(2, { textRuns: ['Body of an untitled slide'] }),
      slide(3, { title: 'Third slide', textRuns: ['Third slide'] }),
    ]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toContain('<section data-slide="2" data-plan-label="Slide 2"><h2 id="slide-2">Slide 2</h2>')
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-untitled-slide',
    severity: 'warning',
    sourcePage: 2,
  }))
})

test('speaker notes are removed from the page and named in a warning', () => {
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><p>Light reactions</p><blockquote><p>Mention the thylakoid membrane.</p></blockquote>',
    index: index([slide(1, {
      title: 'Photosynthesis',
      textRuns: ['Photosynthesis', 'Light reactions'],
      notesText: 'Mention the thylakoid membrane.',
    })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).not.toContain('thylakoid')
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-speaker-notes',
    severity: 'warning',
    sourcePage: 1,
  }))
})

test('a real quotation is NOT mistaken for speaker notes', () => {
  const result = reconcilePresentation({
    html: '<h2>Photosynthesis</h2><blockquote><p>Energy cannot be created.</p></blockquote>',
    index: index([slide(1, {
      title: 'Photosynthesis',
      textRuns: ['Photosynthesis', 'Energy cannot be created.'],
      notesText: 'Mention the thylakoid membrane.',
    })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toContain('Energy cannot be created.')
  expect(result.findings.map((finding) => finding.code)).not.toContain('presentation-speaker-notes')
})

test('a diagram, chart, or media is named on its own slide', () => {
  const result = reconcilePresentation({
    html: '<h2>Process overview</h2>',
    index: index([slide(1, {
      title: 'Process overview',
      textRuns: ['Process overview'],
      unrepresentable: { diagrams: 1, charts: 1, media: 2 },
    })]),
    sourceLabel: 'PPTX',
  })

  const finding = result.findings.find((entry) => entry.code === 'presentation-unrepresentable')!
  expect(finding.severity).toBe('warning')
  expect(finding.sourcePage).toBe(1)
  expect(finding.message).toMatch(/1 diagram, 1 chart, 2 media/)
})

test('a title out of reading order warns and does not reorder the content', () => {
  const result = reconcilePresentation({
    html: '<p>Body first in XML</p><h2>Title last in XML</h2>',
    index: index([slide(1, {
      title: 'Title last in XML',
      textRuns: ['Body first in XML', 'Title last in XML'],
      titleOutOfOrder: true,
    })]),
    sourceLabel: 'PPTX',
  })

  expect(result.html).toContain('<p>Body first in XML</p><h2 id="slide-1">Title last in XML</h2>')
  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-reading-order',
    severity: 'warning',
    sourcePage: 1,
  }))
})

test('content that cannot be attributed to a slide blocks the import', () => {
  const result = reconcilePresentation({
    // A paragraph the index knows nothing about: the two accounts disagree, and
    // guessing where it belongs is exactly the silent error this blocks on.
    html: '<h2>Photosynthesis</h2><p>Text no slide claims</p>',
    index: index([slide(1, { title: 'Photosynthesis', textRuns: ['Photosynthesis'] })]),
    sourceLabel: 'PPTX',
  })

  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-unattributed-content',
    severity: 'blocker',
  }))
})

test('a deck with no slides at all blocks rather than producing an empty page', () => {
  const result = reconcilePresentation({ html: '', index: index([]), sourceLabel: 'PPTX' })

  expect(result.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-unattributed-content',
    severity: 'blocker',
  }))
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/presentation/reconcile.test.ts`
Expected: FAIL — `Failed to resolve import "./reconcile"`.

- [ ] **Step 3: Write `reconcile.ts`**

```ts
// src/import/presentation/reconcile.ts
import { blocksOf } from '../page-plan'
import type { ImportFinding } from '../types'
import type { PresentationIndex, PresentationSlideIndex } from './index'

/**
 * Aligns the deck's own account of itself against what anydoc produced.
 *
 * THE WALK IS MONOTONIC. Blocks are consumed forward, slides are consumed
 * forward, and neither is ever reordered or revisited. The temptation with two
 * lists is to search for the best global alignment, but a search invents an order
 * neither source claimed — and being confidently wrong about which slide a
 * paragraph came from is the failure this whole module exists to prevent. A
 * forward-only walk can only confirm or fail, and failing is the right outcome
 * when the accounts disagree.
 *
 * Output is one `<section data-slide="N">` per slide. `section` and `data-*` are
 * both already on the Canvas allowlist (`engine/allowlist.ts`), and `h1` is not,
 * which is why slide titles stay at the `h2` anydoc already emits.
 */
export interface ReconcileOptions {
  html: string
  index: PresentationIndex
  /** `PPTX` or `ODP`, for finding messages. */
  sourceLabel: string
}

export interface ReconcileResult {
  html: string
  findings: ImportFinding[]
}

const collapse = (value: string) => value.replace(/\s+/g, ' ').trim()

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function escapeText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Text of one serialized top-level block, for matching against the index's runs. */
function blockText(html: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return collapse(parsed.body.textContent ?? '')
}

function countPhrase(counts: PresentationSlideIndex['unrepresentable']): string {
  return [
    counts.diagrams > 0 ? `${counts.diagrams} diagram${counts.diagrams === 1 ? '' : 's'}` : '',
    counts.charts > 0 ? `${counts.charts} chart${counts.charts === 1 ? '' : 's'}` : '',
    counts.media > 0 ? `${counts.media} media` : '',
  ].filter(Boolean).join(', ')
}

export function reconcilePresentation(options: ReconcileOptions): ReconcileResult {
  const findings: ImportFinding[] = []
  const blocks = blocksOf(options.html)
  const slides = options.index.slides
  const sections: string[] = []
  let at = 0

  if (slides.length === 0) {
    findings.push({
      code: 'presentation-unattributed-content',
      severity: 'blocker',
      message: `This ${options.sourceLabel} declares no slides, so its content cannot be attributed to any slide.`,
    })
    return { html: options.html, findings }
  }

  for (const slide of slides) {
    const wanted = slide.textRuns.map(collapse).filter(Boolean)
    const taken: string[] = []

    // Consume blocks while they match runs this slide claims. A block whose text
    // no remaining run of this slide accounts for ends the slide — it belongs to
    // the next one, or to nobody, and the check after the loop decides which.
    const remaining = [...wanted]
    while (at < blocks.length) {
      const text = blockText(blocks[at]!.html)
      if (text) {
        const match = remaining.findIndex((run) => run === text || run.includes(text) || text.includes(run))
        if (match === -1) break
        remaining.splice(match, 1)
      }
      // Notes reach the page as a `<blockquote>` indistinguishable from a real
      // quotation (design fact 5). The index is the only thing that can tell
      // them apart, so the comparison is against `notesText` and nothing else.
      const isNotes = slide.notesText !== undefined &&
        blocks[at]!.html.startsWith('<blockquote') &&
        collapse(text) === collapse(slide.notesText)
      if (!isNotes) taken.push(blocks[at]!.html)
      at += 1
    }

    const title = slide.title?.trim() || `Slide ${slide.number}`
    if (!slide.title?.trim()) {
      findings.push({
        code: 'presentation-untitled-slide',
        severity: 'warning',
        sourcePage: slide.number,
        message: `Slide ${slide.number} has no title. It was titled "Slide ${slide.number}" so it can be found and renamed.`,
      })
    }
    if (slide.notesText !== undefined) {
      findings.push({
        code: 'presentation-speaker-notes',
        severity: 'warning',
        sourcePage: slide.number,
        message: `Slide ${slide.number} has speaker notes. They were not imported, because notes are written for the presenter rather than the reader.`,
      })
    }
    if (slide.titleOutOfOrder) {
      findings.push({
        code: 'presentation-reading-order',
        severity: 'warning',
        sourcePage: slide.number,
        message: `On slide ${slide.number} the title is not first in the deck's reading order, so this section may not read top to bottom. Check it before publishing.`,
      })
    }
    const phrase = countPhrase(slide.unrepresentable)
    if (phrase) {
      findings.push({
        code: 'presentation-unrepresentable',
        severity: 'warning',
        sourcePage: slide.number,
        message: `Slide ${slide.number} contains ${phrase} that could not be imported. Add the content in Canvas afterwards.`,
      })
    }

    // A slide whose title never reached the HTML still gets a heading, so every
    // section is navigable and every slide is visible in the plan editor.
    const heading = taken.some((block) => block.startsWith('<h'))
      ? ''
      : `<h2 id="slide-${slide.number}">${escapeText(title)}</h2>`
    const body = taken
      .map((block) => block.startsWith('<h2')
        ? block.replace(/^<h2/, `<h2 id="slide-${slide.number}"`)
        : block)
      .join('')
    const label = slide.title?.trim() ? `Slide ${slide.number}: ${title}` : `Slide ${slide.number}`
    sections.push(
      `<section data-slide="${slide.number}" data-plan-label="${escapeAttribute(label)}">` +
      `${heading}${body}</section>`,
    )
  }

  if (at < blocks.length) {
    const orphan = blockText(blocks[at]!.html)
    findings.push({
      code: 'presentation-unattributed-content',
      severity: 'blocker',
      message:
        `This ${options.sourceLabel} produced content that belongs to no slide (starting "${orphan.slice(0, 60)}"). ` +
        'Publishing it under the wrong slide would be a silent error, so this file must be resolved before it can be imported.',
    })
  }

  return { html: sections.join(''), findings }
}
```

> **On the `h2` id rewrite:** anydoc emits a slide title as a bare `<h2>` with no id (design
> fact 2), so the id is added here. If Task 4's measurement showed anydoc emitting an
> `anchor`-derived id on presentation headings, keep that id and drop the rewrite — an id the
> document chose beats one we invented, and the corpus case will catch the difference.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/import/presentation/reconcile.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck, full suite, commit**

```bash
npm run typecheck && npx vitest run
git add src/import/presentation/reconcile.ts src/import/presentation/reconcile.test.ts
git commit -m "feat: attribute a deck's blocks to slides, and refuse when they do not fit"
```

---

### Task 7: The plan editor reads slide boundaries

**Files:**
- Modify: `src/import/page-plan.ts` (`blocksOf`)
- Modify: `src/import/page-plan.test.ts`

**Interfaces:**
- Produces: `blocksOf` honouring `data-plan-label`.

Without this, `proposeRanges` is fine — a deck has no top-level heading left to split on, so
it already proposes one page — but every split point in the editor reads
`Section: Photosynthesis Light reactions Calvin cycle…`. The seam is named for the plan, not
for slides: a block declares its own label, and `page-plan.ts` learns nothing about
presentations.

- [ ] **Step 1: Write the failing tests**

```ts
// append to src/import/page-plan.test.ts
test('a block may declare its own plan label', () => {
  const blocks = blocksOf('<section data-plan-label="Slide 2: Photosynthesis"><h2>Photosynthesis</h2><p>Light</p></section>')

  expect(blocks).toHaveLength(1)
  expect(blocks[0]!.summary).toBe('Slide 2: Photosynthesis')
})

test('a deck of sections proposes one page, not one page per slide', () => {
  // Every slide title is an `h2`, so WITHOUT the section wrapper `proposeRanges`
  // would split at the minimum repeated heading level and propose one page per
  // slide. Wrapping makes each slide a single top-level block with no top-level
  // heading, which is the existing "no repeated heading" path.
  const work = {
    id: 'deck', title: 'Lecture', format: 'pptx' as const, assets: [],
    provenance: { rightsAuthority: 'own' as const, rightsAcknowledged: true, source: { kind: 'local-file' as const } },
    sections: [{ id: 'deck-section', title: 'Lecture', order: 0, html:
      '<section data-slide="1" data-plan-label="Slide 1: A"><h2>A</h2></section>' +
      '<section data-slide="2" data-plan-label="Slide 2: B"><h2>B</h2></section>' }],
  }
  const proposed = proposePagePlan(work as never)

  expect(proposed.plan.pages).toHaveLength(1)
  expect(proposed.plan.blocks.map((block) => block.summary)).toEqual(['Slide 1: A', 'Slide 2: B'])
})
```

> Match the `ImportedWork` literal to whatever shape `page-plan.test.ts` already builds for
> its other cases; reuse that file's existing helper if it has one rather than adding a
> second way to build a work.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/page-plan.test.ts`
Expected: FAIL — the summary is `Section: …`.

- [ ] **Step 3: Honour the attribute in `blocksOf`**

In `src/import/page-plan.ts`, inside `blocksOf`'s element branch, before the
`HEADING_LEVEL` lookup:

```ts
      // A block may name itself. The presentation importer uses this so split
      // points read as slide boundaries; nothing here knows what a slide is,
      // which is the point of naming the attribute for the plan rather than for
      // the format that happens to set it.
      const declared = element.getAttribute('data-plan-label')?.trim()
```

and use it where the summary is built:

```ts
      if (level) {
        blocks.push({
          html: element.outerHTML,
          heading: { level, text },
          summary: declared || `Heading: ${excerpt(text)}`,
        })
      } else {
        const kind = KIND_LABEL[tag] ?? `<${tag}>`
        blocks.push({
          html: element.outerHTML,
          summary: declared || (text ? `${kind}: ${excerpt(text)}` : kind),
        })
      }
```

- [ ] **Step 4: Run the tests, typecheck, commit**

```bash
npx vitest run --project unit src/import/page-plan.test.ts
npm run typecheck && npx vitest run
git add src/import/page-plan.ts src/import/page-plan.test.ts
git commit -m "feat: let a block declare its own label in the page plan"
```

---

### Task 8: Wire presentations into the import path

**Files:**
- Modify: `src/import/capability.ts`
- Modify: `src/import/document.ts`
- Modify: `src/import/capability.test.ts`
- Modify: `src/import/document.browser.test.ts` (or add `presentation.browser.test.ts`)

**Interfaces:**
- Consumes: `reconcilePresentation`, `readPresentationIndex`, the `presentation` result field.
- Produces: importable `.pptx`/`.pptm`/`.ppsx`/`.ppsm`/`.odp` files.

- [ ] **Step 1: Add the capability entries**

Append to `DOCUMENT_FORMAT_CAPABILITIES` in `src/import/capability.ts`, after `epub`:

```ts
  {
    format: 'pptx',
    label: 'PowerPoint presentation',
    /*
     * ONE entry for four extensions, not four entries.
     * `importStructuredDocument` requires `parsed.detectedFormat === capability.format`,
     * and every PPTX-family container — presentation, slideshow, and both
     * macro-enabled variants — reports `pptx` from its content type (design
     * fact 1, measured 2026-08-29). Separate `pptm`/`ppsx`/`ppsm` entries would
     * therefore fail that check on every real file.
     */
    extensions: ['.pptx', '.pptm', '.ppsx', '.ppsm'],
    mediaTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.presentationml.slideshow',
      'application/vnd.ms-powerpoint.presentation.macroEnabled.12',
      'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
    ],
    parser: 'anydoc',
    status: 'enabled',
    limitations: [
      'Speaker notes are not imported; slides that had them are listed so you can add what students need.',
      'Diagrams, charts, and embedded audio or video are not imported — add them in Canvas afterwards.',
      'A slide with no title is titled by its number so you can rename it.',
      'An equation blocks import; equation rendering is not supported yet.',
      'Macros are never read or run.',
    ],
    probe: parserProbe('anydoc', 'pptx'),
  },
  {
    format: 'odp',
    label: 'OpenDocument presentation',
    extensions: ['.odp'],
    mediaTypes: ['application/vnd.oasis.opendocument.presentation'],
    parser: 'anydoc',
    status: 'enabled',
    limitations: [
      'Speaker notes are not imported; pages that had them are listed so you can add what students need.',
      'A page with no title is titled by its number so you can rename it.',
      'An equation blocks import; equation rendering is not supported yet.',
    ],
    probe: parserProbe('anydoc', 'odp'),
  },
```

> **Both entries start as `status: 'enabled'` so the corpus can exercise them.** Task 12
> applies the bar and flips either to `'probe-only'` if it does not clear. Do not treat the
> value written here as the verdict.

- [ ] **Step 2: Write the failing integration test**

```ts
// src/import/presentation.browser.test.ts
import { importStructuredDocument } from './document'
import { pptxFixture, odpFixture } from './testing/presentation-fixtures'

const metadata = { title: 'Lecture', rightsAuthority: 'own' as const, rightsAcknowledged: true }

const deckFile = (bytes: Uint8Array, name = 'lecture.pptx') =>
  new File([bytes], name, { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' })

test('a deck imports as one page of slide sections', async () => {
  const bytes = await pptxFixture([
    { title: 'Photosynthesis', body: ['Light reactions', 'Calvin cycle'] },
    { title: 'Where it happens', table: true },
  ])
  const result = await importStructuredDocument(deckFile(bytes), { metadata })

  expect(result.work.sections).toHaveLength(1)
  expect(result.work.sections[0]!.html).toContain('<section data-slide="1"')
  expect(result.work.sections[0]!.html).toContain('<section data-slide="2"')
  expect(result.work.sections[0]!.html).toContain('<table')
})

test('speaker notes never reach the imported page', async () => {
  const bytes = await pptxFixture([
    { title: 'Photosynthesis', body: ['Light reactions'], notes: 'Do not read this to the class.' },
  ])
  const result = await importStructuredDocument(deckFile(bytes), { metadata })

  expect(result.work.sections[0]!.html).not.toContain('Do not read this')
  expect(result.report.findings).toContainEqual(expect.objectContaining({
    code: 'presentation-speaker-notes', sourcePage: 1,
  }))
})

test('a .ppsm slideshow imports through the same pptx capability', async () => {
  const bytes = await pptxFixture([{ title: 'Show deck' }], { container: 'ppsm', withMacroPart: true })
  const file = new File([bytes], 'lecture.ppsm', {
    type: 'application/vnd.ms-powerpoint.slideshow.macroEnabled.12',
  })
  const result = await importStructuredDocument(file, { metadata })

  expect(result.report.format).toBe('pptx')
  expect(result.work.sections[0]!.html).toContain('Show deck')
})

test('an odp deck imports as slide sections', async () => {
  const bytes = await odpFixture([{ title: 'Photosynthesis', body: ['Light reactions'] }])
  const file = new File([bytes], 'lecture.odp', {
    type: 'application/vnd.oasis.opendocument.presentation',
  })
  const result = await importStructuredDocument(file, { metadata })

  expect(result.work.sections[0]!.html).toContain('<section data-slide="1"')
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run --project browser src/import/presentation.browser.test.ts`
Expected: FAIL — no sections; the HTML is anydoc's unreconciled output.

- [ ] **Step 4: Route presentations in `document.ts`**

Add the imports:

```ts
import { readPresentationIndex } from './presentation/index'
import { reconcilePresentation } from './presentation/reconcile'
```

Then, after the existing `if (!parsed.normalized) throw …` guard and **before** the
`visibleText` check (so the emptiness guard sees the reconciled HTML):

```ts
  // A presentation's normalized HTML is anydoc's account only. Reconciling it
  // against the deck's own index is what turns it into sections a reader can
  // trust — and what refuses the file when the two accounts disagree.
  let html = parsed.normalized.html
  const presentationFindings: ImportFinding[] = []
  if (capability.format === 'pptx' || capability.format === 'odp') {
    if (!parsed.presentation) {
      throw new Error(
        `This ${capability.label} could not be read as a package, so its slides cannot be identified.`,
      )
    }
    const index = readPresentationIndex(parsed.presentation.kind, parsed.presentation.parts)
    const reconciled = reconcilePresentation({
      html,
      index,
      sourceLabel: capability.format.toUpperCase(),
    })
    html = reconciled.html
    presentationFindings.push(...reconciled.findings)
  }
```

Replace the three later uses of `parsed.normalized.html` with `html`, and merge the
findings:

```ts
  const findings = [...parsed.normalized.findings, ...presentationFindings]
    .map((finding) => ({ ...finding, sectionId }))
```

> `ImportFinding` must be added to the type import at the top of `document.ts`.
> `presentationFindings` already carry `sourcePage`; spreading `sectionId` over them keeps
> both, because `sourcePage` and `sectionId` are different fields.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project browser src/import/presentation.browser.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Update the capability test, then typecheck and commit**

`capability.test.ts` asserts the table's shape; extend whatever it already checks (unique
formats, non-empty limitations, `accept` strings) to cover the two new rows. Then:

```bash
npm run typecheck && npx vitest run
git add src/import/capability.ts src/import/capability.test.ts src/import/document.ts \
        src/import/presentation.browser.test.ts
git commit -m "feat: import presentations as reconciled slide sections"
```

---

### Task 9: Corpus cases

**Files:**
- Modify: `src/import/testing/corpus.ts`

Every claim the capability table makes needs a corpus case behind it, driven through the real
parser by `corpus.browser.test.ts`. Follow the existing cases exactly: `standsInFor` is
required, `expectInHtml` proves structure survived, `expectBlockers` declares what legitimately
blocks.

- [ ] **Step 1: Add the cases**

```ts
// in src/import/testing/corpus.ts, importing pptxFixture / odpFixture
  {
    id: 'pptx-semantic',
    format: 'pptx',
    standsInFor: 'An ordinary lecture deck: titled slides, bulleted bodies, and a table — the shape most instructor presentations actually have.',
    bytes: () => pptxFixture([
      { title: 'Photosynthesis', body: ['Light reactions', 'Calvin cycle'] },
      { title: 'Where it happens', table: true },
    ]),
    expectInHtml: ['<section data-slide="1"', 'Photosynthesis', '<table'],
  },
  {
    id: 'pptx-untitled-slide',
    format: 'pptx',
    standsInFor: 'A deck with a slide that carries only a text box — the case where anydoc alone loses the slide boundary entirely and content silently joins the previous slide.',
    bytes: () => pptxFixture([
      { title: 'First slide' },
      { body: ['Body of an untitled slide'] },
      { title: 'Third slide' },
    ]),
    expectInHtml: ['<section data-slide="2"', 'Slide 2'],
  },
  {
    id: 'pptx-speaker-notes',
    format: 'pptx',
    standsInFor: "A deck whose author wrote private presenter reminders — the case where importing anydoc's output verbatim would publish them to students.",
    bytes: () => pptxFixture([
      { title: 'Photosynthesis', body: ['Light reactions'], notes: 'Do not read this to the class.' },
    ]),
    expectInHtml: ['Photosynthesis'],
  },
  {
    id: 'pptx-unrepresentable',
    format: 'pptx',
    standsInFor: 'A deck whose slide carries a SmartArt diagram, a chart, and a video — all three of which anydoc drops with no block and no asset, so only the index records that they existed.',
    bytes: () => pptxFixture([
      { title: 'Process overview', diagram: true, chart: true, video: true },
    ]),
    expectInHtml: ['Process overview'],
  },
  {
    id: 'pptx-slideshow-container',
    format: 'pptx',
    standsInFor: 'A deck saved as .ppsx, proving the slideshow container detects as the same format the presentation container does rather than being refused at the door.',
    bytes: () => pptxFixture([{ title: 'Slideshow deck' }], { container: 'ppsx' }),
    expectInHtml: ['Slideshow deck'],
  },
  {
    id: 'pptx-macro-container',
    format: 'pptx',
    standsInFor: 'A macro-enabled .pptm carrying a vbaProject part, proving a macro deck imports its slides and nothing of its macro.',
    bytes: () => pptxFixture([{ title: 'Macro deck' }], { container: 'pptm', withMacroPart: true }),
    expectInHtml: ['Macro deck'],
  },
  {
    id: 'odp-semantic',
    format: 'odp',
    standsInFor: 'A deck authored in LibreOffice Impress, whose page structure is explicit but whose reading order anydoc resolves differently from PowerPoint.',
    bytes: () => odpFixture([
      { title: 'Photosynthesis', body: ['Light reactions'] },
      { title: 'Where it happens', body: ['Stroma'] },
    ]),
    expectInHtml: ['<section data-slide="1"', 'Photosynthesis'],
  },
  {
    id: 'odp-speaker-notes',
    format: 'odp',
    standsInFor: 'An Impress deck with presenter notes, the ODP form of the leak PPTX notes would cause.',
    bytes: () => odpFixture([
      { title: 'Photosynthesis', body: ['Light reactions'], notes: 'Do not read this to the class.' },
    ]),
    expectInHtml: ['Photosynthesis'],
  },
```

- [ ] **Step 2: Strengthen `corpus.browser.test.ts` for the leak**

`expectInHtml` can only prove presence. The notes cases need an absence assertion, which the
corpus runner does not have. Add an optional field rather than a special case:

```ts
// in CorpusCase
  /**
   * Substrings the imported html must NOT contain. Presence is not enough for a
   * case whose whole point is that something was excluded: a notes case would
   * pass `expectInHtml` while still leaking the note.
   */
  expectNotInHtml?: readonly string[]
```

and in `corpus.browser.test.ts`, after the `expectInHtml` loop:

```ts
  for (const fragment of entry.expectNotInHtml ?? []) {
    expect(html, `${entry.id} leaked ${fragment}`).not.toContain(fragment)
  }
```

Then add `expectNotInHtml: ['Do not read this to the class.']` to both notes cases.

- [ ] **Step 3: Run the corpus and commit**

```bash
npx vitest run --project browser src/import/corpus.browser.test.ts
npx vitest run --project unit src/import/testing/corpus.test.ts
npm run typecheck && npx vitest run
git add src/import/testing/corpus.ts src/import/corpus.browser.test.ts
git commit -m "test: prove decks keep their slides and lose their speaker notes"
```

---

### Task 10: Security cases

**Files:**
- Modify: `src/import/security.browser.test.ts`

The zip reader is new attack surface. Follow the file's existing style: every case names the
code and, where a user would act on it, the message.

- [ ] **Step 1: Write the cases**

```ts
// This file already imports `importStructuredDocument`. Add:
import { pptxFixture, patchUncompressedSizes } from './testing/presentation-fixtures'
import { PRESENTATION_PACKAGE_LIMITS } from './zip-read'

const PPTX_MEDIA_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
const metadata = { title: 'Lecture', rightsAuthority: 'own' as const, rightsAcknowledged: true }

test('a deck whose package entry lies about its size is refused', async () => {
  // The zip reader inflates with a hard stop at the declared size, so a payload
  // larger than its header claims is caught DURING inflation rather than after.
  const deck = await pptxFixture([{ title: 'Photosynthesis' }])
  const patched = patchUncompressedSizes(deck, 4)

  await expect(importStructuredDocument(
    new File([patched], 'lecture.pptx', { type: PPTX_MEDIA_TYPE }),
    { metadata },
  )).rejects.toThrow(/archive|package/i)
})

test('a macro-enabled deck imports no macro bytes and packages no macro asset', async () => {
  const deck = await pptxFixture([{ title: 'Macro deck' }], { container: 'pptm', withMacroPart: true })
  const result = await importStructuredDocument(
    new File([deck], 'lecture.pptm', { type: 'application/vnd.ms-powerpoint.presentation.macroEnabled.12' }),
    { metadata },
  )

  expect(result.work.sections[0]!.html).not.toContain('macro payload placeholder')
  expect(result.work.assets.map((asset) => asset.originPart)).not.toContain('ppt/vbaProject.bin')
})

test('a deck with more package entries than the ceiling is refused', async () => {
  const { readZipParts } = await import('./zip-read')
  const { writeZip } = await import('../engine/export/zip')
  const entries = Array.from(
    { length: PRESENTATION_PACKAGE_LIMITS.maximumPackageEntries + 1 },
    (_unused, index) => ({ name: `ppt/slides/slide${index}.xml`, data: new TextEncoder().encode('<p:sld/>') }),
  )

  await expect(readZipParts(await writeZip(entries), () => true)).rejects.toMatchObject({
    name: 'ZipReadError', code: 'resource-limit',
  })
})
```

> **Move `patchUncompressedSizes` out of `zip-read.test.ts` and into
> `testing/presentation-fixtures.ts`, exported**, then import it from both test files. Two
> copies of a hostile-archive builder is two things that can drift apart, and the version in
> the fixtures file is the one a later reader will find.

- [ ] **Step 2: Run and commit**

```bash
npx vitest run --project browser src/import/security.browser.test.ts
npm run typecheck && npx vitest run
git add src/import/security.browser.test.ts src/import/testing/presentation-fixtures.ts
git commit -m "test: pin what a hostile or macro-bearing deck is allowed to do"
```

---

### Task 11: Accessibility and cartridge export

**Files:**
- Modify: `src/App.a11y.browser.test.tsx`
- Modify: `src/import/cartridge-artifact.browser.test.ts`
- Modify: `src/components/DocumentImporter.tsx` if its copy names formats explicitly

Criterion 5: enabled formats complete the shared accessibility-review and cartridge-export
workflow, packaged assets included. Both suites are already parameterized over the corpus or
over screens; extend rather than duplicate.

- [ ] **Step 1: Confirm the file picker offers the new formats**

`DOCUMENT_FILE_ACCEPT` and `DOCUMENT_FORMAT_SUMMARY` are both derived from
`IMPORTABLE_DOCUMENT_CAPABILITIES`, so both update themselves once Task 8's entries exist. Run
the importer's browser test and read the rendered summary to confirm it now names PPTX and
ODP; if any copy hard-codes a format list, fix it there.

Run: `npx vitest run --project browser src/components/DocumentImporter.browser.test.tsx`

- [ ] **Step 2: Add the accessibility assertion for a deck**

Follow the existing screens in `App.a11y.browser.test.tsx`. The deck-specific property worth
pinning, beyond the axe pass every screen gets, is that each slide section is reachable and
labelled:

```ts
test('an imported deck exposes each slide as a labelled section', async () => {
  // Sections carry a heading each, so a screen-reader user can move slide to
  // slide with heading navigation rather than reading one undifferentiated page.
  const html = /* import a two-slide deck through the same helper the other screens use */
  const headings = [...new DOMParser().parseFromString(html, 'text/html').querySelectorAll('section[data-slide] > h2')]

  expect(headings).toHaveLength(2)
  expect(headings.every((heading) => heading.id.startsWith('slide-'))).toBe(true)
})
```

- [ ] **Step 3: Add a deck to the cartridge-artifact suite**

`cartridge-artifact.browser.test.ts` drives corpus cases through export and verifies with a
real `unzip`. Add a deck case carrying an image, so packaged assets are exercised:

```ts
  {
    id: 'pptx-packaged-image',
    format: 'pptx',
    standsInFor: 'A deck with a described image, proving slide media packages into web_resources like every other format.',
    bytes: () => pptxFixture([{ title: 'Diagram slide', image: { alt: 'A labelled chloroplast' } }]),
    expectInHtml: ['Diagram slide', '<img'],
  },
```

Add it to `CORPUS_CASES` (Task 9's file) so both suites pick it up.

- [ ] **Step 4: Run both suites and commit**

```bash
npx vitest run --project browser src/App.a11y.browser.test.tsx
npm run test:artifacts
npm run typecheck && npx vitest run
git add src/App.a11y.browser.test.tsx src/import/cartridge-artifact.browser.test.ts \
        src/import/testing/corpus.ts src/components/DocumentImporter.tsx
git commit -m "test: run decks through the accessibility and cartridge workflow"
```

---

### Task 12: Apply the bar, and record the verdict

**Files:**
- Modify: `src/import/released-sources.ts`
- Modify: `src/import/capability.ts` (final `status` for each format)
- Modify: `THIRD-PARTY-NOTICES.md`, `README.md`, `docs/RELEASE-ACCEPTANCE.md`
- Modify: `.scratch/document-import/issues/14-graduate-presentations.md` (the `## Answer`)
- Modify: `.scratch/document-import/map.md`

The design committed the bar before the corpus existed. This task applies it, honestly, and
writes down what happened.

- [ ] **Step 1: Evaluate each format against the bar**

For PPTX and, separately, for ODP, confirm across that format's corpus cases:

1. every top-level block is attributed to a slide (no `presentation-unattributed-content`);
2. every construct in design fact 6 is named by a finding on the right slide;
3. no notes text appears anywhere in the imported HTML;
4. the accessibility and cartridge-export suites pass, packaged assets included.

Write the result down per format before changing any `status`.

- [ ] **Step 2: Set each format's status to what the evidence supports**

If a format clears the bar, leave `status: 'enabled'`. If it does not, set
`status: 'probe-only'` and say why in its `limitations`. **A format that does not clear the
bar is not a failure of this issue** — criterion 6 explicitly allows it, and the released core
importer must not be weakened to accommodate one.

Note the known gap the ODP index carries from Task 5: ODF embeds charts and media as objects
rather than as distinct frame kinds, and nothing in the corpus exercises one, so ODP's
`unrepresentable` counts are structurally zero. Decide whether that is a limitation to state
or a reason ODP does not clear criterion 4, and record the decision.

- [ ] **Step 3: Add the released-source entries**

Add entries to `RELEASED_SOURCES` for each format that ended enabled, **hand-written** —
`released-sources.ts` explains at length why deriving them from the capability table would
make its reconciliation test tautological.

```ts
  {
    format: 'pptx',
    kind: 'file',
    label: capabilityFor('pptx').label,
    maximumBytes: DOCUMENT_IMPORT_LIMITS.maximumInputBytes,
    limitations: capabilityFor('pptx').limitations,
  },
```

- [ ] **Step 4: Update the user-facing documents**

- `THIRD-PARTY-NOTICES.md`: anydoc now parses presentations too. Issue 13 already found this
  file describing shipped parsers as "Probe-only" when they were not; do not reintroduce that.
- `README.md` and `docs/RELEASE-ACCEPTANCE.md`: state what a deck import does and does not do —
  notes excluded, diagrams and media not imported, untitled slides numbered.
- `docs-claims.test.ts` fails when a user-facing obligation is missing. Run it.

- [ ] **Step 5: Run the release gate**

Run: `npm run verify:release`
Expected: every criterion PASS, with the two MANUAL rows reported as issue 13 defined them.

- [ ] **Step 6: Resolve the issue and update the map**

Append an `## Answer` to `issues/14-graduate-presentations.md` recording, per format, the
verdict and the evidence behind it; tick the six criteria; set `Status: resolved`. Update
`map.md`'s row and move the frontier to 15.

- [ ] **Step 7: Final commit**

```bash
npm run typecheck && npx vitest run && npm run verify:release
git add -A
git commit -m "feat: graduate the presentation formats the evidence supports"
```

---

## Self-review

**Spec coverage.** Design fact 1 → Tasks 8 (one capability entry) and 9 (container cases).
Facts 2–4 → Tasks 3, 5, 6. Fact 5 → Tasks 3, 5, 6, 9 (`expectNotInHtml`). Fact 6 → Tasks 3, 6,
9. Fact 7 → inherited unchanged from `anydoc-html.ts`; the equation blocker needs no new code,
and Task 12 records it as a limitation. Fact 8 → Task 11's packaged-image case. The Worker/main
thread seam → Tasks 1, 2, 3. The four units → Tasks 1, 2, 3/5, 6. The situations table → Task
6's eight tests. Deck-to-pages → Task 7. The bar → Task 12. The open question → Task 4.

**Issue criteria.** Corpus coverage → Task 9. Evidence-based status → Task 12. Stable pages
with visible provenance and editable titles → Tasks 6 and 7. Findings for every loss → Task 6.
Shared a11y and cartridge workflow → Task 11. Formats that fail stay disabled → Task 12 Step 2.

**Known soft spots, flagged rather than hidden.**

- Task 6's matching rule (`run === text || run.includes(text) || text.includes(run)`) is the
  load-bearing heuristic of the whole reconciler. It is deliberately loose because anydoc
  reflows text across blocks; if a real deck breaks it, the failure mode is the
  `presentation-unattributed-content` blocker — which is a refusal, not a silent
  misattribution, and that is the behaviour the design chose.
- Task 11's accessibility step describes the assertion but defers to the existing helper in
  `App.a11y.browser.test.tsx` for how a deck gets imported in that file, because that file's
  helpers were not read while writing this plan. Read them before writing the test rather than
  inventing a second import path.
