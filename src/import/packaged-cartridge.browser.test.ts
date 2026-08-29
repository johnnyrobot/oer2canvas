import { commands } from 'vitest/browser'
import { semanticDocxFixture } from './testing/docx-fixture'
import { DOCUMENT_FIXTURE_CASES } from './testing/document-fixture-cases'
import { toBase64 } from './testing/base64'
import { importStructuredDocument } from './document'
import { toChapter } from './to-chapter'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'
import { writeZip } from '../engine/export/zip'

const metadata = {
  title: 'Biology handout',
  author: 'Ada Instructor',
  sourceName: 'Biology Department',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

/**
 * Produces the acceptance artifact `scripts/verify-canvas-image-tracer.mjs`
 * imports into a live Canvas (document-import issue 08). It drives the REAL
 * pipeline — the anydoc Worker (via the public `importStructuredDocument`
 * seam `file.browser.test.ts` already exercises), the real compile+gate
 * (`compileAndAuditChapter` with NO `deps` override, so this runs the actual
 * production allowlist and axe audit rather than a stub — the same call
 * `App.tsx`'s `compileForReview` makes), and the real `buildCartridge` +
 * `writeZip` pair `download.ts` uses for a genuine export. What Canvas is
 * handed here is exactly what an instructor's browser would hand it.
 *
 * Driving the app's UI with Playwright instead would rest this acceptance
 * proof on brittle selectors and re-test the interface rather than the
 * packaging this issue is actually about.
 */
test('emits a cartridge whose packaged image survives the gate', async () => {
  const file = new File([await semanticDocxFixture({ embeddedImage: true })], 'diagram.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  const imported = await importStructuredDocument(file, { metadata })
  const compiled = await compileAndAuditChapter(toChapter(imported.work), { profile: DOCUMENT })

  // The load-bearing assertion: if the real gate ever stopped preserving the
  // packaged-image reference (allowlist regression, gate rewriting `img.src`,
  // etc.), this is what catches it — BEFORE the bytes below ship into an
  // artifact and get handed to a live Canvas that would otherwise just render
  // a broken picture with nobody the wiser.
  const gateHtml = compiled.sections[0]?.gate?.html ?? ''
  expect(gateHtml).toContain('$IMS-CC-FILEBASE$/oer2canvas/')

  const cartridge = await writeZip(buildCartridge([compiled]))
  await commands.writeFile('artifacts/packaged-image-tracer/tracer.imscc', toBase64(cartridge), {
    encoding: 'base64',
  })
})

/**
 * Issue 09 requires acceptance across all four supported document formats,
 * not just the DOCX the live-Canvas tracer above exercises. The Canvas-side
 * behaviour depends entirely on the cartridge shape (manifest entries, file
 * bytes, resource wiring) — so this asserts offline that docx, epub, odt and
 * rtf all converge on the SAME cartridge shape rather than re-running the one
 * live import four times.
 */
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
    // THIS ASSERTION PINS THE SHAPE WE SHIP, NOT A CANVAS REQUIREMENT. The
    // recorded measurement behind `src/engine/export/cartridge.ts`'s manifest
    // builder found the `webcontent-dependencies` variant — this same standalone
    // resource PLUS a `<dependency identifierref="...">` from the page — passed
    // every required behaviour too. The tie was broken toward the simpler
    // manifest; the dependency was measured as OPTIONAL, not wrong. So read this
    // as "all four formats converge on one shape", which is what the test is
    // for, and not as "Canvas rejects a dependency", which was measured false.
    expect(manifest).not.toContain('<dependency')
  },
)
