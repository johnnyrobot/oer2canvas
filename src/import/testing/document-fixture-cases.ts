import { semanticDocxFixture } from './docx-fixture'
import {
  semanticEpubFixture,
  semanticOdtFixture,
  semanticRtfFixture,
} from './structured-document-fixtures'

export const DOCUMENT_FIXTURE_CASES = [
  {
    format: 'docx',
    fixture: semanticDocxFixture,
    mediaType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  { format: 'epub', fixture: semanticEpubFixture, mediaType: 'application/epub+zip' },
  {
    format: 'odt',
    fixture: semanticOdtFixture,
    mediaType: 'application/vnd.oasis.opendocument.text',
  },
  { format: 'rtf', fixture: semanticRtfFixture, mediaType: 'application/rtf' },
] as const

export const EPUB_ODT_RTF_FIXTURE_CASES = DOCUMENT_FIXTURE_CASES.filter(
  (entry) => entry.format !== 'docx',
)
