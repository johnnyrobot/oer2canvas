import type { ImportedFormat } from './types'
import type { ParserKind, ParserProbeOptions, ParserProbeResult } from './parsers/probe'

export type DocumentCapabilityStatus = 'enabled' | 'probe-only'

export interface DocumentFormatCapability {
  format: ImportedFormat
  label: string
  extensions: readonly `.${string}`[]
  mediaTypes: readonly string[]
  parser: 'native' | ParserKind
  status: DocumentCapabilityStatus
  limitations: readonly string[]
  /** Lazy by construction: importing the table does not import either Worker client. */
  probe?: (options: Omit<ParserProbeOptions, 'parser' | 'formatHint'>) => Promise<ParserProbeResult>
}

function parserProbe(parser: ParserKind, formatHint: string): NonNullable<DocumentFormatCapability['probe']> {
  return async (options) => {
    const { probeParser } = await import('./parsers/probe')
    return probeParser({ ...options, parser, formatHint })
  }
}

export const DOCUMENT_FORMAT_CAPABILITIES: readonly DocumentFormatCapability[] = [
  {
    format: 'text',
    label: 'Plain text',
    extensions: ['.txt'],
    mediaTypes: ['text/plain'],
    parser: 'native',
    status: 'enabled',
    limitations: ['Formatting beyond paragraphs and line breaks is not present in plain text.'],
  },
  {
    format: 'markdown',
    label: 'Markdown',
    extensions: ['.md', '.markdown'],
    mediaTypes: ['text/markdown', 'text/x-markdown'],
    parser: 'native',
    status: 'enabled',
    limitations: [
      'Raw HTML is reduced to the controlled HTML-import subset; images remain unavailable until asset packaging ships.',
    ],
  },
  {
    format: 'html',
    label: 'HTML',
    extensions: ['.html', '.htm'],
    mediaTypes: ['text/html', 'application/xhtml+xml'],
    parser: 'native',
    status: 'enabled',
    limitations: [
      'Scripts, active embeds, forms, source styling, unsafe URLs, and image requests are not imported.',
    ],
  },
  {
    format: 'docx',
    label: 'Word document',
    extensions: ['.docx'],
    mediaTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    parser: 'anydoc',
    status: 'enabled',
    limitations: ['Text boxes, complex pagination, and embedded content may require manual remediation.'],
    probe: parserProbe('anydoc', 'docx'),
  },
  {
    format: 'odt',
    label: 'OpenDocument text',
    extensions: ['.odt'],
    mediaTypes: ['application/vnd.oasis.opendocument.text'],
    parser: 'anydoc',
    status: 'enabled',
    limitations: ['Page styling and visual layout are not reproduced.'],
    probe: parserProbe('anydoc', 'odt'),
  },
  {
    format: 'rtf',
    label: 'Rich Text Format',
    extensions: ['.rtf'],
    mediaTypes: ['application/rtf', 'text/rtf'],
    parser: 'anydoc',
    status: 'enabled',
    limitations: ['Complex drawings and visual layout may be flattened.'],
    probe: parserProbe('anydoc', 'rtf'),
  },
  {
    format: 'epub',
    label: 'EPUB',
    extensions: ['.epub'],
    mediaTypes: ['application/epub+zip'],
    parser: 'anydoc',
    status: 'enabled',
    limitations: ['Source styling is discarded; embedded images block this text-oriented workflow.'],
    probe: parserProbe('anydoc', 'epub'),
  },
  {
    format: 'pdf',
    label: 'PDF',
    extensions: ['.pdf'],
    mediaTypes: ['application/pdf'],
    parser: 'pdf-inspector',
    status: 'enabled',
    limitations: [
      'Scanned pages have no text to import and block completion; this release does not run OCR in the browser.',
      'Figures are marked in place but not imported — add them in Canvas afterwards.',
      'Multi-column and table reading order needs review.',
    ],
    probe: parserProbe('pdf-inspector', 'pdf'),
  },
] as const

const plainText = DOCUMENT_FORMAT_CAPABILITIES.find((entry) => entry.format === 'text')!
export const PLAIN_TEXT_FILE_ACCEPT = [...plainText.extensions, ...plainText.mediaTypes].join(',')
export const TEXT_CONTENT_FILE_ACCEPT = DOCUMENT_FORMAT_CAPABILITIES
  .filter((entry) => entry.status === 'enabled' && entry.parser === 'native')
  .flatMap((entry) => [...entry.extensions, ...entry.mediaTypes])
  .join(',')
const docx = DOCUMENT_FORMAT_CAPABILITIES.find((entry) => entry.format === 'docx')!
export const DOCX_FILE_ACCEPT = [...docx.extensions, ...docx.mediaTypes].join(',')

export const ENABLED_ANYDOC_CAPABILITIES = DOCUMENT_FORMAT_CAPABILITIES.filter(
  (entry) => entry.status === 'enabled' && entry.parser === 'anydoc',
)
export const STRUCTURED_DOCUMENT_FILE_ACCEPT = ENABLED_ANYDOC_CAPABILITIES
  .flatMap((entry) => [...entry.extensions, ...entry.mediaTypes])
  .join(',')
const structuredDocumentExtensionLabels = ENABLED_ANYDOC_CAPABILITIES
  .flatMap((entry) => entry.extensions)
  .map((extension) => extension.slice(1).toUpperCase())
export const STRUCTURED_DOCUMENT_FORMAT_SUMMARY = [
  structuredDocumentExtensionLabels.slice(0, -1).join(', '),
  structuredDocumentExtensionLabels.at(-1),
].filter(Boolean).join(', or ')

/*
 * Every format the file picker offers: anydoc's four plus PDF. Separate from
 * `ENABLED_ANYDOC_CAPABILITIES` because that list answers a different question —
 * which formats `importStructuredDocument` itself handles — and its answer
 * appears in that function's refusal message, which must not offer PDF.
 */
export const IMPORTABLE_DOCUMENT_CAPABILITIES = DOCUMENT_FORMAT_CAPABILITIES.filter(
  (entry) => entry.status === 'enabled' && entry.parser !== 'native',
)
export const DOCUMENT_FILE_ACCEPT = IMPORTABLE_DOCUMENT_CAPABILITIES
  .flatMap((entry) => [...entry.extensions, ...entry.mediaTypes])
  .join(',')
const importableDocumentExtensionLabels = IMPORTABLE_DOCUMENT_CAPABILITIES
  .flatMap((entry) => entry.extensions)
  .map((extension) => extension.slice(1).toUpperCase())
export const DOCUMENT_FORMAT_SUMMARY = [
  importableDocumentExtensionLabels.slice(0, -1).join(', '),
  importableDocumentExtensionLabels.at(-1),
].filter(Boolean).join(', or ')

export function releaseEnabledFormats(): ImportedFormat[] {
  return DOCUMENT_FORMAT_CAPABILITIES
    .filter((entry) => entry.status === 'enabled')
    .map((entry) => entry.format)
}

export function capabilityForFilename(filename: string): DocumentFormatCapability | undefined {
  const lower = filename.toLowerCase()
  return DOCUMENT_FORMAT_CAPABILITIES.find((entry) =>
    entry.extensions.some((extension) => lower.endsWith(extension)))
}

export function capabilityForFormat(format: ImportedFormat): DocumentFormatCapability | undefined {
  return DOCUMENT_FORMAT_CAPABILITIES.find((entry) => entry.format === format)
}
