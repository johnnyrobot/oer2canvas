import type { ImportMetadata, ImportResult } from './types'
import type { ParserProbeProgress } from './parsers/probe'
import { DOCUMENT_IMPORT_LIMITS } from './limits'
import { documentIds, importProvenance, sha256Hex, validateImportMetadata } from './common'

export interface DocxImportOptions {
  metadata: ImportMetadata
  signal?: AbortSignal
  onProgress?: (progress: ParserProbeProgress) => void
}

export async function importDocx(file: File, options: DocxImportOptions): Promise<ImportResult> {
  options.signal?.throwIfAborted()
  validateImportMetadata(options.metadata)
  if (!file.name.toLowerCase().endsWith('.docx')) {
    throw new Error('Choose a Word document with a .docx extension.')
  }
  if (file.size > DOCUMENT_IMPORT_LIMITS.maximumInputBytes) {
    throw new Error('This DOCX exceeds the 16 MiB browser limit.')
  }

  const bytes = await file.arrayBuffer()
  options.signal?.throwIfAborted()
  const sourceSha256 = await sha256Hex(bytes)
  options.signal?.throwIfAborted()
  const { probeParser } = await import('./parsers/probe')
  options.signal?.throwIfAborted()
  const parsed = await probeParser({
    parser: 'anydoc',
    bytes,
    formatHint: 'docx',
    signal: options.signal,
    onProgress: options.onProgress,
  })
  if (parsed.formatDetection !== 'content' || parsed.detectedFormat !== 'docx') {
    throw new Error(
      `The file contents are ${parsed.detectedFormat || 'not recognized'}, not a DOCX document.`,
    )
  }
  if (!parsed.normalized) throw new Error('AnyDoc returned no normalized document content.')

  const title = options.metadata.title.trim()
  const { id, sectionId } = documentIds(sourceSha256)
  const findings = parsed.normalized.findings.map((finding) => ({ ...finding, sectionId }))

  return {
    work: {
      id,
      title,
      format: 'docx',
      sections: [{ id: sectionId, title, order: 0, html: parsed.normalized.html }],
      assets: [],
      provenance: importProvenance(options.metadata, { kind: 'local-file', originalName: file.name }),
    },
    report: {
      parser: 'anydoc',
      parserVersion: parsed.parserVersion,
      format: 'docx',
      originalName: file.name,
      originalBytes: parsed.inputBytes,
      sourceSha256,
      findings,
      counts: {
        sections: 1,
        headings: parsed.counts.headings,
        tables: parsed.counts.tables,
        images: parsed.counts.images,
        equations: parsed.normalized.equations,
        notes: parsed.normalized.notes,
        unavailableAssets: parsed.normalized.unavailableAssets,
      },
    },
  }
}
