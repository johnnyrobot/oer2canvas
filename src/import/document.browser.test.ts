import { importStructuredDocument } from './document'
import { toChapter } from './to-chapter'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'
import {
  malformedStructuredFixture,
  semanticEpubFixture,
  semanticOdtFixture,
  semanticRtfFixture,
} from './testing/structured-document-fixtures'
import { EPUB_ODT_RTF_FIXTURE_CASES } from './testing/document-fixture-cases'

const metadata = {
  title: 'Biology reader',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

test.each(EPUB_ODT_RTF_FIXTURE_CASES)('$format reaches deterministic ImportedWork through content validation', async ({ format, fixture }) => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  const imported = await importStructuredDocument(
    new File([await fixture()], `biology.${format}`),
    { metadata },
  )
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()

  expect(imported).toMatchObject({
    work: { title: 'Biology reader', format, assets: [] },
    report: {
      parser: 'anydoc',
      format,
      originalName: `biology.${format}`,
      counts: { tables: 1, images: 0 },
    },
  })
  expect(imported.report.counts.headings).toBeGreaterThanOrEqual(1)
  const html = new DOMParser().parseFromString(imported.work.sections[0]!.html, 'text/html')
  const children = [...html.body.children]
  const heading = children.findIndex((element) => element.matches('h1') && element.textContent === 'Cell Biology')
  const paragraph = children.findIndex((element) => element.matches('p') && element.textContent?.includes('Cells are organized'))
  const list = children.findIndex((element) => element.matches('ul') && element.textContent?.includes('Membrane'))
  const table = children.findIndex((element) => element.matches('table') && element.textContent?.includes('Stores DNA'))
  expect(heading).toBeGreaterThanOrEqual(0)
  expect(paragraph).toBeGreaterThan(heading)
  expect(list).toBeGreaterThan(paragraph)
  expect(table).toBeGreaterThan(list)
  expect(html.querySelector('a')).toHaveAttribute('href', 'https://example.edu/cells')
  expect(html.querySelector('table')).toHaveTextContent('Stores DNA')
})

// DOCX already has this exact coverage in `file.browser.test.ts` (the
// "packageable embedded DOCX image" test); the split it pins — a
// packageable image becomes a cartridge reference instead of the old
// `embedded-content` blocker — needs pinning for EPUB/ODT/RTF too, since
// nothing exercised images on those three formats before this fixture
// gained `embeddedImage`.
//
// RTF's expected alt is `undefined` (no `alt` attribute at all), NOT `''`.
// `\pict` has no attribute that could carry alt text, so anydoc reports
// `alt === ''` for it exactly like it would for a DOCX/EPUB/ODT image whose
// OWN carrier was left empty or omitted (verified empirically against the
// wasm directly: anydoc 0.2.4 never returns `undefined` for `Inline.alt` on
// ANY of the four formats). `anydoc-html.ts` treats that `''` as
// undescribed rather than decorative and omits the `alt` attribute
// entirely — see its `altAttribute` comment — so what actually
// distinguishes RTF here is only that its fixture supplies no carrier,
// not that RTF is specially exempt from this collapse. The DOCX/EPUB/ODT
// "no alt carrier" cases below pin that the other three formats hit the
// identical collapse the moment THEIR carrier is left out too.
const PACKAGEABLE_IMAGE_CASES = EPUB_ODT_RTF_FIXTURE_CASES.map((entry) => ({
  ...entry,
  expectedAlt: entry.format === 'rtf' ? undefined : 'Cell diagram',
}))

test.each(PACKAGEABLE_IMAGE_CASES)(
  'a packageable embedded $format image becomes a cartridge reference, not a blocker',
  async ({ format, fixture, expectedAlt }) => {
    const imported = await importStructuredDocument(
      new File([await fixture({ embeddedImage: true })], `diagram.${format}`),
      { metadata },
    )
    const img = new DOMParser().parseFromString(imported.work.sections[0]!.html, 'text/html').querySelector('img')

    expect(imported.report.counts.images).toBe(1)
    expect(imported.report.findings.some((finding) => finding.code === 'embedded-content')).toBe(false)
    expect(imported.work.sections[0]?.html).toContain('$IMS-CC-FILEBASE$/oer2canvas/')
    expect(imported.work.sections[0]?.html).not.toContain('[Embedded image')
    expect(img).not.toBeNull()
    if (expectedAlt === undefined) {
      expect(img?.hasAttribute('alt')).toBe(false)
    } else {
      expect(img?.getAttribute('alt')).toBe(expectedAlt)
    }
    expect(imported.work.assets).toHaveLength(1)
  },
)

// The shared collapse pinned above for RTF (no alt carrier -> `alt === ''`
// -> importer omits the attribute) is NOT an RTF-specific behaviour. EPUB
// and ODT each have a real optional alt carrier (`<img alt>`,
// `<svg:desc>`), and leaving it out hits the exact same path anydoc gives
// RTF unconditionally. Without this case, a reader of the RTF test above
// could wrongly conclude the other formats are safe from it just because
// their fixtures happen to always supply alt text. DOCX has the matching
// "no alt carrier" case in `file.browser.test.ts`, beside its own
// packageable-image test.
const NO_ALT_CARRIER_CASES = [
  { format: 'epub', fixture: semanticEpubFixture },
  { format: 'odt', fixture: semanticOdtFixture },
] as const

test.each(NO_ALT_CARRIER_CASES)(
  'an embedded $format image with no alt carrier is treated as undescribed, not decorative',
  async ({ format, fixture }) => {
    const imported = await importStructuredDocument(
      new File([await fixture({ embeddedImage: true, noAltCarrier: true })], `diagram.${format}`),
      { metadata },
    )
    const img = new DOMParser().parseFromString(imported.work.sections[0]!.html, 'text/html').querySelector('img')

    expect(imported.report.counts.images).toBe(1)
    expect(imported.report.findings.some((finding) => finding.code === 'embedded-content')).toBe(false)
    expect(imported.work.sections[0]?.html).toContain('$IMS-CC-FILEBASE$/oer2canvas/')
    expect(img).not.toBeNull()
    // No `alt` attribute at all — not `alt=""`. Omitting it entirely is what
    // routes the image into the "describe this" queue kind instead of
    // "confirm decorative" (`engine/compile/steps/alt.ts`).
    expect(img?.hasAttribute('alt')).toBe(false)
  },
)

test('validated content rejects an RTF renamed with an ODT extension', async () => {
  const renamed = new File([semanticRtfFixture()], 'renamed.odt', {
    type: 'application/vnd.oasis.opendocument.text',
  })

  await expect(importStructuredDocument(renamed, { metadata }))
    .rejects.toThrow(/contents are RTF, not an ODT document/i)
})

test.each(['epub', 'odt', 'rtf'] as const)('%s malformed input fails explicitly', async (format) => {
  const malformed = new File([malformedStructuredFixture(format)], `broken.${format}`)

  await expect(importStructuredDocument(malformed, { metadata }))
    .rejects.toThrow(/could not inspect|not recognized|malformed|no readable structured content/i)
})

test.each(EPUB_ODT_RTF_FIXTURE_CASES)('$format long corpus remains ordered and within the browser budget', async ({ format, fixture }) => {
  const source = await fixture({ additionalParagraphs: 1_000 })
  const imported = await importStructuredDocument(
    new File([source], `long.${format}`),
    { metadata },
  )

  const text = new DOMParser()
    .parseFromString(imported.work.sections[0]!.html, 'text/html')
    .body.textContent ?? ''
  expect(text.indexOf(`Long ${format.toUpperCase()} paragraph 1.`))
    .toBeLessThan(text.indexOf(`Long ${format.toUpperCase()} paragraph 1000.`))
})

test.each(EPUB_ODT_RTF_FIXTURE_CASES)('$format uses the shared compile, audit, and cartridge path', async ({ format, fixture }) => {
  const imported = await importStructuredDocument(
    new File([await fixture()], `workflow.${format}`),
    { metadata },
  )
  const compiled = await compileAndAuditChapter(toChapter(imported.work), {
    profile: DOCUMENT,
    deps: {
      validateAllowlist: async (html) => ({ html, removedSemantic: [] }),
      audit: async () => ({ issues: [] }),
    },
  })
  const gateHtml = compiled.sections[0]?.gate?.html ?? ''
  const exported = buildCartridge([compiled]).find((entry) =>
    entry.name.startsWith('wiki_content/') && entry.name.endsWith('.html'))

  expect(gateHtml).toContain('Cell Biology')
  expect(gateHtml).toContain('Stores DNA')
  expect(new TextDecoder().decode(exported?.data)).toContain(gateHtml)
})
