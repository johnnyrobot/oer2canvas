/**
 * Smoke test for the BUILT bundle.
 *
 * WHY THIS EXISTS. Every other test in this repo runs `src/` through Vite's dev
 * transform. `npm run build` type-checks and bundles but never executes what it
 * produced, so the one artifact a user actually receives would otherwise go
 * unexecuted. Minification can rewrite the
 * function whose `.toString()` became the axe payload, and the injected script
 * threw `ReferenceError: t is not defined` inside the audit frame. 357 green
 * tests and a clean build said nothing about it, because none of them loaded
 * `dist/`.
 *
 * WHAT IT DOES. Serves `dist/` over loopback, stubs every upstream request with
 * the committed fixtures, and drives the real UI: pick a book, pick a chapter,
 * wait for the compiled chapter to render. It asserts the audit actually ran —
 * a rendered chapter with no accessibility verdict would be the degenerate pass.
 *
 * It touches NO network. Any request that is not a `dist/` asset and not one of
 * the stubs below is failed loudly rather than allowed through, so this cannot
 * quietly start depending on openstax.org being up.
 *
 * Run with `npm run test:dist` (build first).
 */
import { createServer } from 'node:http'
import { readFile, readdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { rmSync, existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { pdfFixture } from '../src/import/testing/pdf-fixture.ts'
import { semanticDocxFixture } from '../src/import/testing/docx-fixture.ts'
import { semanticEpubFixture } from '../src/import/testing/structured-document-fixtures.ts'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DIST = join(ROOT, 'dist')
const FIXTURES = join(ROOT, 'src/sources/fixtures/openstax')
const PORT = 4173

/** The fixture book: Algebra and Trigonometry, the uuid `release.json` maps. */
const BOOK = 'Algebra and Trigonometry'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
}

function serveDist() {
  return createServer(async (req, res) => {
    const path = decodeURIComponent((req.url ?? '/').split('?')[0])
    // SPA fallback, matching `not_found_handling: "single-page-application"`.
    const candidate = join(DIST, path === '/' ? 'index.html' : path)
    const file = existsSync(candidate) && extname(candidate) ? candidate : join(DIST, 'index.html')
    try {
      const body = await readFile(file)
      res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
      res.end(body)
    } catch (e) {
      res.writeHead(500)
      res.end(String(e))
    }
  })
}

const fixture = (name) => readFile(join(FIXTURES, name))

/**
 * Stub every upstream hop with a committed fixture.
 *
 * The page fixture is the Preface for EVERY section id. That is deliberate: this
 * is a smoke test for "does the built bundle work at all", not a milestone
 * measurement, and the Preface is the cheapest page we have. `golden.test.ts`
 * owns output correctness.
 */
async function stubUpstream(page, failures) {
  await page.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(`http://localhost:${PORT}/relay`)) {
      return route.fulfill({ contentType: 'application/json', body: await fixture('release.json') })
    }
    if (url.startsWith(`http://localhost:${PORT}/`)) return route.continue()
    const contents = url.match(/\/contents\/[^/]+@[^/]+?(:[^/]+)?\.json$/)
    if (contents) {
      const body = await fixture(contents[1] ? 'page.json' : 'book-toc.json')
      return route.fulfill({ contentType: 'application/json', body })
    }
    // Committed on disk with a `.jpg` extension the content URL does not carry.
    const image = url.match(/\/resources\/([0-9a-f]{40})$/)
    if (image) {
      try {
        return await route.fulfill({
          contentType: 'image/jpeg',
          body: await fixture(join('resources', `${image[1]}.jpg`)),
        })
      } catch {
        failures.push(`no committed fixture image for ${image[1]}`)
        return route.abort()
      }
    }
    // Anything else would be a real network call. Record it and fail the request
    // rather than letting the suite silently acquire a dependency on the internet.
    failures.push(`unstubbed request escaped to the network: ${url}`)
    return route.abort()
  })
}

async function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    throw new Error('dist/index.html not found — run `npm run build` first')
  }

  const builtHtml = await readFile(join(DIST, 'index.html'), 'utf8')
  if (!builtHtml.includes('<meta name="robots" content="noindex, nofollow, noarchive, nosnippet, noimageindex"')) {
    throw new Error('dist/index.html does not opt out of search indexing')
  }
  const builtHeaders = await readFile(join(DIST, '_headers'), 'utf8')
  if (!builtHeaders.includes('X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex')) {
    throw new Error('dist/_headers does not opt every static asset out of search indexing')
  }
  const serviceWorker = await readFile(join(DIST, 'sw.js'), 'utf8')
  const builtAssets = await readdir(join(DIST, 'assets'))
  const parserAssets = builtAssets.filter((name) =>
    /^(?:anydoc\.worker|pdf-inspector\.worker|anydoc_wasm_bg|pdf_inspector_wasm_bg)-/.test(name))
  const probeAsset = builtAssets.find((name) => /^probe-.*\.js$/.test(name))
  if (parserAssets.length !== 4 || !probeAsset) {
    throw new Error(`dist parser assets are incomplete: ${parserAssets.join(', ') || 'none'}`)
  }
  /*
   * ONE URL, ONE PAGE — AND ONE EXTRACTION ENDPOINT PER BUILT ARTIFACT.
   *
   * Asserted against the SHIPPED bundle, not just the source. Issue 12's third
   * criterion is a claim about what does not exist, so it is checked the way
   * this file already checks absence — and issue 17 turned it into a claim
   * about which of TWO deployment modes was built.
   *
   * Every half matters, in both directions:
   *
   *  - the forbidden list catches a crawler arriving later;
   *  - requiring the mode's own endpoint to be PRESENT catches the opposite
   *    failure, because a check that passes because the whole feature was
   *    tree-shaken out is not a check;
   *  - requiring the OTHER mode's endpoint to be ABSENT is what "compiled out
   *    entirely" means. Measured 2026-08-30 against both real artifacts: a
   *    public build carries no `/crawl` and no `/health`, and a self-hosted
   *    build carries no `/v2/scrape`, no `api.firecrawl.dev` and no
   *    `Firecrawl API key`. A folded module-scope constant is enough for that;
   *    no dynamic import was needed, and this assertion is what would notice if
   *    a future refactor made one necessary.
   *
   * `/crawl` is safe as a marker: the only `crawl` substrings in a public
   * bundle come from `firecrawl`, `firecrawl.dev` and `firecrawl-api-key`, none
   * of which carry a leading slash (checked 2026-08-30).
   */
  const selfHostedExtractor = process.env.OER2CANVAS_EXPECT_SELF_HOSTED_EXTRACTOR_ORIGIN?.trim()
  const extraction = selfHostedExtractor
    ? { mode: 'self-hosted extractor', required: '/crawl', absent: ['/v2/scrape', 'api.firecrawl.dev'] }
    : { mode: 'firecrawl', required: '/v2/scrape', absent: ['/crawl', '/health'] }
  const forbiddenExtractionPaths = [
    // Firecrawl's, from `src/import/firecrawl.ts`.
    '/v2/crawl', '/v2/map', '/v2/search', '/v2/batch', '/v2/agent',
    // The self-hosted service's, from `src/import/self-hosted-extractor.ts`.
    // `/crawl/stream` rather than `/crawl`, which is this mode's own endpoint.
    '/crawl/stream', '/execute_js', '/screenshot', '/config/dump', '/hooks/info',
  ]
  let sawExtractionEndpoint = false
  for (const asset of builtAssets.filter((name) => name.endsWith('.js'))) {
    const chunk = await readFile(join(DIST, 'assets', asset), 'utf8')
    if (chunk.includes(extraction.required)) sawExtractionEndpoint = true
    for (const path of forbiddenExtractionPaths) {
      if (chunk.includes(path)) {
        throw new Error(`dist chunk ${asset} names the forbidden extraction endpoint ${path}`)
      }
    }
    for (const path of extraction.absent) {
      if (chunk.includes(path)) {
        throw new Error(
          `dist chunk ${asset} names ${path}, which belongs to the other deployment mode; `
          + `this is a ${extraction.mode} build and that path should be compiled out`,
        )
      }
    }
  }
  if (!sawExtractionEndpoint) {
    throw new Error(
      `no dist chunk names ${extraction.required}; web import was dropped from this `
      + `${extraction.mode} build`,
    )
  }
  if (selfHostedExtractor) {
    const namesOrigin = await Promise.all(
      builtAssets.filter((name) => name.endsWith('.js'))
        .map(async (asset) => (await readFile(join(DIST, 'assets', asset), 'utf8')).includes(selfHostedExtractor)),
    )
    if (!namesOrigin.some(Boolean)) {
      throw new Error(`no dist chunk names the pinned extractor origin ${selfHostedExtractor}`)
    }
  }

  if (!serviceWorker.includes('oer2canvas-document-parsers-v1')) {
    throw new Error('service worker has no bounded runtime cache for document parsers')
  }
  for (const asset of parserAssets) {
    if (serviceWorker.includes(`assets/${asset}`)) {
      throw new Error(`service worker install precaches the on-demand parser asset ${asset}`)
    }
  }
  // The generated Workbox navigation route must keep Worker-controlled
  // responses out of the app HTML cache. Checking the built artifact catches a
  // config change that looks correct in TypeScript but serializes a broader
  // matcher into the shipped service worker.
  for (const path of ['/relay', '/healthz']) {
    if (!serviceWorker.includes(path)) {
      throw new Error(`service worker does not mention the non-cacheable ${path} route`)
    }
  }
  if (!serviceWorker.includes('oer2canvas-html')) {
    throw new Error('service worker navigation cache is missing')
  }
  const robots = await readFile(join(DIST, 'robots.txt'), 'utf8')
  if (
    !robots.includes('User-agent: *') ||
    !robots.includes('Content-Signal: search=no, ai-input=no, ai-train=no, use=immediate') ||
    !robots.includes('Allow: /') ||
    /^Sitemap:/im.test(robots)
  ) {
    throw new Error('dist/robots.txt must expose noindex headers without advertising a sitemap')
  }

  const manifest = JSON.parse(await readFile(join(DIST, 'manifest.webmanifest'), 'utf8'))
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) {
    throw new Error('PWA manifest has fewer than two install icons')
  }
  for (const icon of manifest.icons) {
    if (!existsSync(join(DIST, icon.src.replace(/^\//, '')))) {
      throw new Error(`PWA manifest icon is missing from dist: ${icon.src}`)
    }
  }

  const server = serveDist()
  await new Promise((r) => server.listen(PORT, r))

  const browser = await chromium.launch()
  // Service workers would serve a PRECACHED bundle, which is not necessarily the
  // one just built. Block them so this always exercises the current dist.
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()

  const failures = []
  const consoleErrors = []
  const localRequests = []
  page.on('pageerror', (e) => consoleErrors.push(String(e)))
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.origin === `http://localhost:${PORT}`) localRequests.push(url.pathname)
  })
  await stubUpstream(page, failures)

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    const parserRequest = (pattern) => localRequests.some((path) => pattern.test(path))
    if (parserRequest(/(?:probe-|anydoc\.worker|pdf-inspector\.worker|anydoc_wasm_bg|pdf_inspector_wasm_bg)/)) {
      failures.push('initial application load fetched an on-demand parser asset')
    }

    const docxBytes = await semanticDocxFixture()
    const epubBytes = await semanticEpubFixture()
    const anydoc = await page.evaluate(async ({ probeUrl, source }) => {
      const { probeParser } = await import(probeUrl)
      return probeParser({
        parser: 'anydoc',
        bytes: new Uint8Array(source).buffer,
        formatHint: 'docx',
      })
    }, {
      probeUrl: `/assets/${probeAsset}`,
      source: Array.from(docxBytes),
    })
    if (
      anydoc.detectedFormat !== 'docx' ||
      anydoc.formatDetection !== 'content' ||
      anydoc.parserVersion !== '0.2.4' ||
      !anydoc.normalized?.html.includes('Cell Biology</h1>') ||
      !anydoc.normalized?.html.includes('href="#cell-biology"') ||
      !anydoc.normalized?.html.includes('<table>')
    ) {
      failures.push(`built AnyDoc probe returned unexpected evidence: ${JSON.stringify(anydoc)}`)
    }
    if (!parserRequest(/anydoc\.worker/) || !parserRequest(/anydoc_wasm_bg/)) {
      failures.push('built AnyDoc probe did not fetch its Worker and WASM on demand')
    }
    if (parserRequest(/pdf-inspector\.worker|pdf_inspector_wasm_bg/)) {
      failures.push('AnyDoc probe fetched PDF Inspector assets')
    }

    const pdfBytes = pdfFixture(1, 'Production PDF Inspector probe')
    const pdf = await page.evaluate(async ({ probeUrl, source }) => {
      const { probeParser } = await import(probeUrl)
      return probeParser({
        parser: 'pdf-inspector',
        bytes: new Uint8Array(source).buffer,
        formatHint: 'pdf',
      })
    }, { probeUrl: `/assets/${probeAsset}`, source: Array.from(pdfBytes) })
    if (pdf.detectedFormat !== 'pdf' || pdf.pageCount !== 1) {
      failures.push(`built PDF Inspector probe returned unexpected evidence: ${JSON.stringify(pdf)}`)
    }
    if (!parserRequest(/pdf-inspector\.worker/) || !parserRequest(/pdf_inspector_wasm_bg/)) {
      failures.push('built PDF Inspector probe did not fetch its Worker and WASM on demand')
    }

    // This assertion runs against the compiled artifact, so a source-level
    // conditional that is accidentally enabled or dropped by deployment
    // configuration cannot pass unnoticed.
    const expectedCanvasOrigin = process.env.OER2CANVAS_EXPECT_SELF_HOSTED_CANVAS_ORIGIN?.trim()
    if (expectedCanvasOrigin) {
      const canvasButton = page.getByRole('button', { name: /A Canvas course/i })
      if (await canvasButton.count() !== 1) failures.push('self-host build has no Canvas destination')
      else await canvasButton.click()

      const address = page.getByLabel('Canvas address')
      if (await address.count() !== 1 || await address.inputValue() !== expectedCanvasOrigin) {
        failures.push('self-host build did not expose the configured Canvas origin')
      } else if (await address.isEditable()) {
        failures.push('self-host build left the pinned Canvas origin editable')
      }
      if (await page.getByLabel('Access token').count() !== 1) {
        failures.push('self-host build has no Canvas access-token field')
      }
    } else {
      if (await page.getByRole('button', { name: /A Canvas course/i }).count()) {
        failures.push('public build exposes the direct Canvas destination')
      }
      if (await page.getByLabel('Canvas address').count()) {
        failures.push('public build exposes the Canvas address field')
      }
      if (await page.getByLabel('Access token').count()) {
        failures.push('public build exposes the Canvas access-token field')
      }
    }

    // Drive a newly release-enabled EPUB through the built UI and inspect the
    // file it downloads. The direct parser probe above proves artifact loading;
    // this proves the production UI actually connects parsing to audit, Plan,
    // and the same cartridge writer used by publisher content.
    await page.getByRole('button', { name: /A cartridge file/i }).click()

    /*
     * The web-extraction boundary, seen the way a user sees it.
     *
     * The chunk grep above proves the endpoint was compiled out; this proves
     * the SCREEN matches, which is the half issue 17's second criterion is
     * actually about — "the key UI is absent rather than merely hidden". Run
     * against the built artifact for the same reason the Canvas block above is:
     * a source-level conditional that deployment configuration accidentally
     * enables or drops cannot pass unnoticed.
     */
    await page.getByRole('tab', { name: 'Web page' }).click()
    const keyField = page.getByLabel('Firecrawl API key')
    const passwordInputs = page.locator('input[type="password"]')
    if (selfHostedExtractor) {
      if (await keyField.count()) failures.push('self-hosted extractor build still asks for a Firecrawl key')
      if (await passwordInputs.count()) failures.push('self-hosted extractor build still renders a credential field')
      if (await page.getByRole('button', { name: /Forget key/i }).count()) {
        failures.push('self-hosted extractor build still offers Forget key')
      }
      if (!await page.getByText(selfHostedExtractor, { exact: false }).count()) {
        failures.push('self-hosted extractor build does not disclose the pinned extraction origin')
      }
    } else {
      // Present, not merely absent elsewhere: a check that passes because the
      // whole Web page tab disappeared is not a check.
      if (await keyField.count() !== 1) failures.push('public build has no Firecrawl key field')
      if (!await page.getByText('api.firecrawl.dev', { exact: false }).count()) {
        failures.push('public build does not disclose the Firecrawl destination')
      }
    }

    await page.getByRole('tab', { name: 'Document' }).click()
    await page.getByLabel('Document file').setInputFiles({
      name: 'production-reader.epub',
      mimeType: 'application/epub+zip',
      buffer: Buffer.from(epubBytes),
    })
    await page.getByRole('radio', { name: 'I created or own this content' }).click()
    await page.getByRole('checkbox', { name: /I am responsible for rights/i }).click()
    await page.getByRole('button', { name: 'Inspect document' }).click()
    // AnyDoc surfaces the EPUB package title as a heading, so the proposal is
    // two pages. Merging them in the built editor proves the page plan is wired
    // in production and keeps the one-page cartridge assertion below honest.
    await page.getByRole('heading', { name: 'Page plan: production-reader' }).waitFor()
    await page.getByRole('button', { name: /^Merge with next page/ }).first().click()
    await page.getByRole('button', { name: 'Prepare 1 page' }).click()
    await page.getByText('Stores DNA').waitFor({ state: 'visible', timeout: 120_000 })
    await page.getByRole('button', { name: /^Plan$/ }).click()

    const documentDownload = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: /^Download cartridge/ }).click()
    const documentFile = await documentDownload
    const savedDocumentCartridge = join(tmpdir(), `epub-${documentFile.suggestedFilename()}`)
    await documentFile.saveAs(savedDocumentCartridge)
    try {
      execFileSync('unzip', ['-t', savedDocumentCartridge], { stdio: 'pipe' })
      const listed = execFileSync('unzip', ['-Z1', savedDocumentCartridge], { encoding: 'utf8' }).trim().split('\n')
      const pages = listed.filter((name) => name.startsWith('wiki_content/'))
      if (pages.length !== 1) failures.push(`built EPUB cartridge has ${pages.length} page(s), expected 1`)
      if (pages[0]) {
        const html = execFileSync('unzip', ['-p', savedDocumentCartridge, pages[0]], { encoding: 'utf8' })
        if (!html.includes('Cell Biology') || !html.includes('Stores DNA') || !html.includes('<table')) {
          failures.push('built EPUB cartridge did not retain its heading, table text, and table semantics')
        }
      }
    } catch (e) {
      failures.push(`built EPUB workflow downloaded an unreadable cartridge: ${e.message}`)
    } finally {
      rmSync(savedDocumentCartridge, { force: true })
    }

    // Start a fresh UI session for the independent publisher smoke below.
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForLoadState('networkidle')

    // The workflow opens on Destination now: "where does this go?" is asked
    // before anything is picked. Cartridge is the credential-free answer, so
    // this smoke test still runs entirely offline against committed fixtures.
    await page.getByRole('button', { name: /A cartridge file/i }).click()
    await page.getByRole('button', { name: BOOK, exact: true }).click()
    // Selection is a set: tick the chapter, then commit it. The two steps are
    // the point — the set is visible and changeable before anything runs.
    await page.getByRole('checkbox', { name: /^Chapter 1\b/ }).click()
    await page.getByRole('button', { name: /^Prepare 1 chapter$/ }).click()

    // The compiled chapter, or the error region, whichever arrives first.
    const verdict = page.getByText(/No blocking issues found\.|blocking issue/i).first()
    await Promise.race([
      verdict.waitFor({ state: 'visible', timeout: 120_000 }),
      page
        .getByRole('alert')
        .filter({ hasText: /\S/ })
        .waitFor({ state: 'visible', timeout: 120_000 }),
    ])

    const alert = (await page.getByRole('alert').textContent())?.trim()
    if (alert) failures.push(`app reported an error: ${alert}`)

    // Not just "a chapter rendered" — the audit has to have produced a verdict.
    // Without this, a build that renders content and audits nothing would pass.
    if (!(await verdict.isVisible().catch(() => false))) {
      failures.push('the compiled chapter rendered no accessibility verdict — the audit did not run')
    }

    /*
     * ...and then all the way to a real file on disk.
     *
     * The unit tests prove the zip writer and the manifest builder in isolation,
     * against synthetic sections. This is the only check that runs the whole
     * chain over REAL publisher markup — fetch, compile, audit, plan, zip — and
     * then hands the bytes to a third-party `unzip` rather than to the writer
     * that produced them. A cartridge verified only by its own writer is marking
     * its own homework.
     *
     * It runs LAST because it navigates to Plan, which takes the Review screen
     * the assertions above read out from under them.
     */
    await page.getByRole('button', { name: /^Plan$/ }).click()
    const download = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: /^Download cartridge/ }).click()
    const file = await download
    const saved = join(tmpdir(), file.suggestedFilename())
    await file.saveAs(saved)

    if (!/\.imscc$/.test(file.suggestedFilename())) {
      failures.push(`cartridge filename is not an .imscc: ${file.suggestedFilename()}`)
    }
    try {
      execFileSync('unzip', ['-t', saved], { stdio: 'pipe' })
      const listed = execFileSync('unzip', ['-Z1', saved], { encoding: 'utf8' }).trim().split('\n')
      if (!listed.includes('imsmanifest.xml')) {
        failures.push(`cartridge has no imsmanifest.xml (has: ${listed.slice(0, 5).join(', ')})`)
      }
      const pages = listed.filter((n) => n.startsWith('wiki_content/'))
      // One page would mean a chapter collapsed into a single resource, which is
      // the modelling error the Plan screen exists to have got right.
      if (pages.length < 2) {
        failures.push(`cartridge has ${pages.length} page(s); a real chapter has one per section`)
      }
      const manifest = execFileSync('unzip', ['-p', saved, 'imsmanifest.xml'], { encoding: 'utf8' })
      if (!manifest.includes('imsccv1p1')) failures.push('manifest is not CC 1.1')
      /*
       * The marker, guarded end to end because losing it is SILENT: the import
       * still succeeds, still builds the modules, still stores every byte — and
       * creates no pages at all. That is how it was found in the first place, by
       * importing into a live Canvas and looking at an empty Pages list.
       */
      if (!listed.includes('course_settings/canvas_export.txt')) {
        failures.push('cartridge has no canvas_export.txt — Canvas will import pages as file attachments')
      }
      // Shipping the marker is not enough; Canvas finds it through the manifest.
      // Measured: without this element every page imports as a file attachment.
      if (!manifest.includes('learning-application-resource')) {
        failures.push('manifest does not declare course_settings — Canvas will import pages as file attachments')
      }
      const moduleMeta = execFileSync('unzip', ['-p', saved, 'course_settings/module_meta.xml'], { encoding: 'utf8' })
      const wikiItems = (moduleMeta.match(/<content_type>WikiPage<\/content_type>/g) ?? []).length
      if (wikiItems !== pages.length) {
        failures.push(`module_meta declares ${wikiItems} WikiPage items for ${pages.length} pages`)
      }
      for (const path of pages) {
        if (!manifest.includes(path)) failures.push(`manifest does not reference ${path}`)
      }
    } catch (e) {
      failures.push(`the downloaded cartridge is not a readable zip: ${e.message}`)
    } finally {
      rmSync(saved, { force: true })
    }
  } catch (e) {
    failures.push(`driving the built app failed: ${e.message}`)
  }

  for (const e of consoleErrors) failures.push(`uncaught error in the page: ${e}`)

  await browser.close()
  await new Promise((r) => server.close(r))

  if (failures.length) {
    console.error(`\ndist smoke test FAILED (${failures.length}):`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log('dist smoke test passed: parser WASM stays lazy, and the built bundle compiles and audits a chapter.')
}

await main()
