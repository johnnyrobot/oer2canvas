import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
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
 * WHY THIS FILE DOES NOT WAIT FOR THE WRITER: an earlier version of this file
 * had a `beforeAll` that polled for the artifacts with a bounded timeout,
 * because `unit` (this file's project) and `browser` (the writer's project)
 * are separate Vitest projects with no ordering between them. That polling was
 * itself the bug: its ceiling was sized against a LOCAL wall-clock measurement,
 * but `.github/workflows/ci.yml` records this suite at 77s on CI against 6s
 * locally — roughly 13x, not the ~3x the local number implied — which put the
 * real CI timing uncomfortably close to the bound. Worse, "wait for a sibling
 * project" does not fit Vitest's project model at all: `npx vitest run
 * --project unit` alone — an entirely ordinary command — would burn the whole
 * timeout on a clean tree and then fail, with nothing actually broken.
 *
 * The actual fix is sequencing, not waiting: `npm run test:artifacts`
 * (`package.json`) runs the browser writer and then this file, in that order,
 * as two separate `vitest run` invocations joined by `&&` — so the writer has
 * either finished or already failed before this file's process even starts.
 * This file is EXCLUDED from the `unit` project's default `include` in
 * `vitest.config.ts` for the same reason: it depends on an artifact only
 * `test:artifacts` guarantees exists, so a plain `npx vitest run` must not run
 * it. `test:artifacts` reaches this file anyway through its own tiny config,
 * `vitest.artifact-reader.config.ts` — see that file for why a CLI filter
 * cannot simply un-exclude it from `vitest.config.ts`'s `unit` project.
 * CI runs `npm run test:artifacts` as its own step to keep this coverage
 * rather than trading it away.
 */

/** Named once so both the guard below and a human reading the failure agree on it. */
const PRODUCE_ARTIFACTS_COMMAND = 'npm run test:artifacts'

test.each(releaseEnabledFormats())(
  '%s cartridge is a valid archive with the manifest shape Canvas accepts',
  (format) => {
    const path = cartridgeArtifactPath(format)
    // Fails FAST and names the fix, rather than the opaque ENOENT `unzip`
    // itself would throw. This does not (and cannot) catch a STALE artifact
    // left over from a previous run — the file exists either way, so this
    // guard never fires on one. Staleness risk is low regardless: `npm run
    // test:artifacts` chains the writer and this reader with `&&`, so this
    // file only runs once the writer has already succeeded on the current
    // tree. This file is only ever meant to run via `test:artifacts`,
    // immediately after the writer that produces this path.
    if (!existsSync(path)) {
      throw new Error(`${path} does not exist. Run '${PRODUCE_ARTIFACTS_COMMAND}' to build it, then re-run.`)
    }

    const archive = unzipped(path)
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
    // one `type="webcontent"` resource — the page itself, for every format
    // except PPTX and ODP, whose baseline cases now also carry a packaged
    // image (see the dedicated tests below).
    expect(manifest).toContain('<manifest')
    expect(manifest).toContain('type="webcontent"')
  },
)

/**
 * Asserts the shape both the pptx and odp tests below need in common, against
 * a REAL `unzip` — the one place a `web_resources/` entry surviving real parse
 * → compile → `buildCartridge` → zip is checked at all, closing the gap
 * `engine/export/cartridge.test.ts`'s synthetic asset cannot: that unit test
 * proves `buildCartridge` packages an asset it is HANDED, never that a real
 * deck's own picture reaches one.
 */
function expectPackagedImage(format: 'pptx' | 'odp'): void {
  const path = cartridgeArtifactPath(format)
  if (!existsSync(path)) {
    throw new Error(`${path} does not exist. Run '${PRODUCE_ARTIFACTS_COMMAND}' to build it, then re-run.`)
  }
  const archive = unzipped(path)
  // `prepareAssets` (`import/assets.ts`) names a PNG asset `image1-<hash>.png`
  // and `engine/export/cartridge.ts` archives it under `oer2canvas/` inside
  // `web_resources/` — the exact shape `cartridge.test.ts` pins with a
  // synthetic asset, matched here by pattern because the hash is the real
  // image's own content hash, not a value this test controls.
  expect(archive.list).toMatch(/web_resources\/oer2canvas\/image1-[0-9a-f]+\.png/)

  const manifest = archive.read('imsmanifest.xml')
  const webcontentResources = manifest.match(/type="webcontent"/g) ?? []
  // TWO: one `<resource>` for the page itself (every format's manifest has
  // this one), and a SECOND for the packaged image — the count that proves
  // the asset has its own manifest resource rather than merely sitting in the
  // zip unreferenced, which Canvas would then have no reason to import.
  expect(webcontentResources).toHaveLength(2)
  expect(manifest).toMatch(/<file href="web_resources\/oer2canvas\/image1-[0-9a-f]+\.png"\/>/)
}

// PPTX and ODP EACH GET THEIR OWN TEST, not a `test.each`, because
// `testing/corpus.ts` deliberately puts a described-image case first among
// EACH format's own cases (`pptx-packaged-image`, `odp-packaged-image` — see
// that module's comment) so both formats' one baseline case, of all ten,
// actually carries a packaged asset through the real pipeline — every other
// format's baseline case is still the no-embedded-asset shape the loop
// above's comment describes.
test('the pptx cartridge packages its slide image into web_resources, verified by a real unzip', () => {
  expectPackagedImage('pptx')
})

// Measured, not assumed identical to the PPTX case above: ran both real
// artifacts through the same real `unzip` and compared byte-for-byte-equal
// shapes (same `image1-<hash>.png` name — the SAME embedded PNG content hash
// both fixture builders share — same two `type="webcontent"` resources, same
// `<file href>` reference). ODP's `draw:frame`/`draw:image` picture packages
// through the shared `prepareAssets` path with no difference from PPTX's
// `p:pic` at the cartridge layer, which is the "one shared reconciler, one
// shared packaging path" claim `odp-packaged-image`'s own `standsInFor`
// makes — confirmed here at the archive level, not merely at the importer's.
test('the odp cartridge packages its slide image into web_resources, verified by a real unzip', () => {
  expectPackagedImage('odp')
})

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
