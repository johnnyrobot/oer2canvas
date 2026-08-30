/// <reference lib="webworker" />

import init, {
  formatFromBytes,
  formatFromExtension,
  toDocument,
  type Block,
  type Document,
  type Inline,
} from '@firecrawl/anydoc-wasm'
import type {
  ParserProbeFailureCode,
  ParserProbeRequest,
  ParserProbeResponse,
} from '../parsers/probe'
import { normalizeAnyDocDocument } from '../parsers/anydoc-html'
import { prepareAssets } from '../assets'
import { readZipParts } from '../zip-read'
import { isPresentationPackageKind, wantedPresentationPart } from '../presentation/parts'

const ANYDOC_VERSION = '0.2.4'
const workerScope = self as DedicatedWorkerGlobalScope

function inlineImages(inlines: readonly Inline[] | undefined): number {
  if (!inlines) return 0
  return inlines.reduce((total, inline) =>
    total + (inline.kind === 'image' ? 1 : 0) + inlineImages(inline.content), 0)
}

function countBlocks(blocks: readonly Block[]): {
  blocks: number
  headings: number
  tables: number
  images: number
} {
  const counts = { blocks: 0, headings: 0, tables: 0, images: 0 }
  const visit = (block: Block) => {
    counts.blocks += 1
    if (block.kind === 'heading') counts.headings += 1
    if (block.kind === 'table') counts.tables += 1
    counts.images += inlineImages(block.content)
    block.blocks?.forEach(visit)
    block.list?.items.forEach((item) => item.blocks.forEach(visit))
    block.table?.grid.forEach((row) => row.forEach((slot) => slot.cell?.blocks.forEach(visit)))
  }
  blocks.forEach(visit)
  return counts
}

function outputBytes(document: Document): number {
  const withoutBinaryCopies = JSON.stringify(document, (_key, value: unknown) =>
    value instanceof Uint8Array ? { byteLength: value.byteLength } : value)
  return new TextEncoder().encode(withoutBinaryCopies).byteLength +
    document.assets.reduce((total, asset) => total + asset.data.byteLength, 0)
}

function failure(error: unknown): { code: ParserProbeFailureCode; message: string } {
  const candidate = error as { code?: unknown; message?: unknown }
  const rawCode = typeof candidate?.code === 'string' ? candidate.code : ''
  const code: ParserProbeFailureCode = rawCode === 'needsOcr'
    ? 'needs-ocr'
    : rawCode === 'resourceLimit'
      ? 'resource-limit'
      : rawCode === 'unsupported' || rawCode === 'unsupported-version' || rawCode === 'malformed' || rawCode === 'encrypted' || rawCode === 'resource-limit'
        ? rawCode
        : 'parse-failed'
  const message = typeof candidate?.message === 'string' && candidate.message.trim()
    ? candidate.message
    : 'The document parser could not read this file.'
  return { code, message }
}

function send(response: ParserProbeResponse): void {
  workerScope.postMessage(response)
}

workerScope.addEventListener('message', (event: MessageEvent<ParserProbeRequest>) => {
  const request = event.data
  if (request.kind !== 'parse') return
  void (async () => {
    const initializationStarted = performance.now()
    let wasmMemory: WebAssembly.Memory
    try {
      wasmMemory = (await init()).memory
    } catch (error) {
      send({
        kind: 'failure',
        requestId: request.requestId,
        error: {
          code: 'initialization',
          message: error instanceof Error ? error.message : String(error),
        },
      })
      return
    }
    send({
      kind: 'ready',
      requestId: request.requestId,
      parser: 'anydoc',
      parserVersion: ANYDOC_VERSION,
      initializationMs: performance.now() - initializationStarted,
    })
    send({ kind: 'progress', requestId: request.requestId, phase: 'parsing' })

    const parseStarted = performance.now()
    try {
      const bytes = new Uint8Array(request.bytes)
      const hintedFormat = request.formatHint
        ? formatFromExtension(request.formatHint.replace(/^.*\./, ''))
        : undefined
      const contentFormat = formatFromBytes(bytes)
      const detectedFormat = contentFormat ?? hintedFormat
      const document = toDocument(bytes, detectedFormat)
      const counts = countBlocks(document.blocks)
      const assetBytes = document.assets.reduce((total, asset) => total + asset.data.byteLength, 0)
      const largestAssetBytes = document.assets.reduce(
        (largest, asset) => Math.max(largest, asset.data.byteLength),
        0,
      )

      // The deck's own account of itself, alongside anydoc's. A failure to read it
      // is NOT fatal here: the main thread decides what an unreadable package means,
      // and `document.ts` refuses a presentation with no index rather than the
      // Worker deciding for every format at once.
      let presentation: { kind: 'pptx' | 'odp'; parts: Record<string, string> } | undefined
      const kind = detectedFormat
      if (kind !== undefined && isPresentationPackageKind(kind)) {
        const parts = await readZipParts(bytes, (path) => wantedPresentationPart(kind, path))
        presentation = { kind, parts: Object.fromEntries(parts) }
      }

      send({
        kind: 'result',
        requestId: request.requestId,
        result: {
          parser: 'anydoc',
          parserVersion: ANYDOC_VERSION,
          detectedFormat: detectedFormat ?? 'unknown',
          formatDetection: contentFormat ? 'content' : 'hint',
          inputBytes: request.bytes.byteLength,
          outputBytes: outputBytes(document),
          parseMs: performance.now() - parseStarted,
          wasmMemoryBytes: wasmMemory.buffer.byteLength,
          assetBytes,
          largestAssetBytes,
          counts: { ...counts, assets: document.assets.length },
          normalized: normalizeAnyDocDocument(
            document,
            detectedFormat ?? 'document',
            await prepareAssets(document.assets),
          ),
          presentation,
        },
      })
    } catch (error) {
      send({ kind: 'failure', requestId: request.requestId, error: failure(error) })
    }
  })()
})
