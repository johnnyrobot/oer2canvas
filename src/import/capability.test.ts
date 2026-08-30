import {
  DOCUMENT_FILE_ACCEPT,
  DOCUMENT_FORMAT_CAPABILITIES,
  DOCUMENT_FORMAT_SUMMARY,
  PLAIN_TEXT_FILE_ACCEPT,
  TEXT_CONTENT_FILE_ACCEPT,
  STRUCTURED_DOCUMENT_FILE_ACCEPT,
  STRUCTURED_DOCUMENT_FORMAT_SUMMARY,
  capabilityForFilename,
  capabilityForFormat,
  releaseEnabledFormats,
} from './capability'

test('one capability table distinguishes shipped formats from parser probes', () => {
  expect(releaseEnabledFormats()).toEqual([
    'text', 'markdown', 'html', 'docx', 'odt', 'rtf', 'epub', 'pdf', 'pptx',
  ])
  // ODP is in the table but NOT in that list, and this is issue 14's verdict
  // rather than an unfinished state: see the long comment on the `odp` entry
  // in `capability.ts` for the measurement that decided it. Asserted here
  // because "a format the parser accepts is not thereby a format this release
  // ships" is the distinction this whole table exists to draw.
  expect(capabilityForFormat('odp')).toMatchObject({ parser: 'anydoc', status: 'probe-only' })
  expect(PLAIN_TEXT_FILE_ACCEPT).toBe('.txt,text/plain')
  expect(TEXT_CONTENT_FILE_ACCEPT).toBe(
    '.txt,text/plain,.md,.markdown,text/markdown,text/x-markdown,.html,.htm,text/html,application/xhtml+xml',
  )
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.docx')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.odt')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.rtf')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.epub')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.pptx')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.pptm')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.ppsx')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.ppsm')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).not.toContain('.odp')
  expect(STRUCTURED_DOCUMENT_FORMAT_SUMMARY).toBe('DOCX, ODT, RTF, EPUB, PPTX, PPTM, PPSX, or PPSM')
  expect(capabilityForFilename('chapter.DOCX')).toMatchObject({
    format: 'docx',
    parser: 'anydoc',
    status: 'enabled',
  })
  expect(capabilityForFilename('study.MARKDOWN')).toMatchObject({
    format: 'markdown',
    parser: 'native',
    status: 'enabled',
  })
  expect(capabilityForFilename('lesson.HTM')).toMatchObject({
    format: 'html',
    parser: 'native',
    status: 'enabled',
  })
  expect(capabilityForFilename('reading.pdf')).toMatchObject({
    format: 'pdf',
    parser: 'pdf-inspector',
    status: 'enabled',
  })
  expect(capabilityForFilename('archive.zip')).toBeUndefined()

  // ODP is the ONLY probe-only entry. Issue 13 could write "nothing is
  // probe-only any more" because PDF was the last one; issue 14 measured that
  // an Impress chart is lost with no finding and put ODP back, deliberately.
  // Pinning the exact set (not just a count) means a later engineer who flips
  // some OTHER format to probe-only, or who flips ODP to enabled without
  // reading why it is not, fails here.
  expect(DOCUMENT_FORMAT_CAPABILITIES.filter((entry) => entry.status === 'probe-only')
    .map((entry) => entry.format)).toEqual(['odp'])
})

test('pdf is offered, and the accept string is not filtered to anydoc parsers', () => {
  expect(DOCUMENT_FILE_ACCEPT).toContain('.pdf')
  expect(DOCUMENT_FILE_ACCEPT).toContain('application/pdf')
  expect(DOCUMENT_FORMAT_SUMMARY).toMatch(/PDF/)
  // The anydoc-only list stays anydoc-only; `document.ts`'s refusal message
  // must not offer a format it cannot import.
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).not.toContain('.pdf')
  expect(STRUCTURED_DOCUMENT_FORMAT_SUMMARY).not.toMatch(/PDF/)
})

test('the pdf limitation states the block/warn boundary a user is about to meet', () => {
  const pdf = capabilityForFormat('pdf')!
  expect(pdf.status).toBe('enabled')
  expect(pdf.limitations.join(' ')).toMatch(/scanned/i)
  expect(pdf.limitations.join(' ')).toMatch(/figure/i)
})
