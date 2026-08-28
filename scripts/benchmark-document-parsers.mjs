/**
 * Exercise the exact built module Workers and WASM binaries used in production.
 * Fixtures are generated locally and served over loopback; no document bytes or
 * benchmark results leave this machine.
 */
import { createServer } from 'node:http'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { cpus, freemem, platform, release, totalmem } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'
import { PARSER_PROBE_LIMITS } from '../src/import/parser-limit-values.ts'
import {
  docxFixture,
  epubAssetFixture,
  odtFixture,
  pdfFixture,
  rtfFixture,
} from './document-parser-fixtures.mjs'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = join(ROOT, 'dist')
const encoder = new TextEncoder()
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
}

const PROFILES = [
  { id: 'chrome-desktop', browserType: chromium, launch: { channel: 'chrome' }, support: 'benchmarked-desktop' },
  { id: 'firefox-desktop', browserType: firefox, launch: {}, support: 'benchmarked-desktop' },
  {
    id: 'webkit-desktop-diagnostic',
    browserType: webkit,
    launch: {},
    support: 'diagnostic-only',
    limitation: 'Playwright WebKit is useful cross-engine evidence but is not Safari and is outside the initial Chrome/Firefox release matrix.',
  },
]

const errorText = (error) => error instanceof Error ? error.message : String(error)
const mib = (bytes) => Math.round((bytes / 1024 / 1024) * 100) / 100

async function fixtures() {
  const largestAsset = PARSER_PROBE_LIMITS.maximumIndividualAssetBytes
  const otherAssets = PARSER_PROBE_LIMITS.maximumAssetCount - 1
  const remainingAsset = Math.floor(
    (PARSER_PROBE_LIMITS.maximumAssetBytes - largestAsset) / otherAssets,
  )
  return [
    { id: 'docx-small', parser: 'anydoc', formatHint: 'docx', bytes: await docxFixture() },
    { id: 'odt-small', parser: 'anydoc', formatHint: 'odt', bytes: await odtFixture() },
    { id: 'rtf-small-8k', parser: 'anydoc', formatHint: 'rtf', bytes: rtfFixture(8 * 1024) },
    { id: 'rtf-medium-1m', parser: 'anydoc', formatHint: 'rtf', bytes: rtfFixture(1024 * 1024) },
    { id: 'rtf-stress-16m', parser: 'anydoc', formatHint: 'rtf', bytes: rtfFixture(PARSER_PROBE_LIMITS.maximumInputBytes) },
    {
      id: 'epub-assets-64-8m',
      parser: 'anydoc',
      formatHint: 'epub',
      bytes: await epubAssetFixture([
        largestAsset,
        ...Array.from({ length: otherAssets }, () => remainingAsset),
      ]),
    },
    { id: 'pdf-small-1-page', parser: 'pdf-inspector', formatHint: 'pdf', bytes: pdfFixture(1) },
    { id: 'pdf-medium-75-pages', parser: 'pdf-inspector', formatHint: 'pdf', bytes: pdfFixture(75) },
    { id: 'pdf-stress-200-pages', parser: 'pdf-inspector', formatHint: 'pdf', bytes: pdfFixture(PARSER_PROBE_LIMITS.maximumPdfPages) },
  ]
}

async function serveDist(fixtureMap) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
      if (pathname === '/parser-benchmark.html') {
        response.writeHead(200, { 'content-type': MIME['.html'] })
        response.end('<!doctype html><html lang="en"><meta charset="utf-8"><title>Parser benchmark</title><body><div id="root"></div></body></html>')
        return
      }
      if (pathname.startsWith('/fixtures/')) {
        const bytes = fixtureMap.get(pathname.slice('/fixtures/'.length))
        if (!bytes) throw new Error('unknown fixture')
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': String(bytes.byteLength),
          'cache-control': 'no-store',
        })
        response.end(bytes)
        return
      }
      const target = resolve(join(DIST, pathname.slice(1)))
      if (!target.startsWith(`${DIST}/`)) throw new Error('bad path')
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

async function probeFixture(page, probeUrl, origin, fixture) {
  return page.evaluate(async ({ moduleUrl, fixtureUrl, parser, formatHint }) => {
    const { probeParser } = await import(moduleUrl)
    const bytes = await fetch(fixtureUrl).then((response) => response.arrayBuffer())
    const progress = []
    const beforeHeap = performance.memory?.usedJSHeapSize ?? null
    const started = performance.now()
    try {
      const result = await probeParser({
        parser,
        bytes,
        formatHint,
        onProgress: (event) => progress.push({ ...event, atMs: performance.now() - started }),
      })
      const afterHeap = performance.memory?.usedJSHeapSize ?? null
      return {
        status: 'passed',
        elapsedMs: performance.now() - started,
        progress,
        mainHeapBeforeBytes: beforeHeap,
        mainHeapAfterBytes: afterHeap,
        result,
      }
    } catch (error) {
      return {
        status: 'failed',
        elapsedMs: performance.now() - started,
        progress,
        error: {
          name: error instanceof Error ? error.name : 'Error',
          message: error instanceof Error ? error.message : String(error),
          code: error?.code,
        },
      }
    }
  }, {
    moduleUrl: probeUrl,
    fixtureUrl: `${origin}/fixtures/${fixture.id}`,
    parser: fixture.parser,
    formatHint: fixture.formatHint,
  })
}

async function cancellationProbe(page, probeUrl, origin) {
  return page.evaluate(async ({ moduleUrl, fixtureUrl }) => {
    const { probeParser } = await import(moduleUrl)
    const bytes = await fetch(fixtureUrl).then((response) => response.arrayBuffer())
    const controller = new AbortController()
    let abortedAt
    const started = performance.now()
    try {
      await probeParser({
        parser: 'anydoc',
        bytes,
        formatHint: 'rtf',
        signal: controller.signal,
        onProgress: (event) => {
          if (event.phase === 'parsing') {
            abortedAt = performance.now()
            controller.abort()
          }
        },
      })
      return { status: 'failed', reason: 'probe resolved after cancellation' }
    } catch (error) {
      return {
        status: error instanceof Error && error.name === 'AbortError' ? 'passed' : 'failed',
        errorName: error instanceof Error ? error.name : 'Error',
        totalMs: performance.now() - started,
        terminationMs: abortedAt === undefined ? null : performance.now() - abortedAt,
      }
    }
  }, { moduleUrl: probeUrl, fixtureUrl: `${origin}/fixtures/rtf-stress-16m` })
}

async function runProfile(profile, probeUrl, origin, fixtureList) {
  const browser = await profile.browserType.launch({ headless: true, ...profile.launch })
  try {
    const context = await browser.newContext({
      serviceWorkers: 'block',
      ...(profile.viewport ? { viewport: profile.viewport } : {}),
    })
    const page = await context.newPage()
    page.setDefaultTimeout(180_000)
    if (profile.cpuThrottle) {
      const session = await context.newCDPSession(page)
      await session.send('Emulation.setCPUThrottlingRate', { rate: profile.cpuThrottle })
    }
    await page.goto(`${origin}/parser-benchmark.html`, { waitUntil: 'domcontentloaded' })
    const environment = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemoryGiB: navigator.deviceMemory ?? null,
      mainHeapMeasurement: performance.memory ? 'performance.memory.usedJSHeapSize after Worker termination' : 'unavailable',
    }))
    const results = []
    for (const fixture of fixtureList) {
      results.push({
        id: fixture.id,
        inputBytes: fixture.bytes.byteLength,
        inputMiB: mib(fixture.bytes.byteLength),
        ...(await probeFixture(page, probeUrl, origin, fixture)),
      })
    }
    const cancellation = await cancellationProbe(page, probeUrl, origin)
    const retry = await probeFixture(page, probeUrl, origin, fixtureList[0])
    return {
      id: profile.id,
      support: profile.support,
      ...(profile.limitation ? { limitation: profile.limitation } : {}),
      browserVersion: browser.version(),
      pageTargetCpuThrottle: profile.cpuThrottle ?? 1,
      viewport: profile.viewport ?? null,
      environment,
      results,
      cancellation,
      retryAfterCancellation: retry.status,
      status: results.every((result) => result.status === 'passed') &&
        cancellation.status === 'passed' && retry.status === 'passed'
        ? 'passed'
        : 'failed',
    }
  } finally {
    await browser.close()
  }
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: PARSER_BENCHMARK_REPORT=artifacts/document-parser-benchmark.json npm run benchmark:document-parsers')
    return
  }
  const builtAssets = await readdir(join(DIST, 'assets'))
  const probeAsset = builtAssets.find((name) => /^probe-.*\.js$/.test(name))
  if (!probeAsset) throw new Error('dist is missing the parser probe chunk; run npm run build first')
  const fixtureList = await fixtures()
  const fixtureMap = new Map(fixtureList.map((fixture) => [fixture.id, fixture.bytes]))
  const { server, origin } = await serveDist(fixtureMap)
  const profiles = []
  try {
    for (const profile of PROFILES) {
      process.stderr.write(`benchmarking ${profile.id}...\n`)
      try {
        profiles.push(await runProfile(profile, `${origin}/assets/${probeAsset}`, origin, fixtureList))
      } catch (error) {
        profiles.push({ id: profile.id, support: profile.support, status: 'failed', error: errorText(error) })
      }
    }
  } finally {
    await new Promise((resolveServer) => server.close(resolveServer))
  }

  const report = {
    generatedAt: new Date().toISOString(),
    host: {
      platform: platform(),
      release: release(),
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      totalMemoryBytes: totalmem(),
      freeMemoryBytesAtStart: freemem(),
    },
    fixturePolicy: {
      generated: true,
      networkUploads: false,
      sizes: fixtureList.map((fixture) => ({ id: fixture.id, bytes: fixture.bytes.byteLength })),
    },
    supportPolicy: {
      supportedReleaseProfiles: PROFILES.filter((profile) => profile.support === 'benchmarked-desktop').map((profile) => profile.id),
      unsupported: ['safari', 'mobile'],
      note: 'The initial document-import release supports desktop Chrome and Firefox only. WebKit remains diagnostic evidence and does not imply Safari support.',
    },
    profiles,
    status: profiles
      .filter((profile) => profile.support === 'benchmarked-desktop')
      .every((profile) => profile.status === 'passed') ? 'passed' : 'failed',
  }
  const json = `${JSON.stringify(report, null, 2)}\n`
  const reportPath = process.env.PARSER_BENCHMARK_REPORT?.trim()
  if (reportPath) {
    const absolute = resolve(reportPath)
    await mkdir(dirname(absolute), { recursive: true })
    await writeFile(absolute, json)
  }
  process.stdout.write(json)
  if (report.status !== 'passed') process.exitCode = 1
}

main().catch((error) => {
  console.error(`document parser benchmark failed: ${errorText(error)}`)
  process.exitCode = 1
})
