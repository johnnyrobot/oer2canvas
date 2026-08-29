# Harden and release the core document importer — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "the document importer is releasable" a state a machine can check, by closing
the seven acceptance criteria with named checks, recording the two that only a human can
close, and fixing the three defects already found.

**Architecture:** This issue adds no import capability. It adds a widened synthetic corpus, a
security suite, an artifact suite that verifies cartridges with a real `unzip`, two
documentation tests, one accessibility screen, and a `verify:release` gate that maps each
criterion to the check that closes it. Everything else is corrections to documents that
became false when issues 04, 11 and 12 shipped.

**Tech Stack:** TypeScript, React 19, Vite, Vitest (jsdom `unit` + Chromium `browser`
projects), Node for the gate script and the real-`unzip` artifact test.

**Spec:** [`13-release-core-document-importer-design.md`](13-release-core-document-importer-design.md)
— read its `## Measured facts` section first. Five facts are already measured; do not
re-derive them.

**Issue:** [`issues/13-release-core-document-importer.md`](issues/13-release-core-document-importer.md)

## Global Constraints

- **This issue adds no import format, no OCR, no relay change, and no second browser
  project.** If a task appears to need one, stop and escalate — it means a measurement came
  back differently than the design expected.
- **A test that asserts "does not crash" documents nothing.** Every security case names the
  expected refusal: the message, and whether it is retryable. `actionableFailure`
  (`src/import/parsers/probe.ts`) decides retryability from a code derived from an English
  error message, so a wording change upstream silently flips it — that is what these tests
  exist to catch.
- **Every corpus case names the real-world property it stands in for.** A generated fixture
  is evidence only if a reader can see what it is evidence *of*. A fixture with no such
  comment is an incomplete task.
- **Every number is read from an existing constant or justified in a comment.** Never a bare
  literal. `DOCUMENT_IMPORT_LIMITS` (`src/import/limits.ts`) and `MAX_TEXT_IMPORT_BYTES`
  (`src/import/text.ts:26`) are the sources.
- **Where a comment cites a measurement, cite the date** so a later reader knows what to
  re-run. Measurements taken in this issue are 2026-08-29 or later.
- **`tsconfig.json` deliberately omits node types**, so a `process` or `node:` reference in
  `src/` is a compile error. Only Task 7 adds a file to `tsconfig.node.json`, and it says why
  in that file. Everywhere else, use vite's `?raw` or a browser API.
- **Run `npm run typecheck && npx vitest run` before every commit; the whole suite must
  pass.** It is currently 125 files / 1180 tests. Two pre-existing intermittent flakes live in
  `src/components/DocumentImporter.browser.test.tsx` and
  `src/components/TextContentImporter.test.tsx` — rerun and say so; do NOT "fix" them.
- **Every commit in this repository's history is green.**

---

### Task 1: One list of what shipped, and a test that the table agrees with it

Settles the design's first open question. `DOCUMENT_FORMAT_CAPABILITIES` describes file
formats — extensions and media types — and `DOCUMENT_FILE_ACCEPT` builds a file picker's
`accept` string from it. URL acquisition has neither an extension nor a media type, so a `web`
row would put a non-file source in a table whose every consumer assumes files.

So: a **sibling list**, plus a test asserting the two together cover exactly the released set.

**Files:**
- Create: `src/import/released-sources.ts`
- Create: `src/import/released-sources.test.ts`

**Interfaces:**
- Produces: `RELEASED_SOURCES: readonly ReleasedSource[]`, `ReleasedSource`.
- Consumes: `DOCUMENT_FORMAT_CAPABILITIES`, `releaseEnabledFormats` from `./capability`.

- [ ] **Step 1: Write the failing test**

```ts
import { RELEASED_SOURCES } from './released-sources'
import { DOCUMENT_FORMAT_CAPABILITIES, releaseEnabledFormats } from './capability'

test('every released source is either a capability-table format or the url source', () => {
  /*
   * Criterion 1 says the published capability table "matches corpus-tested
   * support ... and optional URL acquisition". The table cannot hold the URL
   * source — `DOCUMENT_FILE_ACCEPT` turns it into a file picker's `accept`
   * string, and a URL has no extension. So the two lists are kept apart and
   * reconciled HERE, which is the one place that can be wrong.
   */
  const fromTable = releaseEnabledFormats()
  const fileSources = RELEASED_SOURCES.filter((source) => source.kind === 'file')
  expect(fileSources.map((source) => source.format).sort()).toEqual([...fromTable].sort())

  const urlSources = RELEASED_SOURCES.filter((source) => source.kind === 'url')
  expect(urlSources.map((source) => source.format)).toEqual(['web'])
})

test('no capability is enabled without being released, and none released without being enabled', () => {
  // The failure this catches: someone flips a `status` to 'enabled' and ships a
  // format nothing in this issue ever tested.
  const enabled = DOCUMENT_FORMAT_CAPABILITIES
    .filter((entry) => entry.status === 'enabled')
    .map((entry) => entry.format)
  const released = RELEASED_SOURCES.filter((source) => source.kind === 'file').map((s) => s.format)
  expect([...enabled].sort()).toEqual([...released].sort())
})

test('every released source names the limits a user meets', () => {
  // Criterion 5 requires resource limits be stated. This is the machine-readable
  // half; Task 9 asserts the prose half.
  for (const source of RELEASED_SOURCES) {
    expect(source.maximumBytes).toBeGreaterThan(0)
    expect(source.limitations.length).toBeGreaterThan(0)
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/released-sources.test.ts`
Expected: FAIL — `src/import/released-sources.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
import { DOCUMENT_FORMAT_CAPABILITIES } from './capability'
import { DOCUMENT_IMPORT_LIMITS } from './limits'
import { MAX_TEXT_IMPORT_BYTES } from './text'
import type { ImportedFormat } from './types'

/**
 * Everything this release can import, as one list.
 *
 * A SIBLING of `DOCUMENT_FORMAT_CAPABILITIES`, not a replacement and not a new
 * row in it. That table is a file-format table: `DOCUMENT_FILE_ACCEPT` turns its
 * extensions and media types into a file picker's `accept` string, and URL
 * acquisition has neither. Putting `web` in it would hand the picker an entry it
 * cannot express.
 *
 * The two lists are reconciled by `released-sources.test.ts`, which is the one
 * place the disagreement can be caught. Criterion 1 asks that the published
 * capability table MATCH what was tested; this is what "match" is checked
 * against.
 */
export interface ReleasedSource {
  format: ImportedFormat
  kind: 'file' | 'url'
  label: string
  /** The ceiling a user actually meets, from an existing constant. */
  maximumBytes: number
  limitations: readonly string[]
}

export const RELEASED_SOURCES: readonly ReleasedSource[] = [
  ...DOCUMENT_FORMAT_CAPABILITIES
    .filter((entry) => entry.status === 'enabled')
    .map((entry): ReleasedSource => ({
      format: entry.format,
      kind: 'file',
      label: entry.label,
      // Native (text/markdown/html) imports run on the main thread under the
      // 2 MiB text ceiling; parser-backed formats run in a Worker under the
      // 16 MiB input ceiling.
      maximumBytes: entry.parser === 'native'
        ? MAX_TEXT_IMPORT_BYTES
        : DOCUMENT_IMPORT_LIMITS.maximumInputBytes,
      limitations: entry.limitations,
    })),
  {
    format: 'web',
    kind: 'url',
    label: 'Web page',
    // The extracted Markdown reaches the same main-thread sanitizer as a pasted
    // Markdown import, so it is bounded by the same constant.
    maximumBytes: MAX_TEXT_IMPORT_BYTES,
    limitations: [
      'Requires your own Firecrawl account and API key; each import costs one Firecrawl credit.',
      'One address becomes one page, and no links are followed.',
      'Images are marked in place but not imported, and block preparation.',
      'A PDF address is refused; import it from the Document tab instead.',
    ],
  },
]
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/released-sources.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/released-sources.ts src/import/released-sources.test.ts
git commit -m "feat: reconcile the capability table with what this release actually ships"
```

---

### Task 2: Find where archive expansion stops failing cleanly

The design measured that a DOCX expanding to roughly 31 MB is refused in about 1.6 s by the
128 MiB ceiling. It also recorded two things it did **not** establish: the compression ratio,
and what happens to a larger bomb — because `resultBudgetFailure` runs on the `result`
message, i.e. **after** the parse returns.

This task establishes both. **It is a measurement, not a feature.** Its output is a number and
an amendment to the design.

**Files:**
- Create: `src/import/testing/archive-bomb.ts`
- Modify: `.scratch/document-import/13-release-core-document-importer-design.md`

**Interfaces:**
- Produces: `compressionBombDocx(paragraphs: number): Promise<Uint8Array<ArrayBuffer>>`.

- [ ] **Step 1: Write the fixture builder**

```ts
import { writeZip } from '../../engine/export/zip'

const utf8 = (value: string) => new TextEncoder().encode(value)

/**
 * A VALID DOCX whose `word/document.xml` is enormous and trivially compressible.
 *
 * The attack this stands in for: a small upload that a parser expands until it
 * exhausts the tab. `writeZip` deflates, so the archive stays far inside
 * `maximumInputBytes` while the expanded part does not.
 *
 * `paragraphs` is the dial. Each paragraph is about 78 bytes expanded, so the
 * expanded size is roughly `paragraphs * 78`.
 */
export async function compressionBombDocx(paragraphs: number): Promise<Uint8Array<ArrayBuffer>> {
  const body = '<w:p><w:r><w:t>AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA</w:t></w:r></w:p>'
    .repeat(paragraphs)
  const entries = [
    {
      name: '[Content_Types].xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`),
    },
    {
      name: '_rels/.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`),
    },
    {
      name: 'word/_rels/document.xml.rels',
      data: utf8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`),
    },
    {
      name: 'word/document.xml',
      data: utf8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`),
    },
  ]
  return new Uint8Array(await writeZip(entries))
}
```

- [ ] **Step 2: Measure the boundary out of band**

Write a THROWAWAY browser test that walks the dial and records the outcome at each rung. Read
`bytes.byteLength` **before** calling `probeParser` — the buffer is transferred into the
Worker and reads 0 afterwards, which is the flaw that left the ratio unmeasured the first
time.

```ts
import { compressionBombDocx } from './testing/archive-bomb'
import { probeParser } from './parsers/probe'

test('measure', async () => {
  const rows: Record<string, unknown> = {}
  for (const paragraphs of [400_000, 1_000_000, 2_000_000, 4_000_000]) {
    const bomb = await compressionBombDocx(paragraphs)
    const compressedBytes = bomb.byteLength          // BEFORE the transfer
    const started = performance.now()
    const outcome = await probeParser({
      parser: 'anydoc', bytes: bomb.buffer as ArrayBuffer, formatHint: 'docx', timeoutMs: 25_000,
    }).then(
      () => ({ kind: 'resolved' }),
      (error: unknown) => ({ kind: 'rejected', code: (error as { code?: string }).code, message: (error as Error).message.slice(0, 120) }),
    )
    rows[`${paragraphs}`] = {
      compressedBytes,
      approxExpandedBytes: paragraphs * 78,
      ratio: Math.round((paragraphs * 78) / compressedBytes),
      elapsedMs: Math.round(performance.now() - started),
      outcome,
    }
  }
  expect(rows).toBe('SHOW')   // fail on purpose to print the table
})
```

Run: `npx vitest run --project browser <that file>`
**Delete the throwaway file when done.** Record the table.

- [ ] **Step 3: Decide, and amend the design**

Add an `## Amendment` section to the design recording the table, the achieved ratio, and one
of two conclusions:

- **Every rung refuses cleanly** with `resource-limit` — then the criterion needs only the
  regression test in Task 3, and the amendment says so with the largest rung proved.
- **Some rung hangs, crashes the tab, or exceeds the timeout** — then the ceiling is not
  sufficient, and this becomes a real finding. **STOP AND ESCALATE.** A pre-parse guard is
  machinery this issue's non-goals exclude, so the human decides whether to add it here or
  file it as its own issue.

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npx vitest run
git add src/import/testing/archive-bomb.ts .scratch/document-import/13-release-core-document-importer-design.md
git commit -m "docs: measure where archive expansion stops failing cleanly"
```

---

### Task 3: The security suite — archive expansion and malformed binaries

**Files:**
- Create: `src/import/security.browser.test.ts`

**Interfaces:**
- Consumes: `compressionBombDocx` (Task 2), `malformedStructuredFixture` from
  `./testing/structured-document-fixtures`, `encryptedPdfFixture` / `malformedPdfFixture` from
  `./testing/pdf-fixture`, `probeParser` from `./parsers/probe`, `importStructuredDocument`
  from `./document`, `importWebArticle` from `./web`.
- **If `semanticDocxFixture` has no `activeContent` option, add one** — a `<w:p>` carrying a
  hyperlink with a `javascript:` target and an embedded `<script>`-shaped run. Extend the
  existing builder rather than writing a second one.

- [ ] **Step 1: Write the tests**

Browser project, because these must run against the REAL WASM parsers — a mocked parser
proves nothing about what a hostile file does to one.

```ts
import { probeParser } from './parsers/probe'
import { compressionBombDocx } from './testing/archive-bomb'
import { malformedStructuredFixture } from './testing/structured-document-fixtures'
import { encryptedPdfFixture, malformedPdfFixture } from './testing/pdf-fixture'
import { semanticDocxFixture } from './testing/docx-fixture'
import { importStructuredDocument } from './document'
import { importWebArticle } from './web'
import { DOCUMENT_IMPORT_LIMITS } from './limits'

test('a compression bomb is refused by the memory ceiling, not by luck', async () => {
  /*
   * Measured 2026-08-29: a DOCX expanding to roughly 31 MB was refused in about
   * 1.6 s. The refusal comes from `resultBudgetFailure`'s WASM-memory check, and
   * naming the code is the point — a future change that made this fail as
   * `parse-failed` instead would still "refuse", while telling the user to retry
   * a file that can never succeed.
   */
  const bomb = await compressionBombDocx(400_000)
  await expect(probeParser({
    parser: 'anydoc', bytes: bomb.buffer as ArrayBuffer, formatHint: 'docx',
  })).rejects.toMatchObject({
    name: 'ParserProbeError',
    code: 'resource-limit',
    message: expect.stringMatching(/128 MiB/),
  })
})

test('an input above the byte ceiling is refused before a Worker starts', async () => {
  // Cheapest possible refusal, and the one that protects everything downstream.
  await expect(probeParser({
    parser: 'anydoc',
    bytes: new ArrayBuffer(DOCUMENT_IMPORT_LIMITS.maximumInputBytes + 1),
    formatHint: 'docx',
  })).rejects.toMatchObject({ code: 'resource-limit', message: expect.stringMatching(/before.*Worker/i) })
})

test.each(['epub', 'odt', 'rtf'] as const)('a malformed %s is refused and stays retryable', async (format) => {
  // Retryable, because a truncated download IS worth retrying — unlike an
  // encrypted PDF, asserted below.
  await expect(probeParser({
    parser: 'anydoc', bytes: malformedStructuredFixture(format).buffer, formatHint: format,
  })).rejects.toMatchObject({ name: 'ParserProbeError', retryable: true })
})

test('an encrypted pdf is refused and is NOT retryable', async () => {
  // The distinction issue 11 pinned: retrying an encrypted file can never work,
  // and `actionableFailure` decides that from a regex over an English message.
  await expect(probeParser({
    parser: 'pdf-inspector', bytes: encryptedPdfFixture().buffer, formatHint: 'pdf',
  })).rejects.toMatchObject({ code: 'encrypted', retryable: false })
})

test('a truncated pdf is refused and stays retryable', async () => {
  await expect(probeParser({
    parser: 'pdf-inspector', bytes: malformedPdfFixture().buffer, formatHint: 'pdf',
  })).rejects.toMatchObject({ code: 'malformed', retryable: true })
})

test('active content inside a DOCUMENT reaches the same refusals as pasted markup', async () => {
  /*
   * `markup.ts`'s own tests cover the sanitizer directly. This asserts the same
   * guarantees through the DOCUMENT path, which reaches the sanitizer by a
   * different entry point — `anydoc-html.ts` normalizes a block tree rather than
   * parsing a string, so a regression there would not show up in those tests.
   */
  const file = new File([await semanticDocxFixture({ activeContent: true })], 'hostile.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  const imported = await importStructuredDocument(file, {
    metadata: { title: 'Hostile', rightsAuthority: 'own', rightsAcknowledged: true },
  })
  const html = imported.work.sections[0]!.html
  expect(html).not.toMatch(/<script|onclick=|javascript:/i)
  expect(imported.report.findings.map((finding) => finding.code))
    .toContain('import-active-content-removed')
})

test.each([
  'http://127.0.0.1:8080/',
  'https://localhost/page',
  'https://169.254.169.254/latest/',
  'http://example.com/page',
  'https://user:pass@example.com/page',
])('the hostile url %s never reaches a fetcher', async (target) => {
  /*
   * Proved in issue 12; gathered here so criterion 3 is checkable in ONE place
   * rather than by knowing which issue proved which row. `called` is the
   * assertion that matters: the fence runs before the request leaves the
   * browser, because the extraction service is itself an SSRF vector.
   */
  let called = 0
  await expect(importWebArticle(target, {
    metadata: { title: 'Hostile', rightsAuthority: 'own', rightsAcknowledged: true },
    fetcher: async () => { called += 1; throw new Error('should not be reached') },
  })).rejects.toThrow(/valid HTTPS public/i)
  expect(called).toBe(0)
})

test('a file whose bytes are not the format its name claims is refused as unsupported', async () => {
  // Content, never extension. Refused as `unsupported`, which is NOT retryable:
  // the contents will never become a PDF however many times it is tried.
  await expect(probeParser({
    parser: 'pdf-inspector',
    bytes: new TextEncoder().encode('<html><body>not a pdf</body></html>').buffer,
    formatHint: 'pdf',
  })).rejects.toMatchObject({ code: 'unsupported', retryable: false })
})
```

- [ ] **Step 2: Run to verify**

Run: `npx vitest run --project browser src/import/security.browser.test.ts`
Expected: PASS. **If the "not a pdf" case reports a code other than `unsupported`, stop** —
issue 11 added that branch and a change to it is a real regression, not a test to loosen.

- [ ] **Step 3: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/security.browser.test.ts
git commit -m "test: pin the refusals hostile and malformed documents must produce"
```

---

### Task 4: The security suite — the Canvas token reaches no storage either

`web-key-containment.test.ts` proves this for the Firecrawl key. `credentials.ts` holds the
Canvas token the same way — a variable in a closure, deliberately not `sessionStorage` — and
`idb.ts` calls itself "the one place this app writes to disk". Criterion 3 names credential
leakage without qualifying which credential, so the same method is applied to the other one.

**Files:**
- Create: `src/canvas/token-containment.test.ts`

**Interfaces:**
- Consumes: `createCredentialStore`, `migratePersistedTokens`, `type KeyValueStore` from
  `./credentials`.

- [ ] **Step 1: Write the tests**

```ts
import { createCredentialStore, migratePersistedTokens, type KeyValueStore } from './credentials'

const SENTINEL = 'canvas-SENTINEL-do-not-leak-0123456789'

/** A disk that records every write, so a token reaching it is visible. */
function recordingDisk(): { disk: KeyValueStore; writes: string[] } {
  const writes: string[] = []
  const values = new Map<string, unknown>()
  return {
    writes,
    disk: {
      async get(key) { return values.get(key) },
      async set(key, value) { writes.push(`${key}=${String(value)}`); values.set(key, value) },
      async remove(key) { writes.push(`remove ${key}`); values.delete(key) },
    },
  }
}

test('saving credentials writes the address to disk and the token nowhere', async () => {
  const { disk, writes } = recordingDisk()
  const store = createCredentialStore(disk)
  await store.save({ baseUrl: 'https://canvas.example.edu', token: SENTINEL })

  expect(writes.filter((write) => write.includes(SENTINEL))).toEqual([])
  // Positive control: the address IS written, so this cannot pass by writing nothing.
  expect(writes).toContain('canvas.baseUrl=https://canvas.example.edu')
  // And the token is still usable in memory for this tab.
  expect((await store.load())?.token).toBe(SENTINEL)
})

test('forget clears the token from memory as well as from disk', async () => {
  const { disk } = recordingDisk()
  const store = createCredentialStore(disk)
  await store.save({ baseUrl: 'https://canvas.example.edu', token: SENTINEL })
  await store.forget()
  expect((await store.load())?.token).toBeUndefined()
})

test('a token left on disk by an earlier release is never loaded, and is removed', async () => {
  /*
   * The migration exists because earlier releases offered opt-in persistence.
   * The load path must not treat a persisted token as a fallback even before the
   * migration has run, or a hand-edited profile would resurrect one.
   */
  const { disk } = recordingDisk()
  await disk.set('canvas.token', SENTINEL)
  await disk.set('canvas.baseUrl', 'https://canvas.example.edu')

  const store = createCredentialStore(disk)
  expect((await store.load())?.token).toBeUndefined()

  await migratePersistedTokens(disk)
  expect(await disk.get('canvas.token')).toBeUndefined()
})
```

- [ ] **Step 2: Run to verify**

Run: `npx vitest run --project unit src/canvas/token-containment.test.ts`
Expected: PASS if `credentials.ts` behaves as documented. **A failure here is a real leak —
find and fix it; never loosen the assertion.**

- [ ] **Step 3: Prove it can fail**

Temporarily add `await disk.set('canvas.token', credentials.token)` to `save()` in
`credentials.ts`, run the suite, watch the first test fail, then revert. Record that you did
in the commit message. A containment test nobody has seen fail is a containment test nobody
should trust.

- [ ] **Step 4: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/canvas/token-containment.test.ts
git commit -m "test: prove the canvas token reaches no disk, by the same method as the firecrawl key"
```

---

### Task 5: Widen the corpus

One generator per structural property, reusing the existing builders rather than adding a
parallel set. Each case carries a comment naming the real-world property it stands in for;
that comment is the deliverable as much as the bytes are.

**Files:**
- Create: `src/import/testing/corpus.ts`
- Create: `src/import/testing/corpus.test.ts`

**Interfaces:**
- Produces: `CORPUS_CASES: readonly CorpusCase[]`, `CorpusCase`.
- Consumes: `semanticDocxFixture`, `semanticEpubFixture`, `semanticOdtFixture`,
  `semanticRtfFixture`, `pdfFixture`.

- [ ] **Step 1: Write the failing test**

```ts
import { CORPUS_CASES } from './corpus'
import { RELEASED_SOURCES } from '../released-sources'

test('every released file source has at least one corpus case', () => {
  // Criterion 1's "corpus-tested" made checkable: a format nobody wrote a case
  // for is a format this release claims support for on no evidence.
  const covered = new Set(CORPUS_CASES.map((entry) => entry.format))
  for (const source of RELEASED_SOURCES.filter((entry) => entry.kind === 'file')) {
    expect(covered.has(source.format), `no corpus case for ${source.format}`).toBe(true)
  }
})

test('every corpus case says what real-world property it stands in for', () => {
  // A generated fixture is evidence only if a reader can see what it is evidence
  // OF. This is the rule the design makes non-negotiable, enforced.
  for (const entry of CORPUS_CASES) {
    expect(entry.standsInFor.length, `${entry.id} has no rationale`).toBeGreaterThan(20)
  }
})

test('corpus ids are unique', () => {
  const ids = CORPUS_CASES.map((entry) => entry.id)
  expect(new Set(ids).size).toBe(ids.length)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/import/testing/corpus.test.ts`
Expected: FAIL — `corpus.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
import type { ImportedFormat } from '../types'
import { semanticDocxFixture } from './docx-fixture'
import {
  semanticEpubFixture,
  semanticOdtFixture,
  semanticRtfFixture,
} from './structured-document-fixtures'
import { pdfFixture } from './pdf-fixture'

/**
 * The corpus this release's support claim rests on.
 *
 * Synthetic and committed, deliberately. Real documents were considered and
 * rejected: they add repo weight, licensing bookkeeping, and fixtures whose
 * meaning changes silently when replaced. The price of generating them is that
 * a reader cannot see what a case is FOR — so `standsInFor` is required, and a
 * test enforces it.
 */
export interface CorpusCase {
  id: string
  format: ImportedFormat
  /** The real-world property this case exists to represent. Required. */
  standsInFor: string
  bytes: () => Promise<Uint8Array<ArrayBuffer>>
  /** Substrings the imported html must contain, proving the structure survived. */
  expectInHtml: readonly string[]
}

export const CORPUS_CASES: readonly CorpusCase[] = [
  {
    id: 'docx-semantic',
    format: 'docx',
    standsInFor: 'An ordinary teaching handout: headings, paragraphs, a link, and a table — the shape most instructor documents actually have.',
    bytes: () => semanticDocxFixture(),
    expectInHtml: ['<h1>', 'Cell Biology', '<table'],
  },
  {
    id: 'epub-semantic',
    format: 'epub',
    standsInFor: 'A chapter exported from an OER platform, where styling is carried in CSS this importer discards and structure must survive without it.',
    bytes: () => semanticEpubFixture(),
    expectInHtml: ['<h1>', 'Cell Biology'],
  },
  {
    id: 'odt-semantic',
    format: 'odt',
    standsInFor: 'A document authored in LibreOffice, whose visual layout is not reproducible and whose semantics must come through anyway.',
    bytes: () => semanticOdtFixture(),
    expectInHtml: ['<h1>', 'Cell Biology'],
  },
  {
    id: 'rtf-semantic',
    format: 'rtf',
    standsInFor: 'An older handout saved as RTF, the format most likely to arrive with flattened drawings and no reliable structure.',
    bytes: async () => semanticRtfFixture(),
    expectInHtml: ['Cell Biology'],
  },
  {
    id: 'pdf-text-multipage',
    format: 'pdf',
    standsInFor: 'A multi-page text-based PDF chapter: the case PDF import exists for, where page markers drive the split and every page must produce text.',
    bytes: async () => pdfFixture(3, 'Corpus'),
    expectInHtml: ['Corpus page 1', 'Corpus page 3'],
  },
]
```

**Then extend it** with one case per structural property below. Where an existing builder
cannot express a property, add an OPTION to that builder rather than writing a second one —
one worked example, so the shape is not left to taste:

```ts
  {
    id: 'docx-merged-cells',
    format: 'docx',
    standsInFor: 'A syllabus grid or a data table with a header spanning two columns — the structure most likely to be silently flattened into unreadable rows.',
    // Requires a `mergedCells` option on `semanticDocxFixture`, emitting
    // `<w:gridSpan w:val="2"/>` on the first cell. `markup.ts` allows `colspan`
    // and `rowspan` on `td`/`th`, so the attribute must survive to the html.
    bytes: () => semanticDocxFixture({ mergedCells: true }),
    expectInHtml: ['<table', 'colspan="2"'],
  },
  {
    id: 'docx-bidi-cjk',
    format: 'docx',
    standsInFor: 'A language handout mixing Arabic and Japanese with English. No existing fixture contains a non-Latin character, so nothing today would catch a sanitizer that dropped or reordered them.',
    bytes: () => semanticDocxFixture({ text: 'مرحبا بالعالم — 光合成 — hello' }),
    expectInHtml: ['مرحبا بالعالم', '光合成'],
  },
```

The remaining properties, each following that shape:

- **deep heading nesting** (`h1`→`h4`) — so the page-plan split has something to be wrong
  about; `proposePagePlan` splits at the highest repeated level.
- **a table with merged cells** (`colspan`/`rowspan`) — the single most common structure to
  lose; `markup.ts` allows both attributes, so the test proves they survive.
- **footnotes** — text that must not silently vanish.
- **right-to-left and CJK text** — a sanitizer that reorders or drops them fails silently, and
  no existing fixture contains a non-Latin character.
- **an equation** — Temml conversion sits downstream of import.
- **large-but-legal** — inside every budget and near one of them, so the budget is proved not
  to fire on a document a user legitimately has.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/import/testing/corpus.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/testing/corpus.ts src/import/testing/corpus.test.ts src/import/testing/
git commit -m "test: widen the import corpus and require every case to say what it stands for"
```

---

### Task 6: Import every corpus case, in a real browser

**Files:**
- Create: `src/import/corpus.browser.test.ts`

- [ ] **Step 1: Write the test**

```ts
import { CORPUS_CASES } from './testing/corpus'
import { importStructuredDocument } from './document'
import { importPdfDocument } from './pdf'
import { capabilityForFormat } from './capability'
import type { ImportResult } from './types'

const metadata = {
  title: 'Corpus case',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

test.each(CORPUS_CASES)('$id imports and keeps the structure it stands in for', async (entry) => {
  const capability = capabilityForFormat(entry.format)!
  const file = new File([await entry.bytes()], `corpus.${entry.format}`, {
    type: capability.mediaTypes[0]!,
  })
  const imported: ImportResult = entry.format === 'pdf'
    ? await importPdfDocument(file, { metadata })
    : await importStructuredDocument(file, { metadata })

  expect(imported.work.sections).toHaveLength(1)
  const html = imported.work.sections[0]!.html
  for (const fragment of entry.expectInHtml) {
    expect(html, `${entry.id} lost ${fragment}`).toContain(fragment)
  }
  // A corpus case must not be quietly refused: a blocker here means this release
  // claims support for something it cannot actually publish.
  expect(imported.report.findings.filter((finding) => finding.severity === 'blocker')).toEqual([])
})
```

- [ ] **Step 2: Run to verify**

Run: `npx vitest run --project browser src/import/corpus.browser.test.ts`
Expected: PASS. **If a case produces a blocker, that is a finding, not a test to relax** —
either the corpus case is not actually supported (and the capability table is wrong), or the
importer has a defect. Escalate with the case id and the finding.

- [ ] **Step 3: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/corpus.browser.test.ts
git commit -m "test: import every corpus case and assert its structure survives"
```

---

### Task 7: Artifact correctness, verified by a real unzip

`zip.test.ts` already establishes the stance: *"anything less than a third-party reader
agreeing is just this file marking its own homework."* This extends it from the zip writer to
a whole cartridge.

**Files:**
- Create: `src/import/cartridge-artifact.test.ts`
- Modify: `tsconfig.json` (exclude), `tsconfig.node.json` (include)

**Interfaces:**
- Consumes: `buildCartridge`, `writeZip`, `compileAndAuditChapter`, `DOCUMENT`, `toChapter`,
  `confirmImport`, `createImportDraft`, `CORPUS_CASES`.

- [ ] **Step 1: Add the file to the node project**

`node:child_process` is needed for a real `unzip`, and `tsconfig.json` deliberately omits node
types. Add to `tsconfig.json`'s `exclude` and `tsconfig.node.json`'s `include`, and extend
that file's header comment to name the third entry and why:

```jsonc
    "src/engine/compile/golden.test.ts",
    "src/engine/export/zip.test.ts",
    // Verifies a whole cartridge with a real `unzip`, for the reason
    // `zip.test.ts` gives: a zip verified only by its own writer is marking its
    // own homework. Needs `node:child_process`, and nothing else about it wants
    // node.
    "src/import/cartridge-artifact.test.ts"
```

- [ ] **Step 2: Write the test**

```ts
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CORPUS_CASES } from './testing/corpus'
import { importStructuredDocument } from './document'
import { importPdfDocument } from './pdf'
import { capabilityForFormat } from './capability'
import { createImportDraft } from '../components/ImportPlanEditor'
import { confirmImport } from './page-plan'
import { toChapter } from './to-chapter'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'
import { writeZip } from '../engine/export/zip'

const metadata = { title: 'Artifact', rightsAuthority: 'own' as const, rightsAcknowledged: true }

async function cartridgeFor(entry: (typeof CORPUS_CASES)[number]): Promise<Uint8Array> {
  const capability = capabilityForFormat(entry.format)!
  const file = new File([await entry.bytes()], `a.${entry.format}`, { type: capability.mediaTypes[0]! })
  const imported = entry.format === 'pdf'
    ? await importPdfDocument(file, { metadata })
    : await importStructuredDocument(file, { metadata })
  const confirmed = confirmImport(imported, createImportDraft(imported).plan, metadata)
  const compiled = await compileAndAuditChapter(toChapter(confirmed.work), { profile: DOCUMENT })
  return new Uint8Array(await writeZip(buildCartridge([compiled])))
}

/** A REAL unzip, because our own reader agreeing with our own writer proves nothing. */
function unzipped(bytes: Uint8Array): { list: string; read: (name: string) => string } {
  const dir = mkdtempSync(join(tmpdir(), 'cartridge-'))
  const path = join(dir, 'c.imscc')
  writeFileSync(path, bytes)
  execFileSync('unzip', ['-t', path])
  execFileSync('unzip', ['-o', '-q', path, '-d', dir])
  return {
    list: execFileSync('unzip', ['-l', path], { encoding: 'utf8' }),
    read: (name) => readFileSync(join(dir, name), 'utf8'),
  }
}

test.each(CORPUS_CASES)('$id produces a cartridge a third-party reader accepts', async (entry) => {
  const archive = unzipped(await cartridgeFor(entry))
  expect(archive.list).toContain('imsmanifest.xml')
  const manifest = archive.read('imsmanifest.xml')
  // The shape issue 07 measured Canvas accepting.
  expect(manifest).toContain('<manifest')
  expect(manifest).toContain('type="webcontent"')
})

test.each(CORPUS_CASES)('$id exports deterministically', async (entry) => {
  /*
   * Byte-identical output is what makes re-importing the same document UPDATE
   * its Canvas pages rather than duplicate them: page identity derives from the
   * source content hash and structural position.
   */
  const [first, second] = [await cartridgeFor(entry), await cartridgeFor(entry)]
  expect(Array.from(first)).toEqual(Array.from(second))
})
```

**Note on environment:** this runs in the `unit` (jsdom) project. If `File`,
`compileAndAuditChapter` or the audit iframe cannot run under jsdom, **do not fight it** —
move the cartridge construction into a browser test that writes the bytes out with
`commands.writeFile` (the pattern `packaged-cartridge.browser.test.ts` already uses) and keep
only the `unzip` half here, reading that file. Record which you did and why.

- [ ] **Step 3: Run to verify**

Run: `npx vitest run --project unit src/import/cartridge-artifact.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/import/cartridge-artifact.test.ts tsconfig.json tsconfig.node.json
git commit -m "test: verify a whole cartridge with a real unzip, and pin determinism"
```

---

### Task 8: The accessibility screen issue 12 did not add

`App.a11y.browser.test.tsx` covers screens 1, 1b, 1c, 2, 3 and 4. The Web page tab has none,
so criterion 2 is not met for it.

**Files:**
- Modify: `src/App.a11y.browser.test.tsx`

- [ ] **Step 1: Write the test**

Follow screen 1c exactly — the same `ImportFlow` harness, the same two assertions, driven to
the page plan so the findings and the plan editor are audited too. Inject the fetch, because
this screen must not reach the network:

```tsx
test('screen 1d — the web page form and its page plan have no accessibility violations', async () => {
  const okEnvelope = {
    success: true,
    data: {
      markdown: '# Photosynthesis\n\nPlants convert light.\n\n## Products\n\nSugars and oxygen.',
      metadata: {
        url: 'https://en.wikipedia.org/wiki/Photosynthesis',
        sourceURL: 'https://en.wikipedia.org/wiki/Photosynthesis',
        statusCode: 200,
        contentType: 'text/html; charset=utf-8',
      },
    },
  }
  const { container } = render(
    <ImportFlow form={(onImported) => (
      <WebArticleImporter
        onImported={onImported}
        fetch={async () => new Response(JSON.stringify(okEnvelope))}
      />
    )} />,
  )
  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])

  fireEvent.change(screen.getByLabelText(/Web page address/i), {
    target: { value: 'https://en.wikipedia.org/wiki/Photosynthesis' },
  })
  fireEvent.change(screen.getByLabelText(/Firecrawl API key/i), { target: { value: 'fc-test' } })
  fireEvent.change(screen.getByLabelText(/Document title/i), { target: { value: 'Photosynthesis' } })
  fireEvent.click(screen.getByRole('radio', { name: 'I have permission to republish or adapt it' }))
  fireEvent.click(screen.getByRole('checkbox', { name: /I am responsible for rights/i }))
  fireEvent.click(screen.getByRole('button', { name: /Import this page/i }))
  await screen.findByRole('heading', { name: 'Page plan: Photosynthesis' })

  expect(await violationsIn(container)).toEqual([])
  expect(duplicateIds(container)).toEqual([])
})
```

Add `import { WebArticleImporter } from './components/WebArticleImporter'` at the top.

- [ ] **Step 2: Run to verify**

Run: `npx vitest run --project browser src/App.a11y.browser.test.tsx`
Expected: PASS. **A violation here is a real accessibility defect in the panel issue 12
shipped — fix the panel, never the audit's tag set.** The suite deliberately runs the full
WCAG A/AA set with nothing removed.

- [ ] **Step 3: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/App.a11y.browser.test.tsx
git commit -m "test: audit the web page form and its page plan for accessibility"
```

---

### Task 9: Make the documentation and licensing criteria mechanical

Criteria 5 and 6 were "someone reviewed it" until the design's self-review removed that
category. These are the checks that replace it, plus the two defects already found.

**Files:**
- Create: `src/docs-claims.test.ts`
- Modify: `THIRD-PARTY-NOTICES.md`

- [ ] **Step 1: Write the failing test**

```ts
import notices from '../THIRD-PARTY-NOTICES.md?raw'
import readme from '../README.md?raw'
import privacy from '../PRIVACY.md?raw'
import security from '../SECURITY.md?raw'
import accessibility from '../ACCESSIBILITY.md?raw'
import packageJson from '../package.json'
import { DOCUMENT_FORMAT_CAPABILITIES } from './import/capability'

const USER_FACING = { readme, privacy, security, accessibility }

test('every obligation in criterion 5 is stated in a file a user reads', () => {
  /*
   * Presence and location, never wording: prose must stay improvable. The
   * failure this catches is an obligation documented ONLY in `.scratch/`, which
   * no user ever opens.
   */
  const obligations: [string, RegExp][] = [
    ['local compute', /in (this|your) browser|locally as WebAssembly/i],
    ['memory-only credentials', /memory only|held in .*memory/i],
    ['firecrawl disclosure', /api\.firecrawl\.dev/i],
    ['no OCR', /OCR/],
    ['resource limits', /16 MiB|2 MiB/],
    ['recovery guidance', /try again|retry/i],
  ]
  const all = Object.values(USER_FACING).join('\n')
  for (const [name, pattern] of obligations) {
    expect(pattern.test(all), `no user-facing file states: ${name}`).toBe(true)
  }
})

test('every direct dependency appears in the third-party notices', () => {
  const listed = notices.toLowerCase()
  for (const name of Object.keys(packageJson.dependencies)) {
    // Match on the distinctive last path segment, so "@firecrawl/anydoc-wasm"
    // is found whether the table writes the scope or not.
    const needle = name.split('/').at(-1)!.toLowerCase()
    expect(listed.includes(needle), `${name} is not in THIRD-PARTY-NOTICES.md`).toBe(true)
  }
})

test('no parser this release enables is described as probe-only', () => {
  /*
   * The assertion that would have caught the real defect: both WASM parsers were
   * still called "Probe-only" long after issues 04 and 11 shipped them. A notice
   * that understates what ships is a licensing statement about the wrong thing.
   */
  const enabledParsers = new Set(
    DOCUMENT_FORMAT_CAPABILITIES.filter((entry) => entry.status === 'enabled').map((entry) => entry.parser),
  )
  for (const [needle, parser] of [['anydoc', 'anydoc'], ['pdf-inspector', 'pdf-inspector']] as const) {
    if (!enabledParsers.has(parser)) continue
    const line = notices.split('\n').find((row) => row.toLowerCase().includes(needle))
    expect(line, `${needle} is not listed at all`).toBeDefined()
    expect(line!.toLowerCase(), `${needle} is still described as probe-only`).not.toContain('probe-only')
  }
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/docs-claims.test.ts`
Expected: FAIL on the probe-only assertion for both parsers.

- [ ] **Step 3: Correct the notices**

Rewrite both rows to describe what actually ships, and re-read the rest of the table for the
same class of staleness:

```
| @firecrawl/anydoc-wasm 0.2.4 | MIT | Browser Worker parsing for released DOCX, ODT, RTF, and EPUB import |
| @firecrawl/pdf-inspector-wasm 1.17.0 | MIT | Browser Worker classification and text extraction for released PDF import |
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --project unit src/docs-claims.test.ts && npm run typecheck`
Expected: PASS. If the dependency test fails for a package genuinely not shipped to users,
add it to the notices anyway — the table's own header says it identifies "direct runtime and
build tools".

- [ ] **Step 5: Run the whole suite and commit**

```bash
npm run typecheck && npx vitest run
git add src/docs-claims.test.ts THIRD-PARTY-NOTICES.md
git commit -m "test: check the docs state what they must, and stop calling shipped parsers probe-only"
```

---

### Task 10: The acceptance record for what a machine cannot check

**Files:**
- Create: `docs/RELEASE-ACCEPTANCE.md`

- [ ] **Step 1: Write it**

Numbered, each step naming the exact command or action, with a table to record date, operator
and result. It must open by saying why these three are not automated — live Canvas needs
credentials nobody should hand a CI job, Firefox is outside the browser project by a recorded
decision, and a screen reader cannot be automated at all — so a later reader does not "fix"
them by deleting them.

The three checks:

1. **Live Canvas.** `npm run verify:canvas-live` against an instance the operator
   administers, with credentials in `.env.local`. Record: the course, the pages created, and
   that a second import of the same document UPDATED those pages rather than duplicating them.
2. **Firefox.** By hand: tab through the document form to the button using only the keyboard;
   start an import and cancel it; trigger an error and confirm focus lands on the message;
   confirm the progress line is announced. Record pass or fail per scenario.
3. **Screen reader.** VoiceOver or NVDA through one import end to end: the form, the findings,
   the page plan, the export. Record what was unclear, not merely pass or fail — an
   announcement that is technically present and useless is a defect this is meant to surface.

- [ ] **Step 2: Commit**

```bash
git add docs/RELEASE-ACCEPTANCE.md
git commit -m "docs: record the release checks a machine cannot run"
```

---

### Task 11: The gate

**Files:**
- Create: `scripts/verify-release.mjs`
- Modify: `package.json` (a `verify:release` script)

**Interfaces:**
- Produces: `CRITERIA` — one entry per acceptance criterion, each naming its checks.

- [ ] **Step 1: Write it**

```js
/**
 * Is the document importer releasable, and how would anyone know?
 *
 * This prints one row per acceptance criterion from issue 13 and the check that
 * closes it. Its value is not that it runs commands — anyone can run commands —
 * but that a criterion with NO check shows up as a hole instead of an
 * assumption.
 *
 * It reports exactly two kinds of thing: ENFORCED, which it runs, and MANUAL,
 * which it cannot. There is deliberately no third "reviewed" state: that is the
 * category that quietly stops happening.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const RUN = {
  typecheck: ['npm', ['run', 'typecheck']],
  tests: ['npx', ['vitest', 'run']],
  build: ['npm', ['run', 'build']],
  dist: ['npm', ['run', 'test:dist']],
}

const CRITERIA = [
  { n: 1, name: 'Capability table matches corpus-tested support', checks: ['typecheck', 'tests'] },
  { n: 2, name: 'Keyboard, focus, progress, cancellation, error recovery', checks: ['tests'], manual: 'Firefox and screen reader' },
  { n: 3, name: 'Hostile documents, URLs, archives, credentials', checks: ['tests'] },
  { n: 4, name: 'Cartridges unzip; manifests, bytes, assets, determinism', checks: ['tests'] },
  { n: 5, name: 'Documentation states its obligations', checks: ['tests'] },
  { n: 6, name: 'Dependency notices complete', checks: ['tests'] },
  { n: 7, name: 'Production build and artifact', checks: ['build', 'dist'], manual: 'Live Canvas acceptance' },
]
```

```js
/** The most recent recorded run, or undefined when nobody has run it. */
function lastRecordedRun() {
  const record = readFileSync(new URL('../docs/RELEASE-ACCEPTANCE.md', import.meta.url), 'utf8')
  // Rows look like `| 2026-08-29 | operator | pass |`. The newest date wins.
  const dates = [...record.matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|/gm)].map((m) => m[1])
  return dates.sort().at(-1)
}

function main() {
  const results = new Map()
  for (const [name, [command, args]] of Object.entries(RUN)) {
    process.stderr.write(`running ${name}...\n`)
    try {
      execFileSync(command, args, { stdio: 'inherit' })
      results.set(name, true)
    } catch {
      results.set(name, false)
    }
  }

  const recorded = lastRecordedRun()
  let failed = false
  console.log('\nRelease criteria\n')
  for (const criterion of CRITERIA) {
    const enforcedOk = criterion.checks.every((check) => results.get(check))
    if (!enforcedOk) failed = true
    const enforced = enforcedOk ? 'PASS' : 'FAIL'
    const manual = criterion.manual
      ? `  MANUAL: ${criterion.manual} — ${recorded ? `last recorded ${recorded}` : 'NEVER RUN'}`
      : ''
    console.log(`  ${criterion.n}. [${enforced}] ${criterion.name}${manual}`)
  }

  /*
   * Enforced failures fail the gate. A missing MANUAL record does NOT — the gate
   * reports, and the human decides whether an unrecorded manual check blocks
   * this particular release. A gate that blocked on it would be run with
   * `--force` within a week, and then it would be blocking on nothing.
   */
  if (failed) {
    console.log('\nNOT RELEASABLE: an enforced check failed.')
    process.exitCode = 1
  } else {
    console.log(`\nEnforced checks pass.${recorded ? '' : ' Manual acceptance has NEVER been recorded.'}`)
  }
}

main()
```

Add to `package.json`:

```json
"verify:release": "node scripts/verify-release.mjs"
```

- [ ] **Step 2: Run it**

Run: `npm run verify:release`
Expected: every enforced row passes; criteria 2 and 7 print MANUAL with `NEVER RUN` until the
record is filled in.

- [ ] **Step 3: Prove it fails when a check fails**

Temporarily break one test, run the gate, confirm it exits non-zero and names the criterion,
then revert. Record that you did.

- [ ] **Step 4: Commit**

```bash
npm run typecheck && npx vitest run
git add scripts/verify-release.mjs package.json
git commit -m "feat: add a release gate that names every criterion and what closes it"
```

---

### Task 12: Close issue 13

**Files:**
- Modify: `.scratch/document-import/issues/13-release-core-document-importer.md`,
  `.scratch/document-import/map.md`, `README.md`

- [ ] **Step 1: Run the gate and record the manual checks**

Run `npm run verify:release` and paste its table into the issue. The two MANUAL rows need the
human's recorded run from `docs/RELEASE-ACCEPTANCE.md` before the issue can be ticked — **if
they are empty, say so plainly and leave those criteria unticked** rather than claiming them.

- [ ] **Step 2: Tick the criteria and write the `## Answer`**

Each criterion gets the file and check that closes it. The Answer records: that this issue
added no capability and why that shaped it into a gate; that archive expansion was already
bounded and what Task 2 measured; that documentation and licensing were made mechanical
rather than reviewed, and what that trades away; that Firefox and screen-reader coverage are
attested rather than automated, by decision; and the residuals.

- [ ] **Step 3: Update `README.md`'s release scope**

The scope section should now describe a released importer rather than one with probe-only
parts. Re-read it end to end against `RELEASED_SOURCES`.

- [ ] **Step 4: Move the frontier in `map.md`**

Set 13 to `resolved`. The frontier becomes **14 — Graduate presentations**, whose blockers
(04, 09, 10) are already resolved. Note in the commit that 15 and 16 unblock from 13, and that
17 unblocked when 12 merged.

- [ ] **Step 5: Commit**

```bash
npm run typecheck && npx vitest run
git add .scratch/document-import/ README.md
git commit -m "docs: resolve issue 13 and record what the release gate does and does not prove"
```

---

## Open questions

Settled here so an implementer does not re-open them:

- **Why no real-document corpus.** Considered and rejected: repo weight, licensing
  bookkeeping, and fixtures whose meaning changes silently when replaced. Every parser fact in
  this project was measured against generated fixtures already. The price is that a generated
  fixture cannot show what it is evidence of, which is why `standsInFor` is mandatory and
  enforced by a test.
- **Why no Firefox browser project.** A second project roughly doubles browser-test wall time
  and adds a second flake surface, for engine differences that keyboard and focus assertions
  in Chromium mostly already catch. Firefox is attested in the acceptance record instead. This
  is a recorded decision, not an oversight — if Firefox-specific defects ever appear in the
  record, revisit it.
- **Whether `verify:production` belongs in the gate.** It needs no credentials but does need
  the network and a deployed origin, so it cannot run offline or in CI. It stays OUT of the
  enforced set and is named in criterion 7's manual row, because a gate that fails when the
  network is down teaches people to ignore the gate.
