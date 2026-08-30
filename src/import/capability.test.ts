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

  // The two legacy OLE2 formats are probe-only, and nothing else is. PDF was
  // the last one before issue 13 shipped it, and issue 14 came within one part
  // of putting ODP back here: it failed the bar's "name every construct design
  // fact 6 lists" criterion until the index learned to read
  // `META-INF/manifest.xml`. The EXACT set is pinned rather than a count, so a
  // later engineer who parks some format here has to say so in a diff that
  // names it — issue 15 is that diff for `doc` and `ppt`.
  expect(DOCUMENT_FORMAT_CAPABILITIES.filter((entry) => entry.status === 'probe-only')
    .map((entry) => entry.format)).toEqual(['doc', 'ppt'])
})

test('a parked legacy format is known by name and offered nowhere', () => {
  /*
   * The whole point of parking `doc`/`ppt` in the table rather than leaving
   * them out of it: a user who holds one gets told what it is and what to do,
   * while every list that means "supported" stays exactly as it was. If a
   * later change flips either `status` to 'enabled', `releaseEnabledFormats()`
   * grows and `released-sources.test.ts`'s reconciliation fails — which is the
   * safety net that makes parking them here cheap.
   */
  for (const [name, format, replacement] of [
    ['lecture.DOC', 'doc', '.docx'],
    ['deck.PPT', 'ppt', '.pptx'],
    ['slideshow.pps', 'ppt', '.pptx'],
    ['template.POT', 'ppt', '.pptx'],
  ] as const) {
    const capability = capabilityForFilename(name)
    expect(capability?.format, name).toBe(format)
    expect(capability?.status, name).toBe('probe-only')
    // The first limitation is what `DocumentImporter.tsx` shows under the file
    // input, so it has to name the way out rather than only the refusal.
    expect(capability!.limitations[0]).toContain(replacement)
    expect(capability!.probe, 'a parked format must not offer a parser path').toBeUndefined()
  }

  /*
   * Compared as WHOLE comma-separated tokens, not as substrings: `.docx`
   * contains `.doc`, `.pptx` contains `.ppt`, and
   * `application/vnd.ms-powerpoint.presentation.macroEnabled.12` contains
   * `application/vnd.ms-powerpoint`. A substring assertion here would fail on
   * the formats that ARE released and prove nothing about the ones that are
   * not.
   */
  const parked = ['.doc', '.ppt', '.pps', '.pot', 'application/msword', 'application/vnd.ms-powerpoint']
  for (const accept of [DOCUMENT_FILE_ACCEPT, STRUCTURED_DOCUMENT_FILE_ACCEPT]) {
    const offered = new Set(accept.split(','))
    for (const token of parked) expect(offered.has(token), `${token} is offered`).toBe(false)
  }
  // `DOCX`/`PPTX` legitimately contain `DOC`/`PPT` as substrings, so the
  // summaries are checked for the standalone words a user would read.
  expect(DOCUMENT_FORMAT_SUMMARY).not.toMatch(/\bDOC\b|\bPPT\b|\bPPS\b|\bPOT\b/)
  expect(STRUCTURED_DOCUMENT_FORMAT_SUMMARY).not.toMatch(/\bDOC\b|\bPPT\b|\bPPS\b|\bPOT\b/)
  expect(releaseEnabledFormats()).not.toContain('doc')
  expect(releaseEnabledFormats()).not.toContain('ppt')
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
