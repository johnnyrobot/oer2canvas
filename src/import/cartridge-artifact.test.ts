import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { setTimeout as sleep } from 'node:timers/promises'
import { releaseEnabledFormats } from './capability'
import { cartridgeArtifactPath } from './testing/cartridge-artifact-paths'

/**
 * Half of a deliberate two-file split — see `cartridge-artifact.browser.test.ts`
 * for the other half, which drives the real pipeline (real WASM parsers, real
 * compile+audit, real `buildCartridge`+`writeZip`) and writes one cartridge per
 * released format to `artifacts/cartridge-artifact/`.
 *
 * THIS file is the one that matters: a REAL `unzip`, not our own idea of what a
 * well-formed archive looks like — the same stance `zip.test.ts` takes for the
 * zip writer itself, extended here to a whole cartridge. It needs
 * `node:child_process`, which is why it is excluded from the app project in
 * `tsconfig.json` and picked up by `tsconfig.node.json` instead.
 *
 * WHY THIS IS A SEPARATE FILE FROM THE ONE THAT BUILDS THE CARTRIDGES, RATHER
 * THAN ONE `unzip` CALL INSIDE IT: building a cartridge needs the real anydoc
 * and pdf-inspector WASM parsers, which only run in a real browser — this repo's
 * `unit` Vitest project is jsdom, which has no WASM runtime and no layout for
 * the audit's iframe. `zip.test.ts` gets away with one file because it only
 * needs `writeZip`, which is pure JS with no parser and no audit underneath it.
 *
 * WHY THIS FILE WAITS INSTEAD OF JUST READING: `unit` (this file's project) and
 * `browser` (the file that writes the artifacts) are separate Vitest projects,
 * and nothing in this repo's `vitest.config.ts` orders one project's test files
 * ahead of another's. That is not a theoretical concern — it was checked by hand
 * before writing this file: a throwaway `unit` test asserting an artifact a
 * throwaway `browser` test writes 3 seconds later exists FAILED consistently,
 * because `unit` tests start and finish in single-digit milliseconds while the
 * `browser` project is still launching Chromium. `beforeAll` below waits for
 * every artifact this file needs, with a bounded timeout and a message naming
 * the fix, rather than either racing (flaky-or-worse: reliably wrong) or
 * silently hanging forever if the writer genuinely never runs.
 */

// Measured on this machine: the full suite (`npx vitest run`, currently 130
// files / 1224 tests, unthrottled) completes in about 14 seconds wall-clock,
// and `cartridge-artifact.browser.test.ts` — the file this wait is for — is
// one small piece of that, itself measured at under 3 seconds together with
// its two sibling browser files. This ceiling is roughly 3x the whole suite's
// measured wall time, so a slower or more loaded CI runner has real headroom
// without letting a genuinely broken writer hang the suite indefinitely.
const ARTIFACT_WAIT_TIMEOUT_MS = 45_000
// How often to re-check, once the artifact still doesn't exist. Small enough
// not to visibly delay the common case (the file is usually already there by
// the time this runs), large enough not to spin the event loop pointlessly.
const ARTIFACT_POLL_INTERVAL_MS = 250
// Vitest's own hook timeout has to be strictly longer than the wait loop's own
// deadline, or Vitest's generic "hook timed out" fires first and this file's
// specific, actionable error below never gets the chance to.
const HOOK_TIMEOUT_MARGIN_MS = 5_000

async function waitForArtifact(path: string): Promise<void> {
  const deadline = Date.now() + ARTIFACT_WAIT_TIMEOUT_MS
  while (!existsSync(path)) {
    if (Date.now() >= deadline) {
      throw new Error(
        `${path} was never written within ${ARTIFACT_WAIT_TIMEOUT_MS}ms. ` +
          "cartridge-artifact.browser.test.ts (the 'browser' vitest project) builds it; run " +
          "'npx vitest run --project browser src/import/cartridge-artifact.browser.test.ts' " +
          'on its own to see whether it is failing outright rather than just running slowly.',
      )
    }
    await sleep(ARTIFACT_POLL_INTERVAL_MS)
  }
}

beforeAll(async () => {
  await Promise.all(releaseEnabledFormats().map((format) => waitForArtifact(cartridgeArtifactPath(format))))
}, ARTIFACT_WAIT_TIMEOUT_MS + HOOK_TIMEOUT_MARGIN_MS)

/**
 * A REAL unzip, because our own reader agreeing with our own writer proves
 * nothing — the same helper shape `zip.test.ts`'s `roundTrip` uses, adapted to
 * read an archive that is already on disk (this file's job is verification,
 * not production) rather than one it just wrote itself.
 */
function unzipped(path: string): { list: string; read: (name: string) => string } {
  execFileSync('unzip', ['-t', path])
  return {
    list: execFileSync('unzip', ['-l', path], { encoding: 'utf8' }),
    read: (name) => execFileSync('unzip', ['-p', path, name], { encoding: 'utf8' }),
  }
}

test.each(releaseEnabledFormats())(
  '%s cartridge is a valid archive with the manifest shape Canvas accepts',
  (format) => {
    const archive = unzipped(cartridgeArtifactPath(format))
    expect(archive.list).toContain('imsmanifest.xml')
    // THE MARKER (`engine/export/cartridge.ts`'s `buildCartridge`): measured
    // against a live Canvas to be the difference between wiki pages and a
    // folder of unreadable file attachments. Its presence in the archive is
    // exactly what `buildCartridge` unconditionally emits for every export.
    expect(archive.list).toContain('course_settings/canvas_export.txt')

    const manifest = archive.read('imsmanifest.xml')
    // The shape issue 07 measured Canvas accepting, and the same two
    // substrings `packaged-cartridge.browser.test.ts` already asserts against
    // the in-memory manifest string: a real `<manifest>` root, and at least
    // one `type="webcontent"` resource (the page itself, since every released
    // format here is a single-page, no-embedded-asset case).
    expect(manifest).toContain('<manifest')
    expect(manifest).toContain('type="webcontent"')
  },
)
