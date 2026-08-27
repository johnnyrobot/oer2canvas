/**
 * Run the real browser/WebGPU VLM benchmark.
 *
 * This deliberately runs against `dist/` rather than importing the model in
 * Node. The production path is the browser export, and a Node fallback would
 * make a release look healthy while never exercising WebGPU or Cache Storage.
 * By default a missing adapter produces a JSON `blocked` report and exits 0 so
 * a developer can collect evidence. Set VLM_REQUIRE_GPU=1 in release CI to
 * turn that state into a failing command.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import sharp from 'sharp'
import { VLM_FIXTURES } from './vlm-fixtures.mjs'
import { fitCanvasAltText } from './fit-canvas-alt-text.mjs'

const ROOT = resolve(join(fileURLToPath(new URL('.', import.meta.url)), '..'))
const DIST = join(ROOT, 'dist')
const MODEL = {
  id: process.env.VLM_MODEL_ID?.trim() || 'onnx-community/Florence-2-base-ft',
  revision: process.env.VLM_MODEL_REVISION?.trim() || 'e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f',
  task: '<MORE_DETAILED_CAPTION>',
  dtype: process.env.VLM_DTYPE?.trim() || 'q4',
}
const MODEL_ARTIFACTS = [
  'onnx/decoder_model_merged_q4.onnx',
  'onnx/embed_tokens_q4.onnx',
  'onnx/encoder_model_q4.onnx',
  'onnx/vision_encoder_q4.onnx',
]
const CHAPTER_FIXTURE_PATH = join(ROOT, 'src/sources/fixtures/openstax/page-section.json')
const CHAPTER_RESOURCE_DIR = join(ROOT, 'src/sources/fixtures/openstax/resources')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
}

const errorText = (error) => error instanceof Error ? error.message : String(error)

async function transformerAsset() {
  const files = await readdir(join(DIST, 'assets'))
  const asset = files.find((file) => /^transformers\.web-.*\.js$/.test(file))
  if (!asset) throw new Error('dist is missing the Transformers.js browser chunk; run npm run build first.')
  return asset
}

async function modelMetadata() {
  const response = await fetch(`https://huggingface.co/api/models/${MODEL.id}?blobs=true`)
  if (!response.ok) throw new Error(`Hugging Face model metadata returned HTTP ${response.status}`)
  const model = await response.json()
  if (model.sha !== MODEL.revision) throw new Error(`model revision moved: expected ${MODEL.revision}, got ${model.sha}`)
  const files = new Map((model.siblings ?? []).map((file) => [file.rfilename, file]))
  const missing = MODEL_ARTIFACTS.filter((name) => !files.has(name))
  const bytes = MODEL_ARTIFACTS.reduce((total, name) => total + (files.get(name)?.size ?? 0), 0)
  return { expectedArtifactBytes: bytes, expectedArtifactMiB: Math.round((bytes / 1024 / 1024) * 10) / 10, missingArtifacts: missing }
}

async function textbookFixtures() {
  const page = JSON.parse(await readFile(CHAPTER_FIXTURE_PATH, 'utf8'))
  const images = [...page.content.matchAll(/<img[^>]*>/gi)].map((match) => match[0])
  return Promise.all(images.map(async (tag, index) => {
    const hash = tag.match(/src="\.\.\/resources\/([0-9a-f]{40})"/)?.[1]
    if (!hash) throw new Error(`chapter fixture image ${index + 1} has no committed resource hash`)
    const resourcePath = join(CHAPTER_RESOURCE_DIR, `${hash}.jpg`)
    const publisherAlt = tag.match(/alt="([^"]*)"/)?.[1] ?? null
    const png = await sharp(resourcePath).png().toBuffer()
    return {
      id: `openstax-1-4-image-${String(index + 1).padStart(2, '0')}`,
      category: 'OpenStax Algebra and Trigonometry — 1.4 Polynomials',
      decorative: false,
      source: resourcePath,
      publisherAlt,
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
    }
  }))
}

function benchmarkPage() {
  // Vite may share the app's React chunk with the Transformers.js chunk. Keep
  // a root available so that shared module initialization cannot fail before
  // the benchmark's own evaluation starts.
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>VLM benchmark</title></head><body><div id="root"></div><main><h1>VLM benchmark</h1><p id="status">Running…</p></main></body></html>'
}

async function serveDist() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
      if (pathname === '/' || pathname === '/benchmark.html') {
        response.writeHead(200, { 'content-type': MIME['.html'] })
        response.end(benchmarkPage())
        return
      }
      const target = resolve(join(DIST, pathname.slice(1)))
      if (!target.startsWith(`${DIST}/`)) {
        response.writeHead(400)
        response.end('bad path')
        return
      }
      const body = await readFile(target)
      response.writeHead(200, { 'content-type': MIME[extname(target)] ?? 'application/octet-stream' })
      response.end(body)
    } catch {
      response.writeHead(404)
      response.end('not found')
    }
  })
  await new Promise((resolveServer, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveServer)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('benchmark server did not expose a port')
  return { server, origin: `http://127.0.0.1:${address.port}` }
}

async function browserForBenchmark() {
  const cdp = process.env.VLM_CDP_URL?.trim()
  if (cdp) return { browser: await chromium.connectOverCDP(cdp), remote: true }
  const channel = process.env.VLM_BROWSER_CHANNEL?.trim()
  const headless = process.env.VLM_HEADLESS !== 'false'
  const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']
  if (process.platform === 'darwin') args.push('--use-angle=metal')
  const extra = process.env.VLM_LAUNCH_ARGS?.split(',').map((value) => value.trim()).filter(Boolean) ?? []
  args.push(...extra)
  return {
    browser: await chromium.launch({
      ...(channel ? { channel } : {}),
      headless,
      args,
    }),
    remote: false,
  }
}

async function gpuInfo(page) {
  return page.evaluate(async () => {
    if (!navigator.gpu) return { exposed: false, adapter: false }
    const adapter = await navigator.gpu.requestAdapter()
    return {
      exposed: true,
      adapter: Boolean(adapter),
      ...(adapter?.info ? {
        info: {
          vendor: adapter.info.vendor,
          architecture: adapter.info.architecture,
          device: adapter.info.device,
          description: adapter.info.description,
        },
      } : {}),
    }
  })
}

async function runInBrowser(page, transformerUrl, fixtures, warmRun) {
  return page.evaluate(async ({ transformerUrl: url, fixtures: inputs, model, warm }) => {
    const transformers = await import(url)
    transformers.env.allowLocalModels = false
    transformers.env.allowRemoteModels = true
    transformers.env.useBrowserCache = true
    transformers.env.useFSCache = false
    transformers.env.logLevel = transformers.LogLevel.ERROR

    const progress = []
    const progress_callback = (event) => {
      if (typeof event?.loaded === 'number') progress.push(event.loaded)
    }
    const loadStart = performance.now()
    const [generator, processor] = await Promise.all([
      transformers.Florence2ForConditionalGeneration.from_pretrained(model.id, {
        revision: model.revision,
        device: 'webgpu',
        dtype: model.dtype,
        progress_callback,
      }),
      transformers.AutoProcessor.from_pretrained(model.id, {
        revision: model.revision,
        progress_callback,
      }),
    ])
    const coldLoadMs = performance.now() - loadStart
    let warmLoadMs
    if (warm) {
      const warmStart = performance.now()
      const [warmGenerator, warmProcessor] = await Promise.all([
        transformers.Florence2ForConditionalGeneration.from_pretrained(model.id, {
          revision: model.revision,
          device: 'webgpu',
          dtype: model.dtype,
        }),
        transformers.AutoProcessor.from_pretrained(model.id, { revision: model.revision }),
      ])
      warmLoadMs = performance.now() - warmStart
      await warmGenerator?.dispose?.()
      await warmProcessor?.dispose?.()
    }

    const outputs = []
    for (const fixture of inputs) {
      const started = performance.now()
      try {
        // Decode through a Blob because Transformers.js v4 accepts URLs,
        // Blobs, and canvases (not HTMLImageElement instances). This also
        // exercises the same byte-to-pixels boundary used by remote images.
        const imageResponse = await fetch(fixture.dataUrl)
        const image = await transformers.load_image(await imageResponse.blob())
        const prompts = processor.construct_prompts(model.task)
        const encoded = await processor(image, prompts)
        const generated = await generator.generate({
          ...encoded,
          max_new_tokens: 120,
        })
        const decoded = processor.batch_decode(generated, { skip_special_tokens: false })[0] ?? ''
        const processed = processor.post_process_generation(decoded, model.task, image.size)
        const candidate = processed[model.task] ?? decoded
        const draft = typeof candidate === 'string' ? candidate.trim() : JSON.stringify(candidate)
        outputs.push({
          id: fixture.id,
          category: fixture.category,
          decorative: Boolean(fixture.decorative),
          draft,
          nonEmpty: Boolean(draft),
          characters: draft.length,
          latencyMs: Math.round((performance.now() - started) * 10) / 10,
        })
      } catch (error) {
        outputs.push({
          id: fixture.id,
          category: fixture.category,
          decorative: Boolean(fixture.decorative),
          draft: '',
          nonEmpty: false,
          latencyMs: Math.round((performance.now() - started) * 10) / 10,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return { coldLoadMs, warmLoadMs, outputs, progressEvents: progress.length }
  }, { transformerUrl, fixtures, model: MODEL, warm: warmRun })
}

function summarize(report) {
  const nonDecorative = report.results.filter((item) => !item.decorative)
  const successful = nonDecorative.filter((item) => item.nonEmpty).length
  const successRate = nonDecorative.length === 0 ? 0 : successful / nonDecorative.length
  const overLimit = report.results.filter((item) => item.nonEmpty && item.characters > 120)
  const fixtureGate = report.fixtureCount >= report.minimumFixtureCount
  return {
    ...report,
    nonDecorative: nonDecorative.length,
    successfulNonDecorative: successful,
    nonEmptyRate: Math.round(successRate * 1000) / 1000,
    canvasAltTextLimit: 120,
    canvasLengthViolations: overLimit.length,
    status: fixtureGate && successRate >= 0.95 && overLimit.length === 0 ? 'passed-automated-gates' : 'blocked',
    gateReasons: [
      ...(fixtureGate ? [] : [`At least ${report.minimumFixtureCount} fixtures are required for this run.`]),
      ...(successRate >= 0.95 ? [] : ['At least 95% of non-decorative fixtures must return a non-empty draft.']),
      ...(overLimit.length === 0 ? [] : [`${overLimit.length} generated candidates exceed Canvas's 120-character limit.`]),
    ],
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: VLM_WARM_RUN=1 VLM_REPORT=artifacts/vlm-report.json npm run benchmark:vlm')
    console.log('Options: VLM_SOURCE=synthetic|chapter, VLM_BROWSER_CHANNEL, VLM_HEADLESS, VLM_CDP_URL, VLM_DTYPE, VLM_FIXTURE_LIMIT, VLM_REQUIRE_GPU')
    return
  }
  if (!MODEL.id.startsWith('onnx-community/Florence-2-')) {
    throw new Error('The browser harness currently supports the Florence-2 ONNX candidates; use the model-specific adapter before benchmarking another architecture.')
  }
  const source = process.env.VLM_SOURCE?.trim().toLowerCase() || 'synthetic'
  if (!['synthetic', 'chapter'].includes(source)) throw new Error(`unsupported VLM_SOURCE: ${source}`)
  const fixtureLimit = Math.max(1, Number.parseInt(process.env.VLM_FIXTURE_LIMIT ?? '30', 10) || 30)
  const fixtures = source === 'chapter'
    ? (await textbookFixtures()).slice(0, fixtureLimit)
    : await Promise.all(VLM_FIXTURES.slice(0, fixtureLimit).map(async (fixture) => ({
      id: fixture.id,
      category: fixture.category,
      decorative: fixture.decorative,
      // Rasterize the authored SVG once in the Node benchmark harness. The
      // actual model still receives browser bytes through load_image(Blob), just
      // like it does for a textbook JPEG or PNG.
      dataUrl: `data:image/png;base64,${(await sharp(Buffer.from(fixture.svg, 'utf8')).png().toBuffer()).toString('base64')}`,
    })))
  if (fixtures.length < fixtureLimit && source !== 'chapter') throw new Error(`fixture set contains ${fixtures.length} items; requested ${fixtureLimit}`)
  if (fixtures.length === 0) throw new Error('no fixtures were available for the requested benchmark source')

  const [asset, metadata] = await Promise.all([transformerAsset(), modelMetadata()])
  if (metadata.missingArtifacts.length > 0) throw new Error(`model revision is missing q4 artifacts: ${metadata.missingArtifacts.join(', ')}`)
  const { server, origin } = await serveDist()
  const { browser, remote } = await browserForBenchmark()
  const network = { requests: 0, bytes: 0, bodyFallbacks: 0 }
  const networkBodies = []
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const page = await context.newPage()
    page.setDefaultTimeout(Number(process.env.VLM_TIMEOUT_MS ?? 900000))
    if (process.env.VLM_DEBUG === '1') {
      page.on('request', (request) => console.error(`request ${request.method()} ${request.url()}`))
      page.on('pageerror', (error) => console.error(`pageerror ${error.message}`))
    }
    page.on('response', (response) => {
      if (!/huggingface\.co|cdn\.jsdelivr\.net/.test(response.url())) return
      network.requests += 1
      const bytes = Number(response.headers()['content-length'])
      if (Number.isFinite(bytes)) network.bytes += bytes
      else {
        network.bodyFallbacks += 1
        networkBodies.push(response.body().then((body) => { network.bytes += body.byteLength }).catch(() => {}))
      }
    })
    await page.goto(`${origin}/benchmark.html`)
    if (process.env.VLM_DEBUG === '1') console.error(`benchmark page: ${page.url()} ${await page.locator('body').innerText()}`)
    const gpu = await gpuInfo(page)
    const base = {
      generatedAt: new Date().toISOString(),
      browser: process.env.VLM_BROWSER_CHANNEL?.trim() || (remote ? 'cdp' : 'playwright-chromium'),
      headless: process.env.VLM_HEADLESS !== 'false',
      gpu,
      model: MODEL,
      modelArtifacts: metadata,
      source,
      minimumFixtureCount: source === 'chapter' ? 1 : 30,
      chapter: source === 'chapter' ? {
        title: '1.4 Polynomials',
        book: 'Algebra and Trigonometry',
        publisher: 'OpenStax',
        sectionFixture: CHAPTER_FIXTURE_PATH,
      } : undefined,
      fixtureCount: fixtures.length,
      warmRun: process.env.VLM_WARM_RUN === '1',
      network,
    }
    if (!gpu.adapter) {
      const report = {
        ...base,
        status: 'blocked',
        reason: gpu.exposed ? 'navigator.gpu.requestAdapter() returned no adapter.' : 'navigator.gpu is not exposed.',
        results: [],
      }
      await output(report)
      if (process.env.VLM_REQUIRE_GPU === '1') process.exitCode = 1
      return
    }
    const result = await runInBrowser(page, `${origin}/assets/${asset}`, fixtures, process.env.VLM_WARM_RUN === '1')
    // The model response is retained for diagnostics, but the report's public
    // candidate is the exact text that can be entered into Canvas.
    const fixtureById = new Map(fixtures.map((fixture) => [fixture.id, fixture]))
    result.outputs = result.outputs.map((item) => {
      const rawDraft = item.draft
      const draft = fitCanvasAltText(rawDraft)
      const fixture = fixtureById.get(item.id)
      return {
        ...item,
        ...(fixture?.source ? { source: fixture.source } : {}),
        ...(fixture?.publisherAlt !== undefined ? { publisherAlt: fixture.publisherAlt } : {}),
        rawDraft,
        draft,
        rawCharacters: rawDraft.length,
        characters: draft.length,
      }
    })
    await Promise.all(networkBodies)
    const report = summarize({ ...base, ...result, results: result.outputs })
    delete report.outputs
    await output(report)
    if (report.status === 'blocked') process.exitCode = 1
  } finally {
    if (remote) browser.disconnect()
    else await browser.close()
    await new Promise((resolveServer) => server.close(resolveServer))
  }
}

async function output(report) {
  const json = JSON.stringify(report, null, 2)
  if (process.env.VLM_REPORT?.trim()) {
    const reportPath = resolve(process.env.VLM_REPORT)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, `${json}\n`)
  }
  console.log(json)
}

main().catch((error) => {
  console.error(`VLM benchmark failed: ${errorText(error)}`)
  process.exitCode = 1
})
