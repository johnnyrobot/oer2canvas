import type { ImportMetadata, ImportResult } from './types'
import { capabilityForFilename } from './capability'
import { documentIds, importProvenance, parsePublicSourceUrl, sha256Hex, validateImportMetadata } from './common'
import { escapeHtml } from './html'
import { sanitizeImportedHtml, sanitizeImportedMarkdown } from './markup'
import type { ImportedFormat } from './types'

export type TextLikeFormat = Extract<ImportedFormat, 'text' | 'markdown' | 'html'>

export type TextImportInput =
  | { kind: 'paste'; text: string; format?: TextLikeFormat }
  | { kind: 'file'; file: File }

export interface TextImportOptions {
  metadata: ImportMetadata
  signal?: AbortSignal
}

// Text-like content runs on the main thread through hashing, normalization, and
// a live preview. Worker-parser measurements do not justify raising this path's
// independently conservative limit.
export const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024

function assertWithinLimit(bytes: number, format: TextLikeFormat): void {
  if (bytes > MAX_TEXT_IMPORT_BYTES) {
    const label = format === 'text' ? 'Plain-text' : format === 'markdown' ? 'Markdown' : 'HTML'
    throw new Error(`${label} imports must be 2 MiB or smaller.`)
  }
}

function semanticHtml(text: string): string {
  return text
    .trim()
    .split(/\n[\t ]*\n+/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('')
}

function formatOf(input: TextImportInput): TextLikeFormat {
  if (input.kind === 'paste') return input.format ?? 'text'
  const format = capabilityForFilename(input.file.name)?.format
  if (format === 'text' || format === 'markdown' || format === 'html') return format
  throw new Error(
    'Choose a text, Markdown, or HTML file with a .txt, .md, .markdown, .html, or .htm extension.',
  )
}

async function readUtf8(file: File): Promise<string> {
  const bytes = await file.arrayBuffer()
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error(`${file.name} does not contain valid UTF-8 text.`)
  }
}

export async function importText(
  input: TextImportInput,
  options: TextImportOptions,
): Promise<ImportResult> {
  options.signal?.throwIfAborted()
  validateImportMetadata(options.metadata)
  const title = options.metadata.title.trim()
  const format = formatOf(input)
  if (input.kind === 'file') {
    assertWithinLimit(input.file.size, format)
  }
  const text = input.kind === 'paste'
    ? input.text
    : await readUtf8(input.file)
  options.signal?.throwIfAborted()
  if (!text.trim()) throw new Error('Add some content before creating the preview.')
  const bytes = new TextEncoder().encode(text)
  assertWithinLimit(bytes.byteLength, format)
  const sourceSha256 = await sha256Hex(bytes)
  options.signal?.throwIfAborted()

  const { id, sectionId } = documentIds(sourceSha256)
  const provenance = importProvenance(options.metadata, input.kind === 'paste'
    ? { kind: 'paste' }
    : { kind: 'local-file', originalName: input.file.name })
  const baseUrl = parsePublicSourceUrl(options.metadata.sourceUrl)
  const normalized = format === 'text'
    ? {
        html: semanticHtml(text),
        findings: [],
        counts: {
          headings: 0,
          tables: 0,
          images: 0,
          equations: [...text.matchAll(/\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]/g)].length,
          notes: 0,
          unavailableAssets: 0,
        },
      }
    : (format === 'markdown' ? sanitizeImportedMarkdown : sanitizeImportedHtml)(text, {
        ...(baseUrl ? { publicBaseUrl: baseUrl } : {}),
      })

  return {
    work: {
      id,
      title,
      format,
      sections: [{ id: sectionId, title, order: 0, html: normalized.html }],
      assets: [],
      provenance,
    },
    report: {
      parser: 'native',
      format,
      ...(input.kind === 'file' ? { originalName: input.file.name } : {}),
      originalBytes: bytes.byteLength,
      sourceSha256,
      findings: normalized.findings,
      counts: {
        sections: 1,
        ...normalized.counts,
      },
    },
  }
}
