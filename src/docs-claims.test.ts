/*
 * Issue 13 criteria 5 and 6 (docs, dependency licensing) were "someone
 * reviewed it" until the design's self-review removed that category — a
 * review step is exactly the kind of check that quietly stops happening.
 * These three tests are what replaced it: presence/location of user-facing
 * obligations, and dependency/status coverage in THIRD-PARTY-NOTICES.md.
 *
 * `?raw` reads THIRD-PARTY-NOTICES.md, README.md, PRIVACY.md, SECURITY.md,
 * and ACCESSIBILITY.md as plain text even though this file lives in `src/`
 * and those root docs sit one directory above it. That works because Vite's
 * dev-server filesystem restriction guards access OUTSIDE the project root
 * (the directory holding `vite.config.ts`), not outside `src/` — and the
 * root markdown files are still inside the project root. Confirmed by
 * running this file: no fs-access error, so no `node:fs` fallback was
 * needed here.
 */
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
   * Presence and location, never wording: prose must stay improvable without
   * breaking this test. The failure this catches is an obligation documented
   * ONLY somewhere like `.scratch/` (a design doc), which no user ever opens
   * — criterion 5 requires it in README.md, PRIVACY.md, SECURITY.md, or
   * ACCESSIBILITY.md instead.
   */
  const obligations: [string, RegExp][] = [
    ['local compute', /in (this|your) browser|locally as WebAssembly/i],
    ['memory-only credentials', /memory only|held in .*memory/i],
    ['firecrawl disclosure', /api\.firecrawl\.dev/i],
    /*
     * Issue 17's seventh criterion. Three obligations, because the second
     * deployment mode makes three claims a user or an operator would otherwise
     * have to discover: that a key is not required, that the extraction service
     * must serve HTTPS (and why localhost cannot), and that the relay stays out
     * of it. Presence and location only, as above — the wording must stay
     * improvable.
     */
    ['self-hosted extraction needs no key', /no third-party account and no key|no account and no key|no API key is sent/i],
    ['why the extractor must serve https', /loopback|mixed content/i],
    ['the relay stays out of web import', /relay is (still )?not involved|not behind the relay|beside the relay/i],
    ['no OCR', /OCR/],
    ['resource limits', /16 MiB|2 MiB/],
    ['recovery guidance', /try again|retry/i],
    ['idea framework attribution', /IDEA Framework[^.\n]*CC BY 4\.0/i],
    ['idea never gates', /IDEA[^.\n]*(optional|never (blocks|gates))/i],
    ['idea reviews stay in this browser', /IDEA[^.\n]*(IndexedDB|in (this|your) browser)/i],
    /*
     * Slice 4: the model key and the model call. The key's location and its
     * absence from the server are one claim; that nothing is sent without a
     * press is the other. Both must be in a file a user reads.
     */
    ['idea model key on device', /(model|provider) (API )?key[^.\n]*(this|your) (browser|device)[^.\n]*(never|not)[^.\n]*server/i],
    ['idea model send on click', /(nothing|no text)[^.\n]*sent[^.\n]*(until|unless)[^.\n]*(press|click)/i],
    // Slice 5: both image services named in one sentence a user reads.
    ['idea image search disclosure', /(commons\.wikimedia\.org|Wikimedia Commons)[^.\n]*(Openverse)/i],
  ]
  const all = Object.values(USER_FACING).join('\n')
  for (const [name, pattern] of obligations) {
    expect(pattern.test(all), `no user-facing file states: ${name}`).toBe(true)
  }
})

test('every direct dependency appears in the third-party notices', () => {
  const listed = notices.toLowerCase()
  for (const name of Object.keys(packageJson.dependencies)) {
    // Match on the distinctive last path segment, so a scoped package like
    // "@firecrawl/anydoc-wasm" is found whether the table writes the scope
    // or not — THIRD-PARTY-NOTICES.md's own rows drop the "@firecrawl/"
    // prefix (see "@firecrawl/anydoc-wasm 0.2.4" vs. how React and Temml
    // are listed by their bare names).
    const needle = name.split('/').at(-1)!.toLowerCase()
    expect(listed.includes(needle), `${name} is not in THIRD-PARTY-NOTICES.md`).toBe(true)
  }
})

test('no parser this release enables is described as probe-only', () => {
  /*
   * The assertion that would have caught the real defect: both WASM parsers
   * (`@firecrawl/anydoc-wasm` and `@firecrawl/pdf-inspector-wasm`) were still
   * described as "Probe-only" in THIRD-PARTY-NOTICES.md long after issue 04
   * shipped DOCX/ODT/RTF/EPUB import and issue 11 shipped PDF import — both
   * are `status: 'enabled'` in `DOCUMENT_FORMAT_CAPABILITIES`
   * (`src/import/capability.ts`) today. A notice that understates what ships
   * is a licensing statement about the wrong thing.
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
