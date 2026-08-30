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
    'text', 'markdown', 'html', 'docx', 'odt', 'rtf', 'epub', 'pdf', 'pptx', 'odp',
  ])
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
  expect(STRUCTURED_DOCUMENT_FILE_ACCEPT).toContain('.odp')
  expect(STRUCTURED_DOCUMENT_FORMAT_SUMMARY).toBe('DOCX, ODT, RTF, EPUB, PPTX, PPTM, PPSX, PPSM, or ODP')
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

  // The EXACT probe-only set, pinned rather than counted, so a later engineer
  // who parks some format here has to say so in a diff that names it.
  //
  // The four spreadsheet formats are parked by issue 16's measurement, not by
  // nobody having got to them: `Table.headerRows` is a heuristic on the shape
  // of row 1, it came back 0 for 94 of 104 real `.xlsx` worksheets and 141 of
  // 141 real `.xls` ones, and the header answers that would fix those tables
  // are refused outright by `engine/compile/steps/tables.ts`. See
  // `spreadsheet-evidence.browser.test.ts`, which pins every fact behind that.
  // PDF sat here before issue 13 shipped it, and issue 14 came within one part
  // of putting ODP back.
  expect(DOCUMENT_FORMAT_CAPABILITIES.filter((entry) => entry.status === 'probe-only')
    .map((entry) => entry.format)).toEqual(['xlsx', 'xls', 'ods', 'csv'])
})

test('a probe-only spreadsheet is offered by no accept string and no summary', () => {
  // The entries exist to EXPLAIN a refusal, never to route a parse. Every
  // derived list in this module filters on `status === 'enabled'`, and this
  // asserts that rather than trusting it: a spreadsheet extension appearing in
  // a picker's `accept` would be the exact regression these entries could
  // otherwise introduce.
  for (const extension of ['.xlsx', '.xlsm', '.xls', '.ods', '.csv']) {
    expect(DOCUMENT_FILE_ACCEPT, extension).not.toContain(extension)
    expect(STRUCTURED_DOCUMENT_FILE_ACCEPT, extension).not.toContain(extension)
    expect(TEXT_CONTENT_FILE_ACCEPT, extension).not.toContain(extension)
  }
  expect(DOCUMENT_FORMAT_SUMMARY).not.toMatch(/XLSX|XLS|ODS|CSV/)
  expect(STRUCTURED_DOCUMENT_FORMAT_SUMMARY).not.toMatch(/XLSX|XLS|ODS|CSV/)
  expect(releaseEnabledFormats()).not.toContain('xlsx')

  // And each one says what would go wrong, in words an instructor can act on.
  for (const format of ['xlsx', 'xls', 'ods', 'csv'] as const) {
    const capability = capabilityForFormat(format)!
    expect(capability.status, format).toBe('probe-only')
    expect(capability.limitations[0], format).toMatch(/not imported in this release/)
  }
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
