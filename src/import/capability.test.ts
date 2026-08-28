import {
  DOCUMENT_FORMAT_CAPABILITIES,
  PLAIN_TEXT_FILE_ACCEPT,
  STRUCTURED_DOCUMENT_FILE_ACCEPT,
  STRUCTURED_DOCUMENT_FORMAT_SUMMARY,
  capabilityForFilename,
  releaseEnabledFormats,
} from './capability'

test('one capability table distinguishes shipped formats from parser probes', () => {
  expect(releaseEnabledFormats()).toEqual(['text', 'docx', 'odt', 'rtf', 'epub'])
  expect(PLAIN_TEXT_FILE_ACCEPT).toBe('.txt,text/plain')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.docx')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.odt')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.rtf')
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.epub')
  expect(STRUCTURED_DOCUMENT_FORMAT_SUMMARY).toBe('DOCX, ODT, RTF, or EPUB')
  expect(capabilityForFilename('chapter.DOCX')).toMatchObject({
    format: 'docx',
    parser: 'anydoc',
    status: 'enabled',
  })
  expect(capabilityForFilename('reading.pdf')).toMatchObject({
    format: 'pdf',
    parser: 'pdf-inspector',
    status: 'probe-only',
  })
  expect(capabilityForFilename('archive.zip')).toBeUndefined()

  expect(DOCUMENT_FORMAT_CAPABILITIES.filter((entry) => entry.status === 'probe-only'))
    .toHaveLength(1)
})
