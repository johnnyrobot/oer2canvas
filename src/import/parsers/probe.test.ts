import {
  ParserProbeError,
  createParserProbeRunner,
  type ParserProbeResponse,
  type ParserProbeWorker,
} from './probe'
import { DOCUMENT_IMPORT_LIMITS } from '../limits'

class FakeWorker implements ParserProbeWorker {
  readonly requests: unknown[] = []
  terminated = false
  private readonly messageListeners = new Set<(event: MessageEvent<ParserProbeResponse>) => void>()
  private readonly errorListeners = new Set<(event: ErrorEvent) => void>()

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.requests.push(structuredClone(message, { transfer }))
  }

  addEventListener(type: 'message' | 'error', listener: EventListener): void {
    if (type === 'message') {
      this.messageListeners.add(listener as (event: MessageEvent<ParserProbeResponse>) => void)
    } else {
      this.errorListeners.add(listener as (event: ErrorEvent) => void)
    }
  }

  removeEventListener(type: 'message' | 'error', listener: EventListener): void {
    if (type === 'message') {
      this.messageListeners.delete(listener as (event: MessageEvent<ParserProbeResponse>) => void)
    } else {
      this.errorListeners.delete(listener as (event: ErrorEvent) => void)
    }
  }

  terminate(): void {
    this.terminated = true
  }

  emit(response: ParserProbeResponse): void {
    for (const listener of this.messageListeners) listener(new MessageEvent('message', { data: response }))
  }
}

test('the parser probe transfers source ownership and reports public progress through completion', async () => {
  const worker = new FakeWorker()
  const progress: string[] = []
  const run = createParserProbeRunner({
    createWorker: () => worker,
    requestId: () => 'request-1',
  })
  const bytes = new TextEncoder().encode('{\\rtf1 Probe text}').buffer

  const pending = run({
    parser: 'anydoc',
    bytes,
    formatHint: 'rtf',
    onProgress: (event) => progress.push(event.phase),
  })

  expect(bytes.byteLength).toBe(0)
  expect(worker.requests).toHaveLength(1)
  expect(worker.requests[0]).toMatchObject({
    kind: 'parse',
    requestId: 'request-1',
    formatHint: 'rtf',
  })
  expect((worker.requests[0] as { bytes: ArrayBuffer }).bytes.byteLength).toBe(18)

  worker.emit({
    kind: 'ready',
    requestId: 'request-1',
    parser: 'anydoc',
    parserVersion: '0.2.4',
    initializationMs: 12,
  })
  worker.emit({ kind: 'progress', requestId: 'request-1', phase: 'parsing' })
  worker.emit({
    kind: 'result',
    requestId: 'request-1',
    result: {
      parser: 'anydoc',
      parserVersion: '0.2.4',
      detectedFormat: 'rtf',
      inputBytes: 18,
      outputBytes: 10,
      parseMs: 3,
      counts: { blocks: 1, headings: 0, tables: 0, images: 0, assets: 0 },
    },
  })

  await expect(pending).resolves.toMatchObject({ parser: 'anydoc', detectedFormat: 'rtf' })
  expect(progress).toEqual(['loading-parser', 'parser-ready', 'parsing', 'complete'])
  expect(worker.terminated).toBe(true)
})

test('cancellation terminates synchronous parser work and a retry receives a fresh worker', async () => {
  const workers: FakeWorker[] = []
  const run = createParserProbeRunner({
    createWorker: () => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
    requestId: () => `request-${workers.length + 1}`,
  })
  const controller = new AbortController()
  const cancelled = run({
    parser: 'pdf-inspector',
    bytes: new ArrayBuffer(16),
    signal: controller.signal,
  })
  controller.abort()

  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' })
  expect(workers[0]?.terminated).toBe(true)

  const retry = run({ parser: 'pdf-inspector', bytes: new ArrayBuffer(16) })
  expect(workers).toHaveLength(2)
  workers[1]!.emit({
    kind: 'failure',
    requestId: 'request-2',
    error: { code: 'initialization', message: 'WebAssembly.compile failed' },
  })
  await expect(retry).rejects.toEqual(expect.objectContaining<Partial<ParserProbeError>>({
    name: 'ParserProbeError',
    code: 'initialization',
    retryable: true,
    message: expect.stringMatching(/PDF Inspector could not start.*reload.*try again/i),
  }))
  expect(workers[1]?.terminated).toBe(true)
})

test('cancellation from the first progress callback stops before bytes enter the Worker', async () => {
  const worker = new FakeWorker()
  const controller = new AbortController()
  const run = createParserProbeRunner({ createWorker: () => worker })

  const pending = run({
    parser: 'anydoc',
    bytes: new ArrayBuffer(16),
    signal: controller.signal,
    onProgress: () => controller.abort(),
  })

  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(worker.requests).toHaveLength(0)
  expect(worker.terminated).toBe(true)
})

test('a future AnyDoc model kind becomes a non-retryable unsupported-version failure', async () => {
  const worker = new FakeWorker()
  const run = createParserProbeRunner({
    createWorker: () => worker,
    requestId: () => 'future-model',
  })
  const pending = run({ parser: 'anydoc', bytes: new ArrayBuffer(16) })

  worker.emit({
    kind: 'failure',
    requestId: 'future-model',
    error: {
      code: 'unsupported-version',
      message: 'AnyDoc returned an unsupported document-model kind: futureBlock.',
    },
  })

  await expect(pending).rejects.toMatchObject({
    name: 'ParserProbeError',
    code: 'unsupported-version',
    retryable: false,
    message: expect.stringMatching(/unsupported document-model kind: futureBlock/i),
  })
  expect(worker.terminated).toBe(true)
})

test('a failing progress consumer cannot strand a parser Worker', async () => {
  const worker = new FakeWorker()
  const run = createParserProbeRunner({ createWorker: () => worker })

  await expect(run({
    parser: 'pdf-inspector',
    bytes: new ArrayBuffer(16),
    onProgress: () => { throw new Error('render failed') },
  })).rejects.toMatchObject({
    name: 'ParserProbeError',
    code: 'parse-failed',
    message: expect.stringMatching(/progress.*render failed/i),
  })
  expect(worker.requests).toHaveLength(0)
  expect(worker.terminated).toBe(true)
})

test('the public probe refuses files above the measured browser budget before creating a Worker', async () => {
  const createWorker = vi.fn(() => new FakeWorker())
  const run = createParserProbeRunner({ createWorker })

  await expect(run({
    parser: 'anydoc',
    bytes: new ArrayBuffer((16 * 1024 * 1024) + 1),
  })).rejects.toMatchObject({
    name: 'ParserProbeError',
    code: 'resource-limit',
    message: expect.stringMatching(/16 MiB.*before.*Worker/i),
  })
  expect(createWorker).not.toHaveBeenCalled()
})

test('a parser that stops responding is terminated at the measured timeout and can retry', async () => {
  vi.useFakeTimers()
  try {
    const workers: FakeWorker[] = []
    const run = createParserProbeRunner({
      createWorker: () => {
        const worker = new FakeWorker()
        workers.push(worker)
        return worker
      },
      requestId: () => `timeout-${workers.length + 1}`,
    })
    const pending = run({
      parser: 'anydoc',
      bytes: new ArrayBuffer(16),
      timeoutMs: 10,
    })
    const timedOut = expect(pending).rejects.toMatchObject({
      name: 'ParserProbeError',
      code: 'resource-limit',
      message: expect.stringMatching(/did not finish.*10 ms.*try again/i),
    })
    await vi.advanceTimersByTimeAsync(10)

    await timedOut
    expect(workers[0]?.terminated).toBe(true)

    const retry = run({ parser: 'anydoc', bytes: new ArrayBuffer(16) })
    expect(workers).toHaveLength(2)
    workers[1]!.emit({
      kind: 'failure',
      requestId: 'timeout-2',
      error: { code: 'unsupported', message: 'unsupported fixture' },
    })
    await expect(retry).rejects.toMatchObject({ code: 'unsupported' })
  } finally {
    vi.useRealTimers()
  }
})

test('measured result budgets stop oversized parser output and terminate its Worker', async () => {
  const worker = new FakeWorker()
  const run = createParserProbeRunner({
    createWorker: () => worker,
    requestId: () => 'budget-result',
  })
  const pending = run({ parser: 'pdf-inspector', bytes: new ArrayBuffer(16) })
  worker.emit({
    kind: 'result',
    requestId: 'budget-result',
    result: {
      parser: 'pdf-inspector',
      parserVersion: '1.17.0',
      detectedFormat: 'pdf',
      inputBytes: 16,
      outputBytes: 1,
      parseMs: 1,
      pageCount: 201,
      counts: { blocks: 1, headings: 0, tables: 0, images: 0, assets: 0 },
    },
  })

  await expect(pending).rejects.toMatchObject({
    code: 'resource-limit',
    message: expect.stringMatching(/201 pages.*limit is 200/i),
  })
  expect(worker.terminated).toBe(true)
})

test('a pdf result carries the module detection and the raw markdown', async () => {
  const worker = new FakeWorker()
  const run = createParserProbeRunner({
    createWorker: () => worker,
    requestId: () => 'pdf-detection',
  })
  const pending = run({ parser: 'pdf-inspector', bytes: new ArrayBuffer(16) })
  const detection = {
    pdfType: 'Mixed',
    pageCount: 4,
    confidence: 0.7,
    pagesNeedingOcr: [3],
    ocrReasonsByPage: [{ page: 3, reasons: ['scanned'] }],
    layout: { isComplex: true, pagesWithTables: [2], pagesWithColumns: [1, 2] },
  }

  worker.emit({
    kind: 'result',
    requestId: 'pdf-detection',
    result: {
      parser: 'pdf-inspector',
      parserVersion: '1.17.0',
      detectedFormat: 'pdf',
      inputBytes: 16,
      outputBytes: 24,
      parseMs: 4,
      counts: { blocks: 1, headings: 0, tables: 0, images: 0, assets: 0 },
      detection,
      markdown: '<!-- Page 1 -->\n\nText.\n',
    },
  })

  // Both fields survive the postMessage seam untouched. The main thread is the
  // only place that may interpret them: it has `DOMParser`, and the Worker does not.
  const result = await pending
  expect(result.detection).toEqual(detection)
  expect(result.markdown).toBe('<!-- Page 1 -->\n\nText.\n')
})

/** The classification a well-formed three-page text PDF produces. */
const detection = {
  pdfType: 'TextBased',
  pageCount: 3,
  confidence: 1,
  pagesNeedingOcr: [],
  ocrReasonsByPage: [],
  layout: { isComplex: false, pagesWithTables: [], pagesWithColumns: [] },
}

const requestKinds = (worker: FakeWorker): unknown[] =>
  worker.requests.map((request) => (request as { kind: unknown }).kind)

test('an over-budget pdf is refused before any text is extracted', async () => {
  const worker = new FakeWorker()
  const run = createParserProbeRunner({
    createWorker: () => worker,
    requestId: () => 'over-budget',
  })
  const pending = run({ parser: 'pdf-inspector', bytes: new ArrayBuffer(8) })

  worker.emit({
    kind: 'ready',
    requestId: 'over-budget',
    parser: 'pdf-inspector',
    parserVersion: '1.17.0',
    initializationMs: 1,
  })
  worker.emit({
    kind: 'detected',
    requestId: 'over-budget',
    detection: { ...detection, pageCount: DOCUMENT_IMPORT_LIMITS.maximumPdfPages + 1 },
  })

  await expect(pending).rejects.toMatchObject({
    name: 'ParserProbeError',
    code: 'resource-limit',
    message: expect.stringMatching(/before any text was extracted/i),
  })
  // THE POINT OF THE TEST. Refusing is easy; refusing before the extraction is
  // the budget's whole purpose, and the only way to observe it from outside the
  // Worker is that the second phase was never asked for.
  expect(requestKinds(worker)).toEqual(['parse'])
})

test('a pdf inside the budget is asked to extract, and the detection reaches the caller', async () => {
  const worker = new FakeWorker()
  const run = createParserProbeRunner({
    createWorker: () => worker,
    requestId: () => 'in-budget',
  })
  const pending = run({ parser: 'pdf-inspector', bytes: new ArrayBuffer(8) })

  worker.emit({
    kind: 'ready',
    requestId: 'in-budget',
    parser: 'pdf-inspector',
    parserVersion: '1.17.0',
    initializationMs: 1,
  })
  worker.emit({ kind: 'detected', requestId: 'in-budget', detection })
  expect(requestKinds(worker)).toEqual(['parse', 'extract'])

  worker.emit({
    kind: 'result',
    requestId: 'in-budget',
    result: {
      parser: 'pdf-inspector',
      parserVersion: '1.17.0',
      detectedFormat: 'pdf',
      inputBytes: 8,
      outputBytes: 12,
      parseMs: 5,
      counts: { blocks: 1, headings: 0, tables: 0, images: 0, assets: 0 },
      detection,
      markdown: '<!-- Page 1 -->\n\nText.\n',
    },
  })

  await expect(pending).resolves.toMatchObject({ detection: { pageCount: detection.pageCount } })
})
