/// <reference lib="webworker" />

import init, { processPdf, version } from '@firecrawl/pdf-inspector-wasm'
import type {
  ParserProbeFailureCode,
  ParserProbeRequest,
  ParserProbeResponse,
} from '../parsers/probe'

const workerScope = self as DedicatedWorkerGlobalScope

function markdownCounts(markdown: string): {
  blocks: number
  headings: number
  tables: number
  images: number
  assets: number
} {
  const lines = markdown.split(/\r?\n/)
  return {
    blocks: markdown.split(/\n\s*\n/).filter((block) => block.trim()).length,
    headings: lines.filter((line) => /^#{1,6}\s/.test(line)).length,
    tables: lines.filter((line) => /^\s*\|.*\|\s*$/.test(line)).length > 1 ? 1 : 0,
    images: [...markdown.matchAll(/!\[[^\]]*\]\([^)]+\)/g)].length,
    assets: 0,
  }
}

function failure(error: unknown): { code: ParserProbeFailureCode; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const code: ParserProbeFailureCode = /password|encrypted/i.test(message)
    ? 'encrypted'
    : /limit|too (?:large|many|deep)/i.test(message)
      ? 'resource-limit'
      : /malformed|invalid|xref|trailer/i.test(message)
        ? 'malformed'
        : 'parse-failed'
  return { code, message: message || 'PDF Inspector could not read this file.' }
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
    const parserVersion = version()
    send({
      kind: 'ready',
      requestId: request.requestId,
      parser: 'pdf-inspector',
      parserVersion,
      initializationMs: performance.now() - initializationStarted,
    })
    send({ kind: 'progress', requestId: request.requestId, phase: 'parsing' })

    const parseStarted = performance.now()
    try {
      const result = processPdf(new Uint8Array(request.bytes), {
        profile: 'compact',
        includePageMarkers: true,
      })
      const markdown = result.markdown ?? ''
      send({
        kind: 'result',
        requestId: request.requestId,
        result: {
          parser: 'pdf-inspector',
          parserVersion,
          detectedFormat: 'pdf',
          inputBytes: request.bytes.byteLength,
          outputBytes: new TextEncoder().encode(markdown).byteLength,
          parseMs: performance.now() - parseStarted,
          wasmMemoryBytes: wasmMemory.buffer.byteLength,
          assetBytes: 0,
          largestAssetBytes: 0,
          counts: markdownCounts(markdown),
          pageCount: result.pageCount,
          pagesNeedingOcr: result.pagesNeedingOcr,
          layoutComplex: result.layout.isComplex,
          hasEncodingIssues: result.hasEncodingIssues,
        },
      })
    } catch (error) {
      send({ kind: 'failure', requestId: request.requestId, error: failure(error) })
    }
  })()
})
