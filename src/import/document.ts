import type { ImportMetadata, ImportResult } from './types'
import type { ParserProbeProgress } from './parsers/probe'
import { DOCUMENT_IMPORT_LIMITS } from './limits'
import { documentIds, importProvenance, sha256Hex, validateImportMetadata } from './common'
import {
  ENABLED_ANYDOC_CAPABILITIES,
  capabilityForFilename,
  type DocumentFormatCapability,
} from './capability'

export interface StructuredDocumentImportOptions {
  metadata: ImportMetadata
  signal?: AbortSignal
  onProgress?: (progress: ParserProbeProgress) => void
}

function enabledCapabilityFor(file: File): DocumentFormatCapability {
  const capability = capabilityForFilename(file.name)
  if (!capability || capability.status !== 'enabled' || capability.parser !== 'anydoc') {
    const extensions = ENABLED_ANYDOC_CAPABILITIES.flatMap((entry) => entry.extensions).join(', ')
    throw new Error(`Choose a supported document file (${extensions}).`)
  }
  return capability
}

export async function importStructuredDocument(
  file: File,
  options: StructuredDocumentImportOptions,
): Promise<ImportResult> {
  options.signal?.throwIfAborted()
  validateImportMetadata(options.metadata)
  const capability = enabledCapabilityFor(file)
  if (file.size > DOCUMENT_IMPORT_LIMITS.maximumInputBytes) {
    throw new Error(`This ${capability.label} exceeds the 16 MiB browser limit.`)
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
    formatHint: capability.format,
    signal: options.signal,
    onProgress: options.onProgress,
  })
  if (parsed.formatDetection !== 'content' || parsed.detectedFormat !== capability.format) {
    const detected = parsed.formatDetection === 'content'
      ? parsed.detectedFormat.toUpperCase()
      : 'not recognized'
    const article = /^[aeiou]/i.test(capability.format) ? 'an' : 'a'
    throw new Error(
      `The file contents are ${detected}, not ${article} ${capability.format.toUpperCase()} document.`,
    )
  }
  if (!parsed.normalized) throw new Error('AnyDoc returned no normalized document content.')
  const visibleText = parsed.normalized.html.replace(/<[^>]*>/g, '').trim()
  // A figure-only document (a cover page, a plate section) now normalizes to
  // something like `<p><img ...></p>` with no visible TEXT at all, since a
  // packageable image no longer leaves an `[Embedded image: ...]` text
  // placeholder behind. This guard used to be safe assuming every image left
  // text; it is not safe to assume that anymore, so it must also check for
  // real rendered media (`<img>`/`<hr>`) before declaring the document
  // empty — mirroring the identical check the sibling HTML/Markdown importer
  // already applies (`markup.ts`'s `!textContent?.trim() && !querySelector('img, hr')`).
  if (!visibleText) {
    const rendered = new DOMParser().parseFromString(parsed.normalized.html, 'text/html')
    if (!rendered.querySelector('img, hr')) {
      throw new Error(`AnyDoc found no readable structured content in this ${capability.label} file.`)
    }
  }

  const title = options.metadata.title.trim()
  const { id, sectionId } = documentIds(sourceSha256)
  const findings = parsed.normalized.findings.map((finding) => ({ ...finding, sectionId }))

  return {
    work: {
      id,
      title,
      format: capability.format,
      sections: [{ id: sectionId, title, order: 0, html: parsed.normalized.html }],
      assets: [],
      provenance: importProvenance(options.metadata, { kind: 'local-file', originalName: file.name }),
    },
    report: {
      parser: 'anydoc',
      parserVersion: parsed.parserVersion,
      format: capability.format,
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
