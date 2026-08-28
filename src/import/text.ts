import type { ImportMetadata, ImportResult } from './types'
import { capabilityForFilename } from './capability'
import { documentIds, importProvenance, sha256Hex, validateImportMetadata } from './common'
import { escapeHtml } from './html'

export type TextImportInput =
  | { kind: 'paste'; text: string }
  | { kind: 'file'; file: File }

export interface TextImportOptions {
  metadata: ImportMetadata
  signal?: AbortSignal
}

// Plain text runs on the main thread through hashing, HTML formation, and a
// live preview. Worker-parser measurements do not justify raising this tracer's
// independently conservative limit.
export const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024

function assertWithinLimit(bytes: number): void {
  if (bytes > MAX_TEXT_IMPORT_BYTES) {
    throw new Error('Plain-text imports must be 2 MiB or smaller.')
  }
}

function semanticHtml(text: string): string {
  return text
    .trim()
    .split(/\n[\t ]*\n+/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeHtml).join('<br>')}</p>`)
    .join('')
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
  if (input.kind === 'file') {
    if (capabilityForFilename(input.file.name)?.format !== 'text') {
      throw new Error('Choose a plain-text file with a .txt extension.')
    }
    assertWithinLimit(input.file.size)
  }
  const text = input.kind === 'paste'
    ? input.text
    : await readUtf8(input.file)
  options.signal?.throwIfAborted()
  if (!text.trim()) throw new Error('Add some text before creating the preview.')
  const bytes = new TextEncoder().encode(text)
  assertWithinLimit(bytes.byteLength)
  const sourceSha256 = await sha256Hex(bytes)
  options.signal?.throwIfAborted()

  const { id, sectionId } = documentIds(sourceSha256)
  const provenance = importProvenance(options.metadata, input.kind === 'paste'
    ? { kind: 'paste' }
    : { kind: 'local-file', originalName: input.file.name })

  return {
    work: {
      id,
      title,
      format: 'text',
      sections: [{ id: sectionId, title, order: 0, html: semanticHtml(text) }],
      assets: [],
      provenance,
    },
    report: {
      parser: 'native',
      format: 'text',
      ...(input.kind === 'file' ? { originalName: input.file.name } : {}),
      originalBytes: bytes.byteLength,
      sourceSha256,
      findings: [],
      counts: {
        sections: 1,
        headings: 0,
        tables: 0,
        images: 0,
        equations: 0,
        notes: 0,
        unavailableAssets: 0,
      },
    },
  }
}
