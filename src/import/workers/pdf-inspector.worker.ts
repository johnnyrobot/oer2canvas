/// <reference lib="webworker" />

import init, { detectPdf, processPdf, version } from '@firecrawl/pdf-inspector-wasm'
import type { PdfProcessResult } from '@firecrawl/pdf-inspector-wasm'
import type {
  ParserDetection,
  PdfUnmarkedPage,
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

/**
 * The module's own judgement, carried verbatim onto the wire.
 *
 * `detectPdf` and `processPdf` return the same result type, so both phases
 * describe themselves the same way and the main thread never has to know which
 * one it is reading.
 *
 * `title` is carried and deliberately never used to set the import title: the
 * user typed one, and a PDF `/Title` is frequently the authoring tool's filename.
 */
function describe(result: PdfProcessResult): ParserDetection {
  return {
    pdfType: result.pdfType,
    pageCount: result.pageCount,
    confidence: result.confidence,
    pagesNeedingOcr: result.pagesNeedingOcr,
    ocrReasonsByPage: result.ocrReasonsByPage,
    layout: result.layout,
    ...(result.title ? { title: result.title } : {}),
  }
}

/** `<!-- Page 7 -->` on its own line, the exact form the module emits. */
const PAGE_MARKER = /^<!-- Page (\d+) -->[ \t]*$/gm
const IMAGE_PLACEHOLDER = /!\[[^\]]*\]\([^)]*\)/g

/**
 * Say what was actually on each page that emitted no marker.
 *
 * `pagesNeedingOcr` does not name every scanned page: measured 2026-08-29, the
 * module only populates it once the scanned fraction is high enough for it to
 * classify the document `Mixed`, so one scanned page among two text ones comes
 * back as `TextBased` with an empty list. Without this, that page would be
 * indistinguishable from blank paper and would publish with its content missing.
 *
 * Re-parsing each such page ALONE separates the cases exactly and invents no
 * threshold: a blank page yields no image placeholder and a scanned one yields
 * one. It runs here rather than on the main thread because this is where the
 * bytes and the module already are.
 *
 * Bounded by a budget that has already been enforced: `maximumPdfPages` caps the
 * document at 200, each re-parse covers ONE page, and a document with no gaps at
 * all — the normal case — does no extra work.
 */
function attributeUnmarkedPages(bytes: ArrayBuffer, markdown: string, pageCount: number): PdfUnmarkedPage[] {
  const marked = new Set([...markdown.matchAll(PAGE_MARKER)].map((match) => Number(match[1])))
  const unmarked: PdfUnmarkedPage[] = []
  for (let page = 1; page <= pageCount; page += 1) {
    if (marked.has(page)) continue
    try {
      const only = processPdf(new Uint8Array(bytes), {
        profile: 'compact',
        includeImages: true,
        pages: [page],
      })
      unmarked.push({ page, images: [...(only.markdown ?? '').matchAll(IMAGE_PLACEHOLDER)].length })
    } catch {
      unmarked.push({ page, images: 0, unattributed: true })
    }
  }
  return unmarked
}

function failure(error: unknown): { code: ParserProbeFailureCode; message: string } {
  const message = error instanceof Error ? error.message : String(error)
  const code: ParserProbeFailureCode = /password|encrypted/i.test(message)
    ? 'encrypted'
    : /limit|too (?:large|many|deep)/i.test(message)
      ? 'resource-limit'
      /*
       * Measured messages: "process PDF: Not a PDF: file appears to be plain
       * text", "… HTML", "… a ZIP archive (possibly an Office document)". All
       * three used to fall through to `parse-failed`, which `actionableFailure`
       * treats as RETRYABLE — telling the user to try again with a file whose
       * contents will never be a PDF. Ordered ahead of `malformed` because
       * "Not a PDF: … invalid" would otherwise match that branch first.
       */
      : /not a pdf/i.test(message)
        ? 'unsupported'
        : /malformed|invalid|xref|trailer/i.test(message)
          ? 'malformed'
          : 'parse-failed'
  return { code, message: message || 'PDF Inspector could not read this file.' }
}

function send(response: ParserProbeResponse): void {
  workerScope.postMessage(response)
}

/**
 * The document this Worker is part-way through, held between the two phases.
 *
 * One slot is enough: `createParserProbeRunner` creates a Worker per request and
 * terminates it on settle, so a probe Worker never serves two documents. The
 * bytes were transferred in on `parse` and stay here — the `extract` request
 * carries nothing.
 */
let pending: {
  requestId: string
  bytes: ArrayBuffer
  parserVersion: string
  wasmMemory: WebAssembly.Memory
  detectMs: number
} | undefined

function extract(request: Extract<ParserProbeRequest, { kind: 'extract' }>): void {
  // A stale or duplicate `extract` has nothing to work on. Ignoring it matches
  // how the runner already ignores responses whose `requestId` does not match.
  if (!pending || pending.requestId !== request.requestId) return
  const { bytes, parserVersion, wasmMemory, detectMs } = pending
  pending = undefined

  const parseStarted = performance.now()
  try {
    const result = processPdf(new Uint8Array(bytes), {
      profile: 'compact',
      includePageMarkers: true,
      /*
       * ON, so a figure leaves a `![Image: …](image)` placeholder in the
       * Markdown instead of vanishing. It is the only trace of a figure this
       * version produces — `PdfProcessResult` carries no image bytes — and it
       * is what the importer turns into a visible `[Embedded image: …]` mark
       * and a warning naming the page.
       */
      includeImages: true,
    })
    const markdown = result.markdown ?? ''
    const attributionStarted = performance.now()
    const unmarkedPages = attributeUnmarkedPages(bytes, markdown, result.pageCount)
    const attributionMs = performance.now() - attributionStarted
    send({
      kind: 'result',
      requestId: request.requestId,
      result: {
        parser: 'pdf-inspector',
        parserVersion,
        detectedFormat: 'pdf',
        inputBytes: bytes.byteLength,
        outputBytes: new TextEncoder().encode(markdown).byteLength,
        // Both phases of module work, and NEITHER the round trip between them:
        // the Worker sits idle waiting for `extract`, and counting that wait
        // would make this number a measure of message latency.
        parseMs: detectMs + (performance.now() - parseStarted),
        wasmMemoryBytes: wasmMemory.buffer.byteLength,
        assetBytes: 0,
        largestAssetBytes: 0,
        counts: markdownCounts(markdown),
        pageCount: result.pageCount,
        pagesNeedingOcr: result.pagesNeedingOcr,
        layoutComplex: result.layout.isComplex,
        hasEncodingIssues: result.hasEncodingIssues,
        markdown,
        unmarkedPages,
        detectMs,
        attributionMs,
        // The EXTRACTION's classification, not the detection phase's. Both
        // report the same shape, but this one was computed with every page's
        // text in hand, so it is the better-informed of the two. The detection
        // phase's copy exists to answer one question — how many pages — early
        // enough to refuse the work.
        detection: describe(result),
      },
    })
  } catch (error) {
    send({ kind: 'failure', requestId: request.requestId, error: failure(error) })
  }
}

function parse(request: Extract<ParserProbeRequest, { kind: 'parse' }>): void {
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

    /*
     * Classify first. This is not an optimisation — it is the phase order the
     * criteria need. The page budget must refuse a 300-page document before its
     * text is built, and a scanned document must be recognised without
     * extracting its empty pages. `detectPdf` measured about a tenth of
     * `processPdf` (9.8 ms against 106.6 ms on the 200-page fixture), so the
     * PDF structure being parsed twice is affordable.
     */
    const detectStarted = performance.now()
    let detection: ParserDetection
    try {
      detection = describe(detectPdf(new Uint8Array(request.bytes)))
    } catch (error) {
      send({ kind: 'failure', requestId: request.requestId, error: failure(error) })
      return
    }
    pending = {
      requestId: request.requestId,
      bytes: request.bytes,
      parserVersion,
      wasmMemory,
      detectMs: performance.now() - detectStarted,
    }
    // And STOP. The runner checks the page budget against this and either
    // refuses — having built no Markdown for any page — or asks for `extract`.
    send({ kind: 'detected', requestId: request.requestId, detection })
  })()
}

// One listener, switching on the request kind, so cancellation still has exactly
// one thing to tear down.
workerScope.addEventListener('message', (event: MessageEvent<ParserProbeRequest>) => {
  const request = event.data
  if (request.kind === 'parse') parse(request)
  else if (request.kind === 'extract') extract(request)
})
