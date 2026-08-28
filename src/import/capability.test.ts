import {
  DOCUMENT_FORMAT_CAPABILITIES,
  PLAIN_TEXT_FILE_ACCEPT,
  capabilityForFilename,
  releaseEnabledFormats,
} from './capability'

test('one capability table distinguishes shipped formats from parser probes', () => {
  expect(releaseEnabledFormats()).toEqual(['text', 'docx'])
  expect(PLAIN_TEXT_FILE_ACCEPT).toBe('.txt,text/plain')
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
    .toHaveLength(4)
})
