import type { ImportedFormat } from './types'
import type { ParserKind, ParserProbeOptions, ParserProbeResult } from './parsers/probe'

export type DocumentCapabilityStatus = 'enabled' | 'probe-only'

export interface DocumentFormatCapability {
  format: ImportedFormat
  extensions: readonly `.${string}`[]
  mediaTypes: readonly string[]
  parser: 'native' | ParserKind
  status: DocumentCapabilityStatus
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
    extensions: ['.txt'],
    mediaTypes: ['text/plain'],
    parser: 'native',
    status: 'enabled',
  },
  {
    format: 'docx',
    extensions: ['.docx'],
    mediaTypes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    parser: 'anydoc',
    status: 'probe-only',
    probe: parserProbe('anydoc', 'docx'),
  },
  {
    format: 'odt',
    extensions: ['.odt'],
    mediaTypes: ['application/vnd.oasis.opendocument.text'],
    parser: 'anydoc',
    status: 'probe-only',
    probe: parserProbe('anydoc', 'odt'),
  },
  {
    format: 'rtf',
    extensions: ['.rtf'],
    mediaTypes: ['application/rtf', 'text/rtf'],
    parser: 'anydoc',
    status: 'probe-only',
    probe: parserProbe('anydoc', 'rtf'),
  },
  {
    format: 'epub',
    extensions: ['.epub'],
    mediaTypes: ['application/epub+zip'],
    parser: 'anydoc',
    status: 'probe-only',
    probe: parserProbe('anydoc', 'epub'),
  },
  {
    format: 'pdf',
    extensions: ['.pdf'],
    mediaTypes: ['application/pdf'],
    parser: 'pdf-inspector',
    status: 'probe-only',
    probe: parserProbe('pdf-inspector', 'pdf'),
  },
] as const

const plainText = DOCUMENT_FORMAT_CAPABILITIES.find((entry) => entry.format === 'text')!
export const PLAIN_TEXT_FILE_ACCEPT = [...plainText.extensions, ...plainText.mediaTypes].join(',')

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
