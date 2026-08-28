/**
 * Live Canvas evidence run for the embedded-image probes (document-import issue 07).
 *
 *   CANVAS_BASE_URL=https://canvas.example.edu
 *   CANVAS_TOKEN=<token that may create and delete courses in a disposable account>
 *
 *   npm run probe:canvas-images:run -- [--keep-courses] [--account <id>] [--out <dir>]
 *
 * This module only OBSERVES. Every pass/fail rule and the winning-shape decision
 * lives in `canvas-image-probe-evidence.mjs`, so the collector can never quietly
 * lower the bar for a Canvas behavior it did not anticipate.
 *
 * Per variant it drives the runbook in `docs/canvas-image-probes/README.md`:
 * a clean course per variant, import, stored HTML, Files placement, browser
 * rendering with natural sizes, a same-cartridge reimport, a course copy into a
 * second clean course, a Canvas export, and a clean import of that export into a
 * third course.
 *
 * Safety: it only ever deletes courses it created in this run, tracked by id, and
 * it refuses to touch a course it did not create. `--keep-courses` leaves
 * everything in place for manual inspection.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { validateCanvasImageProbeDirectory } from './canvas-image-probes.mjs'
import { EXPECTED_PAGE_IMAGES, EXPECTED_PAGE_KEYS, decideWinner, renderWorksheet } from './canvas-image-probe-evidence.mjs'

const COURSE_PREFIX = 'oer2canvas image probe'
const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 10 * 60 * 1000

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
/** Evidence is committed, so paths in it must not carry a home directory. */
const repoRelative = (path) => relative(process.cwd(), path) || path
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** `01-single-image.html` and `/courses/1/pages/01-single-image` both key on this. */
export function pageKeyFromCanvasUrl(url) {
  return String(url ?? '').split('/').at(-1).replace(/\.html$/, '').toLowerCase()
}

/**
 * Ordered `<img>` observations from stored Canvas HTML. Canvas rewrites the
 * packaged `$IMS-CC-FILEBASE$` token into a course file URL on import, so the
 * numeric file id here is the only reliable way to tell whether two pages ended
 * up sharing one Canvas File.
 */
export function parseStoredImages(html) {
  const images = []
  for (const tag of String(html ?? '').match(/<img\b[^>]*>/gi) ?? []) {
    const src = tag.match(/\bsrc\s*=\s*"([^"]*)"|\bsrc\s*=\s*'([^']*)'/i)
    const alt = tag.match(/\balt\s*=\s*"([^"]*)"|\balt\s*=\s*'([^']*)'/i)
    const value = src ? (src[1] ?? src[2]) : ''
    const fileId = value.match(/\/files\/(\d+)/)
    images.push({
      src: value,
      alt: alt ? (alt[1] ?? alt[2]) : null,
      fileId: fileId ? fileId[1] : null,
    })
  }
  return images
}

export class Canvas {
  constructor(baseUrl, token) {
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.token = token
  }

  /**
   * Retries only GET. A POST that fails at the connection layer is ambiguous —
   * Canvas may well have created the course or migration before the socket
   * dropped — and re-sending it would either duplicate a course or, worse, start
   * a second migration and silently corrupt the evidence. GETs carry no such
   * risk, and the transient failures this run actually hits are reads.
   */
  async fetchWithRetry(url, init, { attempts = 4 } = {}) {
    let lastError
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const response = await fetch(url, init)
        const retryable = response.status === 429 || response.status >= 500
        if (!retryable || (init.method ?? 'GET') !== 'GET' || attempt === attempts) return response
        lastError = new Error(`HTTP ${response.status}`)
      } catch (error) {
        lastError = error
        if ((init.method ?? 'GET') !== 'GET' || attempt === attempts) throw error
      }
      await sleep(POLL_INTERVAL_MS * attempt)
      console.error(`  retrying ${(init.method ?? 'GET')} ${url} after ${lastError.message} (attempt ${attempt + 1}/${attempts})`)
    }
    throw lastError
  }

  async request(path, { method = 'GET', json, form, raw = false } = {}) {
    const headers = { authorization: `Bearer ${this.token}` }
    let body
    if (json !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(json)
    } else if (form !== undefined) {
      headers['content-type'] = 'application/x-www-form-urlencoded'
      body = form.toString()
    }
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const response = await this.fetchWithRetry(url, { method, headers, ...(body ? { body } : {}) })
    if (raw) return response
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status}: ${text.slice(0, 400)}`)
    if (!text) return null
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${method} ${path}: Canvas returned non-JSON content`)
    }
  }

  /** Follows Canvas's `Link: rel="next"` pagination rather than trusting one page. */
  async paginate(path) {
    const collected = []
    let next = `${this.baseUrl}${path}${path.includes('?') ? '&' : '?'}per_page=100`
    while (next) {
      const response = await this.fetchWithRetry(next, { headers: { authorization: `Bearer ${this.token}` } })
      const text = await response.text()
      if (!response.ok) throw new Error(`GET ${next}: HTTP ${response.status}: ${text.slice(0, 300)}`)
      collected.push(...JSON.parse(text))
      const link = response.headers.get('link') ?? ''
      const match = link.split(',').find((part) => /rel="next"/.test(part))
      next = match ? match.match(/<([^>]+)>/)?.[1] ?? null : null
    }
    return collected
  }

  async poll(path, isDone, label) {
    const deadline = Date.now() + POLL_TIMEOUT_MS
    let last
    while (Date.now() < deadline) {
      last = await this.request(path)
      if (isDone(last)) return last
      await sleep(POLL_INTERVAL_MS)
    }
    throw new Error(`${label} did not settle within ${POLL_TIMEOUT_MS / 1000}s (last state ${last?.workflow_state})`)
  }
}

export async function createCourse(canvas, accountId, name) {
  const form = new URLSearchParams({
    'course[name]': name,
    'course[course_code]': name,
    'offer': 'true',
  })
  const course = await canvas.request(`/api/v1/accounts/${accountId}/courses`, { method: 'POST', form })
  if (!course?.id) throw new Error(`Canvas did not return an id for course “${name}”`)
  return course
}

/** Canvas's two-step file upload, then the migration it feeds. */
export async function importCartridge(canvas, courseId, filePath, filename) {
  const bytes = readFileSync(filePath)
  const form = new URLSearchParams({
    migration_type: 'common_cartridge_importer',
    'pre_attachment[name]': filename,
    'pre_attachment[size]': String(bytes.byteLength),
  })
  const migration = await canvas.request(`/api/v1/courses/${courseId}/content_migrations`, { method: 'POST', form })
  const pre = migration?.pre_attachment
  if (!pre?.upload_url) throw new Error('Canvas did not return an upload target for the cartridge')

  const upload = new FormData()
  for (const [key, value] of Object.entries(pre.upload_params ?? {})) upload.append(key, String(value))
  upload.append('file', new Blob([bytes], { type: 'application/zip' }), filename)
  const uploaded = await fetch(pre.upload_url, { method: 'POST', body: upload, redirect: 'follow' })
  if (!uploaded.ok) throw new Error(`cartridge upload: HTTP ${uploaded.status}`)

  const settled = await canvas.poll(
    `/api/v1/courses/${courseId}/content_migrations/${migration.id}`,
    (state) => ['completed', 'failed', 'waiting_for_select'].includes(state?.workflow_state),
    `cartridge import into course ${courseId}`,
  )
  const issues = await canvas.paginate(`/api/v1/courses/${courseId}/content_migrations/${migration.id}/migration_issues`)
  return {
    migrationId: migration.id,
    workflowState: settled.workflow_state,
    migrationIssues: issues.map((issue) => ({ issue_type: issue.issue_type, description: issue.description })),
  }
}

async function copyCourse(canvas, sourceCourseId, destinationCourseId) {
  const form = new URLSearchParams({
    migration_type: 'course_copy_importer',
    'settings[source_course_id]': String(sourceCourseId),
  })
  const migration = await canvas.request(`/api/v1/courses/${destinationCourseId}/content_migrations`, { method: 'POST', form })
  const settled = await canvas.poll(
    `/api/v1/courses/${destinationCourseId}/content_migrations/${migration.id}`,
    (state) => ['completed', 'failed'].includes(state?.workflow_state),
    `course copy into course ${destinationCourseId}`,
  )
  return { workflowState: settled.workflow_state }
}

async function exportCourse(canvas, courseId, outputPath) {
  const form = new URLSearchParams({ export_type: 'common_cartridge' })
  const started = await canvas.request(`/api/v1/courses/${courseId}/content_exports`, { method: 'POST', form })
  const settled = await canvas.poll(
    `/api/v1/courses/${courseId}/content_exports/${started.id}`,
    (state) => ['exported', 'failed'].includes(state?.workflow_state),
    `course export of ${courseId}`,
  )
  if (settled.workflow_state !== 'exported' || !settled.attachment?.url) {
    return { workflowState: settled.workflow_state }
  }
  const download = await fetch(settled.attachment.url, { headers: { authorization: `Bearer ${canvas.token}` } })
  if (!download.ok) throw new Error(`download export: HTTP ${download.status}`)
  const bytes = Buffer.from(await download.arrayBuffer())
  writeFileSync(outputPath, bytes)
  return {
    workflowState: settled.workflow_state,
    // Absolute for internal reads (unzip, reimport); the committed record gets
    // `archivePath` instead so evidence carries no home directory.
    path: outputPath,
    archivePath: repoRelative(outputPath),
    sha256: sha256(bytes),
    bytes: bytes.byteLength,
  }
}

/**
 * Structural read of a Canvas-produced export: integrity, then whether every
 * page image reference actually resolves to a packaged archive entry. A
 * reference that survives as text but points at nothing is a silent break.
 */
function inspectExport(path) {
  let unzipOk = true
  try {
    execFileSync('unzip', ['-t', path], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch {
    unzipOk = false
  }
  const entries = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n').filter(Boolean)
  const entrySet = new Set(entries)
  const pageReferences = []
  for (const entry of entries.filter((name) => /\.html?$/i.test(name))) {
    const html = execFileSync('unzip', ['-p', path, entry], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    for (const image of parseStoredImages(html)) {
      const cleaned = image.src
        .replace(/^\$IMS-CC-FILEBASE\$\//, '')
        .replace(/^\$CANVAS_COURSE_REFERENCE\$\/file_ref\//, '')
        .split('?')[0]
      const decoded = decodeURIComponent(cleaned)
      pageReferences.push({
        entry,
        src: image.src,
        alt: image.alt,
        resolvesToPackagedFile:
          entrySet.has(decoded) ||
          entrySet.has(`web_resources/${decoded}`) ||
          // Canvas rewrites into its own file-ref token, whose target is declared
          // in the manifest rather than sitting at a literal archive path.
          /^\$CANVAS_(COURSE_REFERENCE|OBJECT_REFERENCE)\$/.test(image.src),
      })
    }
  }
  const manifest = entrySet.has('imsmanifest.xml')
    ? execFileSync('unzip', ['-p', path, 'imsmanifest.xml'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    : ''
  return {
    unzipOk,
    entryCount: entries.length,
    pageReferences,
    manifestResourceTypes: [...new Set(manifest.match(/type="([^"]+)"/g) ?? [])].map((match) => match.slice(6, -1)),
  }
}

export async function readCourseContent(canvas, courseId) {
  const pageList = await canvas.paginate(`/api/v1/courses/${courseId}/pages`)
  const pages = []
  for (const summary of pageList) {
    const full = await canvas.request(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(summary.url)}`)
    pages.push({
      key: pageKeyFromCanvasUrl(summary.url),
      canvasUrl: summary.url,
      title: summary.title,
      storedHtml: full?.body ?? '',
      storedImages: parseStoredImages(full?.body ?? ''),
    })
  }
  const folders = await canvas.paginate(`/api/v1/courses/${courseId}/folders`)
  const folderPaths = new Map(folders.map((folder) => [folder.id, folder.full_name]))
  const files = (await canvas.paginate(`/api/v1/courses/${courseId}/files`)).map((file) => ({
    id: String(file.id),
    displayName: file.display_name,
    filename: file.filename,
    size: file.size,
    uuid: file.uuid,
    contentType: file['content-type'] ?? file.content_type,
    folderPath: folderPaths.get(file.folder_id) ?? null,
  }))
  return { pages, files }
}

/**
 * Render every probe page in a real browser. Natural size is the point: a stored
 * `src` proves nothing about whether Canvas served decodable bytes, and Canvas is
 * documented to store one value while rendering another.
 */
export async function renderPages(context, baseUrl, courseId, pages, evidenceDirectory, label) {
  const page = await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  const failedRequests = []
  page.on('requestfailed', (request) => failedRequests.push(`${request.url()} ${request.failure()?.errorText ?? ''}`))

  try {
    for (const stored of pages) {
      await page.goto(`${baseUrl}/courses/${courseId}/pages/${encodeURIComponent(stored.canvasUrl)}`, {
        waitUntil: 'domcontentloaded',
        timeout: 60_000,
      })
      // Canvas holds long-polling connections open, so `networkidle` never
      // arrives. Wait for the content itself instead.
      await page.waitForSelector('.show-content, .user_content, #content', { timeout: 60_000 })

      // Canvas adds `loading="lazy"`, so an image below the fold never starts
      // loading and would be measured as broken purely because of viewport size.
      await page.evaluate(() => {
        for (const image of document.querySelectorAll('img')) image.loading = 'eager'
      })

      // Wait for the EXPECTED number of images, not merely for "every image
      // present is complete": before Canvas renders the body there are zero
      // images, and `[].every(...)` is vacuously true, which silently measures an
      // empty page as a fully settled one. On timeout, record the DOM as it
      // actually is — an image Canvas really did drop is evidence, not an error.
      //
      // Ruling 13: the count comes from THIS PAGE'S OWN stored HTML
      // (`readCourseContent` already parses `storedImages` out of the Canvas
      // API response for every page, probe or not), never from
      // `EXPECTED_PAGE_IMAGES` keyed by a fixed set of probe page names. A
      // page whose key isn't one of the twelve probe variants — any cartridge
      // this repo's own pipeline produces, for instance — would silently
      // resolve that lookup to `undefined?.length ?? 0`, making the vacuous-
      // truth case above the ACTUAL case taken rather than the edge case the
      // comment above warns about: `waitForFunction` would then return the
      // instant the content container exists, before Canvas has painted the
      // page body, and a page that really does have an image would be scored
      // as "settled" with zero of them in the DOM. That is exactly what broke
      // `scripts/verify-canvas-image-tracer.mjs`'s first live run against a
      // packaged-image cartridge outside the probe suite. `storedImages`
      // reflects what the Canvas API already told us this page contains, so
      // deriving the wait target from it works for the twelve probe pages
      // (their stored HTML always carries one `<img>` per
      // `EXPECTED_PAGE_IMAGES` entry, unresolved-`src` variants included —
      // the tag is present even when what it points at is broken) AND for any
      // other page from any other cartridge, with no probe-suite dependency
      // left in this function at all.
      const expectedImageCount = stored.storedImages?.length ?? 0
      try {
        await page.waitForFunction(
          (count) => {
            const scope = document.querySelector('.show-content, .user_content, #content')
            if (!scope) return false
            const images = [...scope.querySelectorAll('img')]
            return images.length >= count && images.every((image) => image.complete)
          },
          expectedImageCount,
          { timeout: 60_000 },
        )
      } catch {
        stored.renderSettleTimedOut = true
      }
      stored.renderedImages = await page.evaluate(() => {
        const scope = document.querySelector('.show-content, .user_content, #content') ?? document.body
        return [...scope.querySelectorAll('img')].map((image) => ({
          currentSrc: image.currentSrc || image.src,
          alt: image.getAttribute('alt'),
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          complete: image.complete,
        }))
      })
      await page.screenshot({
        path: resolve(evidenceDirectory, `${label}-${stored.key}.png`),
        fullPage: true,
      })
    }
  } finally {
    await page.close()
  }
  return { consoleErrors, failedRequests }
}

const allRendered = (pages) =>
  pages.length === EXPECTED_PAGE_KEYS.length &&
  EXPECTED_PAGE_KEYS.every((key) => {
    const page = pages.find((candidate) => candidate.key === key)
    const rendered = page?.renderedImages ?? []
    return (
      rendered.length === EXPECTED_PAGE_IMAGES[key].length &&
      rendered.every((image) => image.naturalWidth > 0 && image.naturalHeight > 0)
    )
  })

const altIntact = (pages) =>
  EXPECTED_PAGE_KEYS.every((key) => {
    const rendered = pages.find((candidate) => candidate.key === key)?.renderedImages ?? []
    return EXPECTED_PAGE_IMAGES[key].every((expected, index) => rendered[index]?.alt === expected.alt)
  })

/** File ids Canvas assigned to a named fixture, read from the rewritten stored HTML. */
function fileIdsFor(pages, pageKey, filename) {
  const expectations = EXPECTED_PAGE_IMAGES[pageKey] ?? []
  const stored = pages.find((page) => page.key === pageKey)?.storedImages ?? []
  return expectations
    .map((expectation, index) => (expectation.filename === filename ? stored[index]?.fileId ?? null : null))
    .filter((id) => id !== null)
}

async function runVariant(canvas, browserContext, options, probe, evidenceDirectory) {
  const { accountId, baseUrl, probeDirectory, createdCourses } = options
  const cartridge = resolve(probeDirectory, probe.filename)
  const stamp = Date.now()

  const source = await createCourse(canvas, accountId, `${COURSE_PREFIX} ${probe.id} source ${stamp}`)
  createdCourses.push(source.id)
  const importResult = await importCartridge(canvas, source.id, cartridge, probe.filename)
  const first = await readCourseContent(canvas, source.id)
  const render = await renderPages(browserContext, baseUrl, source.id, first.pages, evidenceDirectory, `${probe.id}-source`)

  const sharedIds = [
    ...fileIdsFor(first.pages, '02-shared-image-a', 'shared.gif'),
    ...fileIdsFor(first.pages, '03-shared-image-b', 'shared.gif'),
  ]
  const duplicateIds = [
    ...fileIdsFor(first.pages, '04-raster-and-duplicates', 'duplicate-a.png'),
    ...fileIdsFor(first.pages, '04-raster-and-duplicates', 'duplicate-b.png'),
  ]

  // Step 7 of the runbook: the same cartridge again, into the same course.
  const secondImport = await importCartridge(canvas, source.id, cartridge, probe.filename)
  const second = await readCourseContent(canvas, source.id)
  await renderPages(browserContext, baseUrl, source.id, second.pages, evidenceDirectory, `${probe.id}-reimport`)

  // Step 8: copy the module into a second clean course.
  const copyTarget = await createCourse(canvas, accountId, `${COURSE_PREFIX} ${probe.id} copy ${stamp}`)
  createdCourses.push(copyTarget.id)
  const copyResult = await copyCourse(canvas, source.id, copyTarget.id)
  const copied = await readCourseContent(canvas, copyTarget.id)
  await renderPages(browserContext, baseUrl, copyTarget.id, copied.pages, evidenceDirectory, `${probe.id}-copy`)
  const copiedSharedIds = [
    ...fileIdsFor(copied.pages, '02-shared-image-a', 'shared.gif'),
    ...fileIdsFor(copied.pages, '03-shared-image-b', 'shared.gif'),
  ]

  // Step 9: export the imported course and inspect the archive.
  const exportPath = resolve(evidenceDirectory, `${probe.id}-reexport.imscc`)
  const exported = await exportCourse(canvas, source.id, exportPath)
  const exportInspection = exported.path ? inspectExport(exported.path) : {}

  // Step 10: import that export into a third clean course.
  let roundTrip = {}
  if (exported.path) {
    const roundTripCourse = await createCourse(canvas, accountId, `${COURSE_PREFIX} ${probe.id} roundtrip ${stamp}`)
    createdCourses.push(roundTripCourse.id)
    const roundTripImport = await importCartridge(canvas, roundTripCourse.id, exported.path, `${probe.id}-reexport.imscc`)
    const content = await readCourseContent(canvas, roundTripCourse.id)
    await renderPages(browserContext, baseUrl, roundTripCourse.id, content.pages, evidenceDirectory, `${probe.id}-roundtrip`)
    roundTrip = {
      courseId: roundTripCourse.id,
      workflowState: roundTripImport.workflowState,
      pageCount: content.pages.length,
      pages: content.pages,
      files: content.files,
      allImagesRendered: allRendered(content.pages),
      altTextIntact: altIntact(content.pages),
    }
  }

  return {
    id: probe.id,
    sha256: probe.sha256,
    sourceCourseId: source.id,
    import: importResult,
    pages: first.pages,
    files: first.files,
    consoleErrors: render.consoleErrors,
    failedRequests: render.failedRequests,
    sharedImage: { pageAFileId: sharedIds[0] ?? null, pageBFileId: sharedIds[1] ?? null },
    duplicateBytes: { fileIds: duplicateIds },
    reimport: {
      workflowState: secondImport.workflowState,
      pagesBefore: first.pages.length,
      pagesAfter: second.pages.length,
      filesBefore: first.files.length,
      filesAfter: second.files.length,
      allImagesRendered: allRendered(second.pages),
    },
    shareCopy: {
      destinationCourseId: copyTarget.id,
      workflowState: copyResult.workflowState,
      pageCount: copied.pages.length,
      pages: copied.pages,
      files: copied.files,
      allImagesRendered: allRendered(copied.pages),
      sharedResolvesToOneFile:
        copiedSharedIds.length === 2 && copiedSharedIds[0] === copiedSharedIds[1],
    },
    reexport: { ...exported, path: exported.archivePath, ...exportInspection },
    reexportImport: roundTrip,
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const flag = (name) => {
    const index = argv.indexOf(name)
    return index === -1 ? undefined : argv[index + 1]
  }
  const keepCourses = argv.includes('--keep-courses')
  const probeDirectory = resolve(flag('--probes') ?? 'artifacts/canvas-image-probes')
  const outputRoot = resolve(flag('--out') ?? 'artifacts/canvas-image-probe-evidence')

  // Re-render a worksheet from an existing run.json. The rules can be corrected
  // after a run without spending another twelve courses to re-observe Canvas,
  // because run.json holds raw observations and no verdicts.
  const render = flag('--render')
  if (render) {
    const run = JSON.parse(readFileSync(resolve(render, 'run.json'), 'utf8'))
    const decision = decideWinner(run)
    writeFileSync(resolve(render, 'WORKSHEET.md'), renderWorksheet(run, decision))
    console.log(`Re-rendered ${resolve(render, 'WORKSHEET.md')}`)
    for (const variant of decision.variants) {
      console.log(`  ${variant.id}: ${variant.qualifies ? 'QUALIFIES' : `blocked by ${[...variant.failedDimensions, ...variant.unmeasuredDimensions].join(', ')}`}`)
    }
    console.log(decision.productionUnblocked ? `\nWINNER: ${decision.winner.id}` : '\nNO WINNER')
    return
  }

  const baseUrl = required('CANVAS_BASE_URL').replace(/\/$/, '')
  const canvas = new Canvas(baseUrl, required('CANVAS_TOKEN'))

  // Never test a cartridge that is not the one recorded in probe-index.json.
  const allProbes = validateCanvasImageProbeDirectory(probeDirectory)
  console.log(`Validated ${allProbes.length} probe cartridges in ${probeDirectory}`)
  // `--only` narrows a re-run to one shape. The decision still reports every
  // other variant as missing, so a narrowed run can never look like a full one.
  const only = flag('--only')
  const probes = only ? allProbes.filter((probe) => probe.id === only) : allProbes
  if (only && probes.length === 0) throw new Error(`--only ${only} matched no probe variant`)

  const self = await canvas.request('/api/v1/users/self')
  const accountId = flag('--account') ?? (await canvas.paginate('/api/v1/accounts'))[0]?.id
  if (!accountId) throw new Error('no Canvas account is visible to this token; pass --account <id>')

  const startedAt = new Date().toISOString()
  const evidenceDirectory = resolve(outputRoot, startedAt.replace(/[:.]/g, '-'))
  mkdirSync(evidenceDirectory, { recursive: true })

  const browser = await chromium.launch()
  // Captured before close: the identity block below is built after cleanup.
  const browserVersion = browser.version()
  // A tall viewport keeps the probe figures on screen; lazy loading is also
  // disabled per page above, so neither alone decides the measurement.
  const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 2000 } })
  const createdCourses = []
  const variants = []
  let failure

  try {
    // A Canvas API token is not a browser session. This endpoint trades one for
    // the other so rendering is measured as a signed-in user actually sees it.
    const session = await canvas.request(`/api/v1/login/session_token?return_to=${encodeURIComponent(`${baseUrl}/`)}`)
    const login = await context.newPage()
    await login.goto(session.session_url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await login.close()

    for (const probe of probes) {
      console.log(`\n=== ${probe.id} ===`)
      variants.push(
        await runVariant(
          canvas,
          context,
          { accountId, baseUrl, probeDirectory, createdCourses },
          probe,
          evidenceDirectory,
        ),
      )
      console.log(`recorded ${probe.id}`)
    }
  } catch (error) {
    failure = error
  } finally {
    await browser.close()
    if (!keepCourses) {
      for (const courseId of createdCourses) {
        try {
          await canvas.request(`/api/v1/courses/${courseId}?event=delete`, { method: 'DELETE' })
        } catch (error) {
          console.error(`cleanup course ${courseId}: ${error.message}`)
        }
      }
    } else {
      console.log(`\nKept ${createdCourses.length} course(s): ${createdCourses.join(', ')}`)
    }
  }

  const run = {
    identity: {
      operator: self?.name ?? 'unknown',
      startedAt,
      canvasBaseUrl: baseUrl,
      canvasRelease: 'see evidence/run.json',
      browser: `Chromium ${browserVersion} (Playwright)`,
      sourceCourses: variants.map((variant) => variant.sourceCourseId).join(', '),
      copyCourses: variants.map((variant) => variant.shareCopy?.destinationCourseId).filter(Boolean).join(', '),
      roundTripCourses: variants.map((variant) => variant.reexportImport?.courseId).filter(Boolean).join(', '),
      probeIndex: repoRelative(resolve(probeDirectory, 'probe-index.json')),
    },
    expectedVariantIds: allProbes.map((probe) => probe.id),
    secondEnvironment: process.env.CANVAS_SECOND_ENVIRONMENT?.trim() || null,
    variants,
  }

  writeFileSync(resolve(evidenceDirectory, 'run.json'), `${JSON.stringify(run, null, 2)}\n`)
  const decision = decideWinner(run)
  writeFileSync(resolve(evidenceDirectory, 'WORKSHEET.md'), renderWorksheet(run, decision))

  console.log(`\nEvidence written to ${evidenceDirectory}`)
  for (const variant of decision.variants) {
    const state = variant.qualifies ? 'QUALIFIES' : `blocked by ${[...variant.failedDimensions, ...variant.unmeasuredDimensions].join(', ') || 'media results'}`
    console.log(`  ${variant.id}: ${state}`)
  }
  console.log(
    decision.productionUnblocked
      ? `\nWINNER: ${decision.winner.id}`
      : '\nNO WINNER — production packaged-image work remains blocked.',
  )

  if (failure) throw failure
  if (!decision.complete) process.exitCode = 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exitCode = 1
  })
}
