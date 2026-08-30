import { DOCUMENT_IMPORT_LIMITS } from '../limits'

export type ParserKind = 'anydoc' | 'pdf-inspector'

export type ParserProbeProgressPhase =
  | 'loading-parser'
  | 'parser-ready'
  | 'parsing'
  | 'complete'

export interface ParserProbeProgress {
  phase: ParserProbeProgressPhase
  initializationMs?: number
}

export interface ParserProbeCounts {
  blocks: number
  headings: number
  tables: number
  images: number
  assets: number
}

export interface ParserProbeFinding {
  code: string
  severity: 'warning' | 'blocker'
  message: string
}

/**
 * One raster the parser has already verified (a real PNG/JPEG/GIF/WebP, sized
 * and hashed) and that is destined for the cartridge's `web_resources/`
 * directory. `name` is carried through verbatim from `prepareAssets` — it is
 * assigned once, deduped by content hash with the first-seen origin winning,
 * and must never be recomputed from `originPart` downstream (an asset sharing
 * a hash with an earlier one keeps that earlier name but its own origin).
 */
export interface PackagedAssetRecord {
  sha256: string
  name: string
  archivePath: string
  mediaType: string
  extension: string
  bytes: Uint8Array
  originPart: string
}

export interface ParserProbeNormalizedContent {
  html: string
  findings: ParserProbeFinding[]
  equations: number
  notes: number
  unavailableAssets: number
  packagedAssets: PackagedAssetRecord[]
}

/**
 * What `@firecrawl/pdf-inspector-wasm` concluded about a PDF, carried verbatim.
 *
 * Verbatim on purpose. Every field here is the module's own judgement, and the
 * importer's job is to translate it into findings a person can act on — not to
 * pre-digest it in a Worker where nothing can be tested against a real browser.
 * `pdfType` is typed as `string` rather than a union because the union lives in
 * the vendor `.d.ts`, which no non-Worker module imports; the importer treats
 * an unrecognised value as "not text-based" and fails closed.
 */
export interface ParserDetection {
  pdfType: string
  pageCount: number
  /**
   * 0-1. Measured to track the fraction of pages that produced text for a
   * `TextBased` document (3/3 = 1.00, 2/3 = 0.67, 3/4 = 0.75); `Scanned`
   * reported 0.90 and `Mixed` 0.70. Nothing upstream documents what it means,
   * so it is carried as DIAGNOSTICS and no decision is taken on it.
   */
  confidence: number
  /** 1-indexed. */
  pagesNeedingOcr: number[]
  /** Reasons observed so far: `no_text`, `scanned`. Identifiers, not English. */
  ocrReasonsByPage: { page: number; reasons: string[] }[]
  layout: { isComplex: boolean; pagesWithTables: number[]; pagesWithColumns: number[] }
  title?: string
}

/**
 * What a page-restricted re-parse found on a page that emitted NO page marker.
 *
 * It exists because `pagesNeedingOcr` cannot be trusted to name every scanned
 * page. Measured 2026-08-29: the module only populates it once the scanned
 * fraction is high enough for it to classify the document `Mixed`. A single
 * scanned page among two text ones is reported as `TextBased` with an EMPTY
 * `pagesNeedingOcr` — so a page that is an image of text would have been treated
 * as blank paper and published with its content missing.
 *
 * Re-parsing that one page with `pages: [n]` separates the two cases exactly,
 * with no threshold to invent: a blank page yields no image placeholder, and a
 * scanned page yields one.
 */
export interface PdfUnmarkedPage {
  page: number
  /** Image placeholders found on this page alone. */
  images: number
  /**
   * The re-parse failed, so nothing could be attributed. The importer fails
   * closed on it: absence of evidence that a page is blank is not evidence
   * that it is.
   */
  unattributed?: boolean
}

export interface ParserProbeResult {
  parser: ParserKind
  parserVersion: string
  detectedFormat: string
  formatDetection?: 'content' | 'hint'
  inputBytes: number
  outputBytes: number
  parseMs: number
  /** WASM linear-memory high-water allocation at the end of the parse. */
  wasmMemoryBytes?: number
  assetBytes?: number
  largestAssetBytes?: number
  counts: ParserProbeCounts
  pageCount?: number
  pagesNeedingOcr?: number[]
  layoutComplex?: boolean
  hasEncodingIssues?: boolean
  normalized?: ParserProbeNormalizedContent
  /**
   * Presentations only. The deck's own XML parts, inflated in the Worker because
   * that is where the transferred bytes live, and parsed on the main thread
   * because that is where `DOMParser` lives. Keys are package paths.
   */
  presentation?: { kind: 'pptx' | 'odp'; parts: Record<string, string> }
  /** PDF only. The module's classification, before any extraction happened. */
  detection?: ParserDetection
  /**
   * PDF only, and UNSANITIZED. The main thread splits and sanitizes it, because
   * `sanitizeImportedHtml` needs `DOMParser`, which a Worker does not have.
   */
  markdown?: string
  /** PDF only. One entry per page that emitted no marker. */
  unmarkedPages?: PdfUnmarkedPage[]
  /**
   * PDF only. The classification phase alone, which is what justifies parsing
   * the PDF structure twice to put the page budget ahead of extraction.
   * `parseMs` includes this.
   */
  detectMs?: number
  /**
   * PDF only. The page-restricted re-parses that attribute un-marked pages.
   * Zero for a document with no gaps, which is the normal case. `parseMs`
   * includes this.
   */
  attributionMs?: number
}

export type ParserProbeFailureCode =
  | 'initialization'
  | 'unsupported'
  | 'unsupported-version'
  | 'needs-ocr'
  | 'malformed'
  | 'encrypted'
  | 'resource-limit'
  | 'parse-failed'

export type ParserProbeRequest =
  | { kind: 'parse'; requestId: string; bytes: ArrayBuffer; formatHint?: string }
  /*
   * Phase two, PDF only. The Worker classifies, sends `detected`, and STOPS
   * until this arrives. That pause is what puts the page budget ahead of the
   * parse it exists to prevent, and it keeps budget enforcement in this runner
   * — where `maximumInputBytes`, the timeout and the memory ceiling already
   * live — instead of copying a limit into a Worker where no unit test can
   * observe the ordering.
   *
   * It carries nothing: `bytes` was transferred in on `parse` and stays there.
   */
  | { kind: 'extract'; requestId: string }

export type ParserProbeResponse =
  | {
      kind: 'ready'
      requestId: string
      parser: ParserKind
      parserVersion: string
      initializationMs: number
    }
  | { kind: 'progress'; requestId: string; phase: 'parsing' }
  | { kind: 'detected'; requestId: string; detection: ParserDetection }
  | { kind: 'result'; requestId: string; result: ParserProbeResult }
  | {
      kind: 'failure'
      requestId: string
      error: { code: ParserProbeFailureCode; message: string }
    }

export interface ParserProbeWorker {
  postMessage(message: ParserProbeRequest, transfer: Transferable[]): void
  addEventListener(type: 'message' | 'error', listener: EventListener): void
  removeEventListener(type: 'message' | 'error', listener: EventListener): void
  terminate(): void
}

export interface ParserProbeOptions {
  parser: ParserKind
  bytes: ArrayBuffer
  formatHint?: string
  signal?: AbortSignal
  onProgress?: (progress: ParserProbeProgress) => void
  /** Tests and diagnostics may shorten, but never extend, the production timeout. */
  timeoutMs?: number
}

interface ParserProbeRunnerDependencies {
  createWorker: (parser: ParserKind) => ParserProbeWorker
  requestId?: () => string
}

export class ParserProbeError extends Error {
  readonly code: ParserProbeFailureCode
  readonly retryable: boolean

  constructor(code: ParserProbeFailureCode, message: string, retryable = true) {
    super(message)
    this.name = 'ParserProbeError'
    this.code = code
    this.retryable = retryable
  }
}

const PARSER_LABEL: Readonly<Record<ParserKind, string>> = {
  anydoc: 'AnyDoc',
  'pdf-inspector': 'PDF Inspector',
}

function actionableFailure(
  parser: ParserKind,
  failure: { code: ParserProbeFailureCode; message: string },
): ParserProbeError {
  if (failure.code === 'initialization') {
    return new ParserProbeError(
      failure.code,
      `${PARSER_LABEL[parser]} could not start in this browser. Reload the page and try again. ` +
        `Technical detail: ${failure.message}`,
    )
  }
  return new ParserProbeError(
    failure.code,
    `${PARSER_LABEL[parser]} could not inspect this file. ${failure.message}`,
    failure.code !== 'encrypted' && failure.code !== 'unsupported' && failure.code !== 'unsupported-version',
  )
}

function abortError(): DOMException {
  return new DOMException('Parser probe cancelled.', 'AbortError')
}

function resourceLimit(message: string): ParserProbeError {
  return new ParserProbeError('resource-limit', message)
}

/*
 * The page budget, checked on the CLASSIFICATION and not on the result.
 * `detectPdf` reads the page tree without extracting text, so this refuses a
 * 300-page document having built no Markdown for any of it. `resultBudgetFailure`
 * keeps its own page check as defence in depth: this one only runs for a parser
 * that sends `detected`, and a budget with one enforcement point is a budget one
 * refactor away from having none.
 */
function detectionBudgetFailure(detection: ParserDetection): ParserProbeError | undefined {
  if (detection.pageCount > DOCUMENT_IMPORT_LIMITS.maximumPdfPages) {
    return resourceLimit(
      `This PDF has ${detection.pageCount} pages; the browser limit is ${DOCUMENT_IMPORT_LIMITS.maximumPdfPages}. ` +
      'It was rejected before any text was extracted.',
    )
  }
  return undefined
}

function resultBudgetFailure(result: ParserProbeResult): ParserProbeError | undefined {
  if ((result.pageCount ?? 0) > DOCUMENT_IMPORT_LIMITS.maximumPdfPages) {
    return resourceLimit(`This PDF has ${result.pageCount} pages; the browser limit is ${DOCUMENT_IMPORT_LIMITS.maximumPdfPages}.`)
  }
  if (result.counts.assets > DOCUMENT_IMPORT_LIMITS.maximumAssetCount) {
    return resourceLimit(`This document has ${result.counts.assets} embedded assets; the browser limit is ${DOCUMENT_IMPORT_LIMITS.maximumAssetCount}.`)
  }
  if ((result.assetBytes ?? 0) > DOCUMENT_IMPORT_LIMITS.maximumAssetBytes) {
    return resourceLimit('Embedded assets exceed the 8 MiB browser limit.')
  }
  if ((result.largestAssetBytes ?? 0) > DOCUMENT_IMPORT_LIMITS.maximumIndividualAssetBytes) {
    return resourceLimit('One embedded asset exceeds the 4 MiB browser limit.')
  }
  if ((result.wasmMemoryBytes ?? 0) > DOCUMENT_IMPORT_LIMITS.maximumWasmMemoryBytes) {
    return resourceLimit('Parser memory exceeded the 128 MiB browser limit.')
  }
  return undefined
}

export function createParserProbeRunner(
  dependencies: ParserProbeRunnerDependencies,
): (options: ParserProbeOptions) => Promise<ParserProbeResult> {
  return (options) => {
    if (options.signal?.aborted) return Promise.reject(abortError())
    if (options.bytes.byteLength > DOCUMENT_IMPORT_LIMITS.maximumInputBytes) {
      return Promise.reject(resourceLimit(
        'This file exceeds the 16 MiB browser limit. It was rejected before a parser Worker started.',
      ))
    }
    const requestId = dependencies.requestId?.() ?? globalThis.crypto.randomUUID()
    let worker: ParserProbeWorker
    try {
      worker = dependencies.createWorker(options.parser)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return Promise.reject(actionableFailure(options.parser, { code: 'initialization', message }))
    }

    return new Promise<ParserProbeResult>((resolve, reject) => {
      let settled = false
      let timeout: ReturnType<typeof setTimeout> | undefined
      const finish = (action: () => void) => {
        if (settled) return
        settled = true
        if (timeout !== undefined) clearTimeout(timeout)
        options.signal?.removeEventListener('abort', onAbort)
        worker.removeEventListener('message', onMessage as EventListener)
        worker.removeEventListener('error', onError as EventListener)
        worker.terminate()
        action()
      }
      const onAbort = () => finish(() => reject(abortError()))
      const reportProgress = (progress: ParserProbeProgress): boolean => {
        try {
          options.onProgress?.(progress)
          return true
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          finish(() => reject(new ParserProbeError(
            'parse-failed',
            `The parser progress handler failed. Technical detail: ${message}`,
          )))
          return false
        }
      }
      const onError = (event: ErrorEvent) => finish(() => reject(actionableFailure(
        options.parser,
        { code: 'initialization', message: event.message || 'The parser Worker failed to load.' },
      )))
      const onMessage = (event: MessageEvent<ParserProbeResponse>) => {
        const response = event.data
        if (response.requestId !== requestId) return
        if (response.kind === 'ready') {
          reportProgress({
            phase: 'parser-ready',
            initializationMs: response.initializationMs,
          })
          return
        }
        if (response.kind === 'progress') {
          reportProgress({ phase: response.phase })
          return
        }
        if (response.kind === 'detected') {
          const detectionFailure = detectionBudgetFailure(response.detection)
          if (detectionFailure) {
            finish(() => reject(detectionFailure))
            return
          }
          // The timeout spans both phases unchanged: it is one budget on the
          // whole parse, and splitting it would introduce a second number
          // nobody measured.
          worker.postMessage({ kind: 'extract', requestId }, [])
          return
        }
        if (response.kind === 'failure') {
          finish(() => reject(actionableFailure(options.parser, response.error)))
          return
        }
        const budgetFailure = resultBudgetFailure(response.result)
        if (budgetFailure) {
          finish(() => reject(budgetFailure))
          return
        }
        if (!reportProgress({ phase: 'complete' })) return
        finish(() => resolve(response.result))
      }

      options.signal?.addEventListener('abort', onAbort, { once: true })
      worker.addEventListener('message', onMessage as EventListener)
      worker.addEventListener('error', onError as EventListener)
      const timeoutMs = Math.min(
        Math.max(1, options.timeoutMs ?? DOCUMENT_IMPORT_LIMITS.parserTimeoutMs),
        DOCUMENT_IMPORT_LIMITS.parserTimeoutMs,
      )
      timeout = setTimeout(() => finish(() => reject(resourceLimit(
        `${PARSER_LABEL[options.parser]} did not finish within ${timeoutMs.toLocaleString()} ms. ` +
        'The Worker was stopped; try again with a smaller file.',
      ))), timeoutMs)
      if (!reportProgress({ phase: 'loading-parser' })) return
      // Abort dispatch is synchronous, but rechecking also covers a callback
      // that receives the signal through another abstraction and cancels it.
      if (settled || options.signal?.aborted) {
        onAbort()
        return
      }
      const request: ParserProbeRequest = {
        kind: 'parse',
        requestId,
        bytes: options.bytes,
        ...(options.formatHint ? { formatHint: options.formatHint } : {}),
      }
      try {
        // Ownership moves to the Worker. This is intentionally the caller's
        // buffer rather than a slice/copy, so large documents do not coexist in
        // two heaps while synchronous WASM is running.
        worker.postMessage(request, [options.bytes])
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        finish(() => reject(actionableFailure(options.parser, { code: 'initialization', message })))
      }
    })
  }
}

function createBrowserWorker(parser: ParserKind): ParserProbeWorker {
  if (parser === 'anydoc') {
    return new Worker(new URL('../workers/anydoc.worker.ts', import.meta.url), {
      type: 'module',
      name: 'oer2canvas-anydoc-probe',
    })
  }
  return new Worker(new URL('../workers/pdf-inspector.worker.ts', import.meta.url), {
    type: 'module',
    name: 'oer2canvas-pdf-inspector-probe',
  })
}

/** Production browser entry point. Vendor modules are imported only inside Workers. */
export const probeParser = createParserProbeRunner({ createWorker: createBrowserWorker })
