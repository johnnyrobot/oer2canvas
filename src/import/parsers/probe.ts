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

export interface ParserProbeNormalizedContent {
  html: string
  findings: ParserProbeFinding[]
  equations: number
  notes: number
  unavailableAssets: number
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

export interface ParserProbeRequest {
  kind: 'parse'
  requestId: string
  bytes: ArrayBuffer
  formatHint?: string
}

export type ParserProbeResponse =
  | {
      kind: 'ready'
      requestId: string
      parser: ParserKind
      parserVersion: string
      initializationMs: number
    }
  | { kind: 'progress'; requestId: string; phase: 'parsing' }
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
