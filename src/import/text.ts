import type { ImportMetadata, ImportResult } from './types'

export type TextImportInput =
  | { kind: 'paste'; text: string }
  | { kind: 'file'; file: File }

export interface TextImportOptions {
  metadata: ImportMetadata
  signal?: AbortSignal
}

export const PLAIN_TEXT_FILE_ACCEPT = '.txt,text/plain'

// A conservative tracer guard required by ticket 01. Ticket 02 replaces this
// with the benchmark-selected production budget before document import ships.
export const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024

function assertWithinLimit(bytes: number): void {
  if (bytes > MAX_TEXT_IMPORT_BYTES) {
    throw new Error('Plain-text imports must be 2 MiB or smaller.')
  }
}

function escapeText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function semanticHtml(text: string): string {
  return text
    .trim()
    .split(/\n[\t ]*\n+/)
    .map((paragraph) => `<p>${paragraph.split('\n').map(escapeText).join('<br>')}</p>`)
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

async function sha256(bytes: Uint8Array): Promise<string> {
  const owned = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(owned).set(bytes)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', owned)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function importText(
  input: TextImportInput,
  options: TextImportOptions,
): Promise<ImportResult> {
  options.signal?.throwIfAborted()
  const title = options.metadata.title.trim()
  if (!title) throw new Error('Enter a document title before creating the preview.')
  if (!['own', 'permission', 'public-domain', 'open-license'].includes(options.metadata.rightsAuthority)) {
    throw new Error('Choose why you have permission to republish this content.')
  }
  if (!options.metadata.rightsAcknowledged) {
    throw new Error('Confirm responsibility for rights and the final accessibility review.')
  }
  const licenseName = options.metadata.licenseName?.trim()
  const licenseUrl = options.metadata.licenseUrl?.trim()
  if (licenseUrl && !licenseName) {
    throw new Error('Enter a license name when you provide a license URL.')
  }
  if (input.kind === 'file') {
    if (!/\.txt$/i.test(input.file.name)) {
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
  const sourceSha256 = await sha256(bytes)
  options.signal?.throwIfAborted()

  const id = `document-${sourceSha256.slice(0, 24)}`
  const sectionId = `${id}-page-1`
  const license = licenseName
    ? {
        name: licenseName,
        ...(licenseUrl ? { url: licenseUrl } : {}),
      }
    : undefined
  const provenance = {
    kind: input.kind === 'paste' ? 'paste' as const : 'local-file' as const,
    ...(input.kind === 'file' ? { originalName: input.file.name } : {}),
    ...(options.metadata.author ? { author: options.metadata.author } : {}),
    ...(options.metadata.sourceName ? { sourceName: options.metadata.sourceName } : {}),
    ...(options.metadata.sourceUrl ? { sourceUrl: options.metadata.sourceUrl } : {}),
    ...(license ? { license } : {}),
    rights: {
      authority: options.metadata.rightsAuthority,
      acknowledged: options.metadata.rightsAcknowledged,
    },
  }

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
