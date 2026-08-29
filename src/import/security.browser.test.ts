import { probeParser } from './parsers/probe'
import { compressionBombDocx } from './testing/archive-bomb'
import { malformedStructuredFixture } from './testing/structured-document-fixtures'
import { encryptedPdfFixture, malformedPdfFixture } from './testing/pdf-fixture'
import { semanticDocxFixture } from './testing/docx-fixture'
import { importStructuredDocument } from './document'
import { importWebArticle } from './web'
import { DOCUMENT_IMPORT_LIMITS } from './limits'

/*
 * Issue 13, criterion 3: hostile documents, HTML, URLs, archive expansion,
 * malformed binaries and active content must all be refused by a NAMED code,
 * not merely "not crash". A test that only checks a promise rejects proves
 * nothing about whether the refusal is the RIGHT one, or whether it tells a
 * user whether retrying could ever work — `actionableFailure` in
 * `./parsers/probe.ts` derives `retryable` from `code`, and `code` for the
 * AnyDoc parser is itself derived from an English message inside
 * `./workers/anydoc.worker.ts`'s `failure()`. An upstream wording change can
 * silently flip that derivation without any promise here ever resolving
 * instead of rejecting, so every case below pins the code (and, where it
 * matters to a user deciding whether to retry, `retryable`) explicitly.
 *
 * Runs in the browser project against the REAL `@firecrawl/anydoc-wasm` and
 * `@firecrawl/pdf-inspector-wasm` builds: a mocked parser would tell us
 * nothing about what a hostile file does to the actual WASM boundary.
 */

test('a compression bomb is refused by the memory ceiling, not by luck', async () => {
  /*
   * Measured 2026-08-29 (Task 2, `docs/evidence/...`): a DOCX expanding to
   * roughly 33.2 MB was refused in about 1.6 s. The refusal comes from
   * `resultBudgetFailure`'s WASM-memory check in `probe.ts` — OUR 128 MiB
   * ceiling (`DOCUMENT_IMPORT_LIMITS.maximumWasmMemoryBytes`), not the
   * vendor's. Naming the code AND the wording is the point: a future change
   * that made this fail as `parse-failed`, or that changed the message so it
   * no longer named the limit, would still "refuse" while silently
   * confusing a user about whether the file could ever succeed.
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

test('a compression bomb far above the ceiling is refused by the vendor first', async () => {
  /*
   * Measured 2026-08-29 (Task 2): at 4,000,000 paragraphs (332 MB expanded),
   * `@firecrawl/anydoc-wasm` throws internally on its OWN `max_entry_bytes`
   * guard — 40 ms in, long before our `resultBudgetFailure` ever runs,
   * because the module never returns a result to check. That refusal
   * arrives as the Worker's `failure` message, mapped through
   * `anydoc.worker.ts:58-60`'s `resourceLimit` -> `'resource-limit'`
   * branch — the SAME code the 400,000-paragraph case above gets, but by a
   * completely different path. This is why both rungs are pinned rather
   * than one being deleted as "redundant": the small rung proves OUR
   * ceiling still names itself in the message; this one proves the
   * vendor's own ceiling still maps to a code this app recognizes, WITHOUT
   * asserting wording that belongs to the vendor, not to us.
   */
  const bomb = await compressionBombDocx(4_000_000)
  await expect(probeParser({
    parser: 'anydoc', bytes: bomb.buffer as ArrayBuffer, formatHint: 'docx',
  })).rejects.toMatchObject({
    name: 'ParserProbeError',
    code: 'resource-limit',
  })
})

test('an input above the byte ceiling is refused before a Worker starts', async () => {
  // Cheapest possible refusal, and the one that protects everything downstream:
  // `createParserProbeRunner` checks `bytes.byteLength` before it ever calls
  // `dependencies.createWorker`, so a hostile upload never spins up WASM at all.
  await expect(probeParser({
    parser: 'anydoc',
    bytes: new ArrayBuffer(DOCUMENT_IMPORT_LIMITS.maximumInputBytes + 1),
    formatHint: 'docx',
  })).rejects.toMatchObject({ code: 'resource-limit', message: expect.stringMatching(/before.*Worker/i) })
})

test.each(['epub', 'odt'] as const)('a malformed %s is refused and stays retryable', async (format) => {
  // Retryable, because a truncated download IS worth retrying — unlike an
  // encrypted PDF, asserted below. `malformedStructuredFixture('epub' | 'odt')`
  // is not a readable zip archive at all, which both formats' package
  // container rejects identically ("not a readable zip archive: ... Could
  // not find EOCD"), landing on AnyDoc's `malformed` code.
  //
  // `rtf` is deliberately NOT in this list — see the dedicated test below for
  // why `malformedStructuredFixture('rtf')` cannot be pinned the same way.
  await expect(probeParser({
    parser: 'anydoc', bytes: malformedStructuredFixture(format).buffer, formatHint: format,
  })).rejects.toMatchObject({ name: 'ParserProbeError', code: 'malformed', retryable: true })
})

test('a malformed rtf has no signal at the parser layer; the refusal is one layer up', async () => {
  /*
   * Verified empirically 2026-08-29: `malformedStructuredFixture('rtf')` is
   * `{\rtf1\ansi}` — 12 bytes, and syntactically a COMPLETE, valid RTF
   * document with an empty body. RTF's grammar has nothing left to be
   * malformed once the destination braces balance, so AnyDoc parses it
   * successfully: `probeParser` RESOLVES (it does not reject at all) with
   * `counts.blocks === 0` and `normalized.html === ''`. There is no
   * `ParserProbeError`, and therefore no `code` and no `retryable` to pin at
   * this layer — asserting one here would be exactly the "does not crash"
   * anti-pattern the rest of this file exists to avoid.
   *
   * The refusal a user actually sees comes from `importStructuredDocument`'s
   * no-readable-content guard (`document.ts`), which throws a plain `Error`
   * (not a `ParserProbeError` — it carries no `code`/`retryable` at all,
   * since nothing downstream reads either field off a generic import
   * failure today). That boundary is already pinned by
   * `document.browser.test.ts`'s `'%s malformed input fails explicitly'`
   * case, whose regex includes `no readable structured content` for exactly
   * this reason. This test exists so that boundary is named here too,
   * rather than assumed.
   */
  const resolved = await probeParser({
    parser: 'anydoc', bytes: malformedStructuredFixture('rtf').buffer, formatHint: 'rtf',
  })
  expect(resolved.counts.blocks).toBe(0)
  expect(resolved.normalized?.html).toBe('')

  const file = new File([malformedStructuredFixture('rtf')], 'broken.rtf')
  await expect(importStructuredDocument(file, {
    metadata: { title: 'Hostile', rightsAuthority: 'own', rightsAcknowledged: true },
  })).rejects.toThrow(/no readable structured content/i)
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

test('active content inside a DOCUMENT reaches the same refusal as an unsafe pasted link', async () => {
  /*
   * Verified empirically 2026-08-29 that OOXML cannot express a live
   * `<script>` element at all: a `<w:t>` run is always plain text, and
   * `anydoc-html.ts`'s `renderInlines` runs every run through `escapeHtml`
   * before it reaches the page, so literal `<script>...</script>` text in a
   * run poses no risk and produces no finding — it is just escaped prose.
   * The one hostile construct DOCX CAN carry is a hyperlink relationship
   * whose target is a `javascript:` URI, which `semanticDocxFixture`'s new
   * `activeContent` option adds (see `docx-fixture.ts`).
   *
   * That construct does NOT reach `import-active-content-removed` — that
   * code is raised by `markup.ts`'s sanitizer, which this DOCUMENT path
   * never calls (`importStructuredDocument` builds its HTML straight from
   * `anydoc-html.ts`'s `normalizeAnyDocDocument`, not from a Markdown/HTML
   * string). Instead, `anydoc-html.ts`'s own `safeHref` allowlists only
   * `http:`/`https:`/`mailto:` targets; a `javascript:` target fails that
   * allowlist and is dropped, and the link renders through the
   * `unresolved-link` finding — the SAME code an unresolvable relative link
   * gets. Confirmed against the real parser: the hyperlink's visible text
   * ("Click for extra credit") survives as plain text with no `<a>`, no
   * `javascript:`, and no script-shaped markup anywhere in the output.
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
    .toContain('unresolved-link')
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
