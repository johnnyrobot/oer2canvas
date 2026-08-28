import { importStructuredDocument } from './document'
import { toChapter } from './to-chapter'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'
import { malformedStructuredFixture, semanticRtfFixture } from './testing/structured-document-fixtures'
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
const PACKAGEABLE_IMAGE_CASES = EPUB_ODT_RTF_FIXTURE_CASES.map((entry) => ({
  ...entry,
  // RTF's `\pict` destination has no attribute that carries alt text at
  // all — unlike DOCX's `descr`, EPUB's `alt`, and ODT's `<svg:desc>`,
  // which all round-trip "Cell diagram" through anydoc. Asserting the
  // expected alt explicitly (rather than only checking "some alt
  // attribute exists") is what stops a regression on the other three
  // formats from hiding behind "well, RTF doesn't have it anyway".
  expectedAlt: entry.format === 'rtf' ? '' : 'Cell diagram',
}))

test.each(PACKAGEABLE_IMAGE_CASES)(
  'a packageable embedded $format image becomes a cartridge reference, not a blocker',
  async ({ format, fixture, expectedAlt }) => {
    const imported = await importStructuredDocument(
      new File([await fixture({ embeddedImage: true })], `diagram.${format}`),
      { metadata },
    )

    expect(imported.report.counts.images).toBe(1)
    expect(imported.report.findings.some((finding) => finding.code === 'embedded-content')).toBe(false)
    expect(imported.work.sections[0]?.html).toContain('$IMS-CC-FILEBASE$/oer2canvas/')
    expect(imported.work.sections[0]?.html).not.toContain('[Embedded image')
    expect(imported.work.sections[0]?.html).toContain(`alt="${expectedAlt}"`)
    expect(imported.work.assets).toHaveLength(1)
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
