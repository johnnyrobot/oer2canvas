import type { Block, Document, Inline } from '@firecrawl/anydoc-wasm'
import type { AssetRejection, PreparedAsset } from '../assets'
import type { PackagedAssetRecord, ParserProbeFinding, ParserProbeNormalizedContent } from './probe'
import { escapeHtml } from '../html'

export class UnsupportedAnyDocVersionError extends Error {
  readonly code = 'unsupported-version'

  constructor(kind: unknown) {
    super(`AnyDoc returned an unsupported document-model kind: ${String(kind || 'unknown')}.`)
    this.name = 'UnsupportedAnyDocVersionError'
  }
}

function unsupportedKind(value: unknown): never {
  const candidate = value as { kind?: unknown }
  throw new UnsupportedAnyDocVersionError(candidate?.kind)
}

function safeHref(value: string): string | undefined {
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol) ? url.toString() : undefined
  } catch {
    return undefined
  }
}

function anchorSlug(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}_.:-]+/gu, '-')
    .replace(/^-+|-+$/g, '') || 'document-anchor'
}

export function normalizeAnyDocDocument(
  document: Document,
  sourceFormat = 'document',
  // Omitted (the default empty map) means "treat every asset as unpackaged",
  // which is exactly today's behaviour for callers that have not been
  // updated to prepare assets first — so this parameter can be added without
  // breaking any existing caller's meaning.
  prepared: ReadonlyMap<number, PreparedAsset | { rejected: AssetRejection }> = new Map(),
): ParserProbeNormalizedContent {
  const sourceLabel = sourceFormat === 'document' ? 'document' : sourceFormat.toUpperCase()
  const findings: ParserProbeFinding[] = []
  const anchorIds = new Map<string, string>()
  const usedIds = new Set<string>()
  const emittedIds = new Set<string>()
  let equations = 0
  let unavailableAssets = 0
  // Keyed by content hash so two inline images pointing at byte-identical
  // assets (already deduped by `prepareAssets`) collapse to one archive
  // entry here too, rather than the parser re-fragmenting what asset
  // preparation just unified.
  const packaged = new Map<string, PackagedAssetRecord>()

  // Exactly the four media types `prepareAssets` can ever produce a
  // `PreparedAsset` for. There is no `undecodable` entry: the byte sniffer
  // cannot tell "not a raster" from "a truncated header of a real format",
  // so that variant is unreachable and was removed rather than kept as dead
  // weight in this table (see assets.ts `AssetRejection`). The
  // `unsupported-type` wording below therefore has to honestly cover both
  // an unrecognized format and a corrupt file of a real one.
  const BLOCKED_REASON: Record<AssetRejection, string> = {
    unavailable: 'an image whose bytes are missing or unreadable',
    'unsupported-type': 'an image in a format this workflow cannot package, or whose file is corrupt',
    'too-large': 'an image larger than the packaging budget',
    'too-many': 'more images than the packaging budget allows',
  }

  const finding = (code: string, severity: 'warning' | 'blocker', message: string) => {
    if (!findings.some((entry) => entry.code === code)) findings.push({ code, severity, message })
  }

  const registerAnchor = (value: string | undefined) => {
    if (!value || anchorIds.has(value)) return
    const base = anchorSlug(value)
    let id = base
    let suffix = 2
    while (usedIds.has(id)) id = `${base}-${suffix++}`
    anchorIds.set(value, id)
    usedIds.add(id)
  }

  const visitInlines = (inlines: readonly Inline[] | undefined) => {
    for (const inline of inlines ?? []) {
      if (inline.kind === 'anchor') registerAnchor(inline.anchor)
      visitInlines(inline.content)
    }
  }
  const visitBlocks = (blocks: readonly Block[]) => {
    for (const block of blocks) {
      if (block.kind === 'heading') registerAnchor(block.anchor)
      visitInlines(block.content)
      visitBlocks(block.blocks ?? [])
      for (const item of block.list?.items ?? []) visitBlocks(item.blocks)
      for (const row of block.table?.grid ?? []) {
        for (const slot of row) visitBlocks(slot.cell?.blocks ?? [])
      }
    }
  }
  visitBlocks(document.blocks)

  const anchorAttribute = (value: string | undefined): string => {
    if (!value) return ''
    const id = anchorIds.get(value)
    if (!id || emittedIds.has(id)) {
      if (id) finding('duplicate-anchor', 'warning', 'A repeated internal link target was kept only once.')
      return ''
    }
    emittedIds.add(id)
    return ` id="${escapeHtml(id)}"`
  }

  const renderInlines = (inlines: readonly Inline[] | undefined): string => (inlines ?? []).map((inline) => {
    if (inline.kind === 'text') {
      let html = escapeHtml(inline.text ?? '')
      if (inline.style?.code) html = `<code>${html}</code>`
      if (inline.style?.bold) html = `<strong>${html}</strong>`
      if (inline.style?.italic) html = `<em>${html}</em>`
      if (inline.style?.strike) html = `<del>${html}</del>`
      return html
    }
    if (inline.kind === 'link') {
      const label = renderInlines(inline.content)
      const href = inline.target?.kind === 'anchor'
        ? anchorIds.get(inline.target.value)
        : inline.target?.kind === 'external'
          ? safeHref(inline.target.value)
          : undefined
      if (!href) {
        finding(
          'unresolved-link',
          'warning',
          'A relative, unsafe, or unresolved link could not be preserved; its visible text remains.',
        )
        return label
      }
      const target = inline.target?.kind === 'anchor' ? `#${href}` : href
      return `<a href="${escapeHtml(target)}">${label}</a>`
    }
    if (inline.kind === 'lineBreak') return '<br>'
    if (inline.kind === 'anchor') {
      const attribute = anchorAttribute(inline.anchor)
      return attribute ? `<span${attribute}></span>` : ''
    }
    if (inline.kind === 'image') {
      const alt = inline.alt ?? ''
      // External images stay remote http(s)/mailto URLs: they are not embedded
      // bytes at all, so there is nothing here for `prepareAssets` to have seen
      // and nothing to package into the cartridge.
      if (inline.source?.kind === 'external' && inline.source.url) {
        const href = safeHref(inline.source.url)
        if (href) return `<img src="${escapeHtml(href)}" alt="${escapeHtml(alt)}">`
      }

      const entry = inline.source?.kind === 'asset' && inline.source.assetId !== undefined
        ? prepared.get(inline.source.assetId)
        : undefined

      if (entry && !('rejected' in entry)) {
        // Dedupe by content hash: identical bytes become one archive entry,
        // which issue 07 measured Canvas resolving to a single shared File.
        // `name` is carried through as-is from `PreparedAsset` — it was
        // already decided once, by content hash with first-seen origin
        // winning, and recomputing it here from this call's `originPart`
        // would disagree with a shared-hash asset seen under a different
        // origin first.
        if (!packaged.has(entry.sha256)) {
          packaged.set(entry.sha256, {
            sha256: entry.sha256,
            name: entry.name,
            archivePath: entry.archivePath,
            mediaType: entry.mediaType,
            extension: entry.extension,
            bytes: entry.bytes,
            originPart: entry.originPart,
          })
        }
        return (
          `<img src="${escapeHtml(entry.reference)}" alt="${escapeHtml(alt)}"` +
          ` width="${entry.width}" height="${entry.height}">`
        )
      }

      // Anything that reaches here cannot be packaged: the bytes were never
      // available, or `prepareAssets` rejected them. Either way this image
      // keeps blocking publication AND keeps a visible placeholder — nothing
      // may disappear silently.
      if (inline.source?.kind === 'unavailable') unavailableAssets += 1
      const reason = entry && 'rejected' in entry
        ? BLOCKED_REASON[entry.rejected]
        : BLOCKED_REASON.unavailable
      finding(
        'embedded-content',
        'blocker',
        `This ${sourceLabel} contains ${reason}. Remove or replace it before publishing.`,
      )
      return `<span>[Embedded image${alt ? `: ${escapeHtml(alt)}` : ''}]</span>`
    }
    if (inline.kind === 'math') {
      equations += 1
      finding('unsupported-equation', 'blocker', `This ${sourceLabel} contains an equation that requires a later remediation workflow.`)
      return `<span>[Equation: ${escapeHtml(inline.text ?? '')}]</span>`
    }
    if (inline.kind === 'noteRef') {
      finding('unsupported-note', 'blocker', `This ${sourceLabel} contains notes that the text-oriented workflow cannot publish yet.`)
      return '<span>[Note reference]</span>'
    }
    if (inline.kind === 'checkbox') {
      finding('flattened-checkbox', 'warning', 'A checkbox was converted to visible text.')
      return inline.checked ? '[checked]' : '[not checked]'
    }
    return unsupportedKind(inline)
  }).join('')

  const renderBlocks = (blocks: readonly Block[]): string => blocks.map((block) => {
    if (block.kind === 'heading') {
      const level = Math.min(6, Math.max(1, block.level ?? 2))
      return `<h${level}${anchorAttribute(block.anchor)}>${renderInlines(block.content)}</h${level}>`
    }
    if (block.kind === 'paragraph') return `<p>${renderInlines(block.content)}</p>`
    if (block.kind === 'blockQuote') return `<blockquote>${renderBlocks(block.blocks ?? [])}</blockquote>`
    if (block.kind === 'codeBlock') return `<pre><code>${escapeHtml(block.text ?? '')}</code></pre>`
    if (block.kind === 'rule') return '<hr>'
    if (block.kind === 'math') {
      equations += 1
      finding('unsupported-equation', 'blocker', `This ${sourceLabel} contains an equation that requires a later remediation workflow.`)
      return `<p>[Equation: ${escapeHtml(block.text ?? '')}]</p>`
    }
    if (block.kind === 'list' && block.list) {
      const ordered = block.list.marker !== 'bullet'
      const tag = ordered ? 'ol' : 'ul'
      const start = ordered && block.list.start !== 1 ? ` start="${block.list.start}"` : ''
      const type = block.list.marker === 'lowerAlpha'
        ? 'a'
        : block.list.marker === 'upperAlpha'
          ? 'A'
          : block.list.marker === 'lowerRoman'
            ? 'i'
            : block.list.marker === 'upperRoman'
              ? 'I'
              : undefined
      const markerType = type ? ` type="${type}"` : ''
      const items = block.list.items.map((item) => {
        const literalMarker = item.markerLabel
          ? `<span>${escapeHtml(item.markerLabel)} </span>`
          : ''
        const suppressNativeMarker = item.markerLabel ? ' style="list-style-type: none"' : ''
        return `<li${suppressNativeMarker}>${literalMarker}${renderBlocks(item.blocks)}</li>`
      }).join('')
      return `<${tag}${start}${markerType}>${items}</${tag}>`
    }
    if (block.kind === 'table' && block.table) {
      if (block.table.kind === 'layout') {
        finding(
          'layout-table',
          'warning',
          'A layout table was linearized so it is not mislabeled as an accessible data table.',
        )
        return block.table.grid.flatMap((row) => row
          .filter((slot) => slot.kind === 'origin' && slot.cell)
          .map((slot) => renderBlocks(slot.cell!.blocks))).join('')
      }
      const rows = block.table.grid.map((row, rowIndex) => {
        const cells = row.map((slot) => {
          if (slot.kind === 'covered' || !slot.cell) return ''
          const tag = rowIndex < block.table!.headerRows ? 'th' : 'td'
          const scope = tag === 'th' ? ' scope="col"' : ''
          const colspan = slot.cell.colSpan > 1 ? ` colspan="${slot.cell.colSpan}"` : ''
          const rowspan = slot.cell.rowSpan > 1 ? ` rowspan="${slot.cell.rowSpan}"` : ''
          return `<${tag}${scope}${colspan}${rowspan}>${renderBlocks(slot.cell.blocks)}</${tag}>`
        }).join('')
        return `<tr>${cells}</tr>`
      })
      const headerRows = block.table.headerRows
      const head = headerRows > 0 ? `<thead>${rows.slice(0, headerRows).join('')}</thead>` : ''
      const body = `<tbody>${rows.slice(headerRows).join('')}</tbody>`
      return `<table>${head}${body}</table>`
    }
    return unsupportedKind(block)
  }).join('')

  // Rendering populates `packaged`, `findings`, and the `equations`/
  // `unavailableAssets` counters as a side effect of walking the document, so
  // it must run to completion before the result object below reads any of
  // them. The previous version of this function returned an object literal
  // that called `renderBlocks(document.blocks)` inline as the `html` property
  // while other properties in that SAME literal (`findings`, counters) read
  // state that render mutates — correct only because of JS's left-to-right
  // object-literal evaluation order. Hoisting the call into its own `const`
  // makes the dependency explicit instead of leaving it as a property-order
  // trap for the next person editing this literal.
  const html = renderBlocks(document.blocks)

  if (document.notes.length > 0) {
    finding('unsupported-note', 'blocker', `This ${sourceLabel} contains notes that the text-oriented workflow cannot publish it yet.`)
  }

  return {
    html,
    findings,
    equations,
    notes: document.notes.length,
    unavailableAssets,
    packagedAssets: [...packaged.values()],
  }
}
