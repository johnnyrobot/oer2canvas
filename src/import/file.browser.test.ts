import { imageOnlyDocxFixture, semanticDocxFixture } from './testing/docx-fixture'
import { importStructuredDocument } from './document'
import { toChapter } from './to-chapter'
import { compileAndAuditChapter } from '../engine'
import { DOCUMENT } from '../engine/compile/context'
import { buildCartridge } from '../engine/export/cartridge'

const metadata = {
  title: 'Biology handout',
  author: 'Ada Instructor',
  sourceName: 'Biology Department',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

test('a real DOCX worker produces safe ordered semantics through the public file importer', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
  const file = new File([await semanticDocxFixture()], 'cells.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  const imported = await importStructuredDocument(file, { metadata })
  expect(fetchSpy).not.toHaveBeenCalled()
  fetchSpy.mockRestore()
  const doc = new DOMParser().parseFromString(imported.work.sections[0]!.html, 'text/html')

  expect(imported).toMatchObject({
    work: { title: 'Biology handout', format: 'docx', assets: [] },
    report: {
      parser: 'anydoc',
      format: 'docx',
      originalName: 'cells.docx',
      findings: [],
      counts: { sections: 1, headings: 1, tables: 1, images: 0 },
    },
  })
  expect([...doc.body.children].map((element) => element.tagName)).toEqual([
    'H1', 'P', 'P', 'UL', 'OL', 'TABLE',
  ])
  expect(doc.querySelector('h1')).toHaveTextContent('Cell Biology')
  expect(doc.querySelector('strong')).toHaveTextContent('Cells')
  expect(doc.querySelector('em')).toHaveTextContent('organized')
  expect(doc.querySelector('a')).toHaveAttribute('href', 'https://example.edu/cells')
  expect(doc.getElementById('cell-biology')).not.toBeNull()
  expect(doc.querySelector('a[href="#cell-biology"]')).toHaveTextContent('Return to Cell Biology')
  expect(doc.querySelector('ul')).toHaveTextContent('Membrane')
  expect(doc.querySelector('ul')).toHaveTextContent('Cytoplasm')
  expect(doc.querySelector('ol')).toHaveTextContent('Observe')
  expect(doc.querySelectorAll('thead th')).toHaveLength(2)
  expect(doc.querySelector('tbody')).toHaveTextContent('Nucleus')
  expect(doc.body).toHaveTextContent('<unsafe & literal>')
  expect(doc.querySelector('unsafe')).toBeNull()
})

test('content detection rejects a non-DOCX even when its name and MIME type claim DOCX', async () => {
  const renamedRtf = new File(
    [new TextEncoder().encode('{\\rtf1\\ansi This is RTF, not Word.}')],
    'renamed.docx',
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  )

  await expect(importStructuredDocument(renamedRtf, { metadata })).rejects.toThrow(/contents are rtf, not a DOCX/i)
})

test('a packageable embedded DOCX image becomes a cartridge reference, not a blocker', async () => {
  const file = new File([await semanticDocxFixture({ embeddedImage: true })], 'diagram.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  const imported = await importStructuredDocument(file, { metadata })

  expect(imported.report.counts.images).toBe(1)
  expect(imported.report.findings.some((finding) => finding.code === 'embedded-content')).toBe(false)
  expect(imported.work.sections[0]?.html).toContain('$IMS-CC-FILEBASE$/oer2canvas/')
  expect(imported.work.sections[0]?.html).not.toContain('[Embedded image')
})

test('an embedded DOCX image the workflow cannot package stays a visible blocking finding', async () => {
  const file = new File([await semanticDocxFixture({ unsupportedImage: true })], 'diagram.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  const imported = await importStructuredDocument(file, { metadata })

  expect(imported.report.counts.images).toBe(1)
  expect(imported.report.findings).toContainEqual(expect.objectContaining({
    code: 'embedded-content',
    severity: 'blocker',
    sectionId: imported.work.sections[0]?.id,
    message: expect.stringMatching(/cannot package|corrupt/i),
  }))
  expect(imported.work.sections[0]?.html).toContain('[Embedded image: Unsupported diagram]')
  expect(imported.work.assets).toEqual([])
})

test('a figure-only DOCX with no readable text still imports, not a hard failure', async () => {
  const file = new File([await imageOnlyDocxFixture()], 'cover.docx', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  const imported = await importStructuredDocument(file, { metadata })

  expect(imported.report.counts.images).toBe(1)
  expect(imported.report.findings.some((finding) => finding.code === 'embedded-content')).toBe(false)
  expect(imported.work.sections[0]?.html).toContain('$IMS-CC-FILEBASE$/oer2canvas/')
})

test('a DOCX parse can be cancelled at the public progress seam and retried cleanly', async () => {
  const bytes = await semanticDocxFixture()
  const controller = new AbortController()
  const cancelled = importStructuredDocument(new File([bytes], 'cancel.docx'), {
    metadata,
    signal: controller.signal,
    onProgress: (progress) => {
      if (progress.phase === 'parsing') controller.abort()
    },
  })

  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  await expect(importStructuredDocument(new File([bytes], 'retry.docx'), { metadata }))
    .resolves.toMatchObject({ report: { parser: 'anydoc', format: 'docx' } })
})

test('a text DOCX reaches the existing compile, audit, and cartridge seams without a format bypass', async () => {
  const imported = await importStructuredDocument(
    new File([await semanticDocxFixture()], 'workflow.docx'),
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
  const gateDocument = new DOMParser().parseFromString(gateHtml, 'text/html')
  const exported = buildCartridge([compiled]).find((entry) =>
    entry.name.startsWith('wiki_content/') && entry.name.endsWith('.html'))

  expect(gateHtml).toContain('Cell Biology')
  expect(gateDocument.querySelector('table')).not.toBeNull()
  expect(gateDocument.getElementById('cell-biology')).not.toBeNull()
  expect(gateDocument.querySelector('a[href="#cell-biology"]')).toHaveTextContent('Return to Cell Biology')
  expect(compiled.queue).toEqual([])
  expect(new TextDecoder().decode(exported?.data)).toContain(gateHtml)
})
