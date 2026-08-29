import type { ImportMetadata, ImportReport, ImportResult } from './types'
import { capabilityForFilename } from './capability'
import { documentIds, importProvenance, parsePublicSourceUrl, sha256Hex, validateImportMetadata } from './common'
import { escapeHtml } from './html'
import {
  countDelimitedEquationsInText,
  sanitizeImportedHtml,
  sanitizeImportedMarkdown,
} from './markup'
import type { ImportedFormat } from './types'

export type TextLikeFormat = Extract<ImportedFormat, 'text' | 'markdown' | 'html'>

export type TextImportInput =
  | { kind: 'paste'; text: string; format?: TextLikeFormat }
  | { kind: 'file'; file: File }
  /*
   * A web article, already extracted to Markdown by a `WebArticleFetcher`.
   *
   * `parser` is supplied by the fetcher rather than hardcoded here, because
   * `importText` must not name a vendor: the public build's fetcher is
   * Firecrawl, and a self-hosted build's would be something else (see
   * `web.ts`'s seam note). `sourceUrl` is the POST-REDIRECT url that was
   * actually extracted — the same one provenance is built from, passed
   * explicitly so relative-link resolution and provenance cannot drift apart.
   */
  | { kind: 'web'; text: string; parser: ImportReport['parser']; sourceUrl: URL }

export interface TextImportOptions {
  metadata: ImportMetadata
  signal?: AbortSignal
}

// Text-like content runs on the main thread through hashing, normalization, and
// a live preview. Worker-parser measurements do not justify raising this path's
// independently conservative limit.
export const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024

/** Name the thing the user actually did, not the format it normalizes as. */
function limitLabel(input: TextImportInput, format: TextLikeFormat): string {
  if (input.kind === 'web') return 'Imported web article'
  return format === 'text' ? 'Plain-text' : format === 'markdown' ? 'Markdown' : 'HTML'
}

function assertWithinLimit(bytes: number, label: string): void {
  if (bytes > MAX_TEXT_IMPORT_BYTES) {
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
  // A fetched article IS Markdown, and reaches `sanitizeImportedMarkdown` for
  // that reason. What it is recorded AS is a separate question — see
  // `recordedFormat` below.
  if (input.kind === 'web') return 'markdown'
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
  /*
   * What it IS, versus how it is normalized. A web import is normalized as
   * Markdown and recorded as `web`; conflating the two would lose the fact that
   * the bytes came off the network in `report.format`, which is the field the
   * plan editor and the cartridge attribute the import from.
   */
  const recordedFormat: ImportedFormat = input.kind === 'web' ? 'web' : format
  const label = limitLabel(input, format)
  if (input.kind === 'file') {
    assertWithinLimit(input.file.size, label)
  }
  const text = input.kind === 'file' ? await readUtf8(input.file) : input.text
  options.signal?.throwIfAborted()
  if (!text.trim()) throw new Error('Add some content before creating the preview.')
  const bytes = new TextEncoder().encode(text)
  assertWithinLimit(bytes.byteLength, label)
  const sourceSha256 = await sha256Hex(bytes)
  options.signal?.throwIfAborted()

  const { id, sectionId } = documentIds(sourceSha256)
  const provenance = importProvenance(options.metadata,
    input.kind === 'paste' ? { kind: 'paste' }
      : input.kind === 'web' ? { kind: 'web' }
        : { kind: 'local-file', originalName: input.file.name })
  const baseUrl = parsePublicSourceUrl(options.metadata.sourceUrl)
  if (input.kind === 'web' && baseUrl?.href !== input.sourceUrl.href) {
    /*
     * A programmer error, not a user error, and worth failing on. The whole
     * point of passing the URL twice is that provenance (built from
     * `metadata.sourceUrl`) and relative-link resolution (built from
     * `publicBaseUrl`) describe the SAME page. `importWebArticle` sets both from
     * one `URL` object; this is what makes "cannot drift" a checked claim rather
     * than a comment.
     */
    throw new Error('A web import must record the source URL it was extracted from.')
  }
  const normalized = format === 'text'
    ? {
        html: semanticHtml(text),
        findings: [],
        counts: {
          headings: 0,
          tables: 0,
          images: 0,
          equations: countDelimitedEquationsInText(text),
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
      format: recordedFormat,
      sections: [{ id: sectionId, title, order: 0, html: normalized.html }],
      assets: [],
      provenance,
    },
    report: {
      parser: input.kind === 'web' ? input.parser : 'native',
      format: recordedFormat,
      ...(input.kind === 'file' ? { originalName: input.file.name } : {}),
      ...(input.kind === 'web' ? { sourceUrl: input.sourceUrl.href } : {}),
      originalBytes: bytes.byteLength,
      sourceSha256,
      findings: normalized.findings,
      counts: {
        sections: 1,
        ...normalized.counts,
        // Text-like imports never package assets (`work.assets` is always
        // `[]` above), so there is nothing to total against the budget.
        //
        // AFTER the spread, not before. `normalized.counts` is produced by the
        // sanitizers and is not statically known to omit this key; ahead of the
        // spread, a future sanitizer that started reporting a byte total would
        // silently overwrite the zero this line exists to guarantee. Last write
        // wins, so this is the position that makes the comment above true.
        packagedAssetBytes: 0,
      },
    },
  }
}
