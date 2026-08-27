/**
 * Read-only production smoke check.
 *
 * Usage:
 *   PRODUCTION_ORIGIN=https://oer2canvas.johnnyrobot.dev npm run verify:production
 *
 * It deliberately does not send a Canvas token or write publisher data. The checks
 * verify the deployment surface, all catalog families, and read-only relay paths.
 */
const origin = (process.env.PRODUCTION_ORIGIN ?? 'https://oer2canvas.johnnyrobot.dev').replace(/\/$/, '')
const ROBOTS_POLICY = 'noindex, nofollow, noarchive, nosnippet, noimageindex'

async function expectOk(path, label) {
  const response = await fetch(`${origin}${path}`)
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`)
  return response
}

function expectNoIndex(response, label) {
  if (response.headers.get('x-robots-tag') !== ROBOTS_POLICY) {
    throw new Error(`${label}: x-robots-tag header is missing or incorrect`)
  }
}

function expectRelaySafe(response, label) {
  if (response.headers.get('cache-control') !== 'no-store') {
    throw new Error(`${label}: relay response is cacheable`)
  }
  if (!response.headers.get('content-security-policy')?.includes('sandbox')) {
    throw new Error(`${label}: relay response is missing a sandbox CSP`)
  }
  if (!response.headers.get('content-disposition')?.includes('attachment')) {
    throw new Error(`${label}: relay response is missing attachment delivery`)
  }
}

async function main() {
  const appResponse = await expectOk('/', 'app')
  expectNoIndex(appResponse, 'app')
  const html = await appResponse.text()
  if (!html.includes('<title>oer2canvas</title>')) throw new Error('app: title is missing')
  if (!html.includes(`<meta name="robots" content="${ROBOTS_POLICY}"`)) {
    throw new Error('app: robots noindex metadata is missing')
  }
  for (const [name, expected] of [
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'DENY'],
    ['referrer-policy', 'no-referrer'],
  ]) {
    if (appResponse.headers.get(name) !== expected) {
      throw new Error(`app: ${name} header is missing or incorrect`)
    }
  }

  const entryPath = html.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1]
  if (!entryPath) throw new Error('app: hashed JavaScript entry is missing')
  const entryResponse = await expectOk(entryPath, 'hashed JavaScript entry')
  expectNoIndex(entryResponse, 'hashed JavaScript entry')
  const entryCache = entryResponse.headers.get('cache-control') ?? ''
  if (!entryCache.includes('max-age=31536000') || !entryCache.includes('immutable')) {
    throw new Error('hashed JavaScript entry: immutable cache policy is missing')
  }

  const workerResponse = await expectOk('/sw.js', 'service worker')
  const workerCache = workerResponse.headers.get('cache-control') ?? ''
  if (!workerCache.includes('max-age=0') || !workerCache.includes('must-revalidate') || workerCache.includes('immutable')) {
    throw new Error('service worker: revalidation cache policy is missing')
  }

  const manifestResponse = await expectOk('/manifest.webmanifest', 'manifest')
  expectNoIndex(manifestResponse, 'manifest')
  const manifest = await manifestResponse.json()
  if (!Array.isArray(manifest.icons) || manifest.icons.length < 2) {
    throw new Error('manifest: expected at least two install icons')
  }
  if (manifest.start_url !== '/' || manifest.scope !== '/') {
    throw new Error('manifest: start_url and scope must be /')
  }
  for (const icon of manifest.icons) {
    if (typeof icon?.src !== 'string') throw new Error('manifest: icon source is missing')
    const iconResponse = await expectOk(icon.src, `icon ${icon.src}`)
    if (!iconResponse.headers.get('content-type')?.includes('svg')) {
      throw new Error(`icon ${icon.src}: expected an SVG content type`)
    }
  }

  const libreCatalog = await expectOk('/catalogs/libretexts.json', 'LibreTexts catalog').then((r) => r.json())
  if (!Array.isArray(libreCatalog.books) || libreCatalog.books.length < 1000) {
    throw new Error('LibreTexts catalog: expected at least 1,000 books')
  }
  const pressCatalog = await expectOk('/catalogs/pressbooks/milnepublishing.geneseo.edu.json', 'Pressbooks catalog').then((r) => r.json())
  if (!Array.isArray(pressCatalog.books) || pressCatalog.books.length < 80) {
    throw new Error('Pressbooks catalog: expected at least 80 Milne books')
  }

  const robotsResponse = await expectOk('/robots.txt', 'robots')
  expectNoIndex(robotsResponse, 'robots')
  const robots = await robotsResponse.text()
  if (
    !robots.includes('User-agent: *') ||
    !robots.includes('Content-Signal: search=no, ai-input=no, ai-train=no, use=immediate') ||
    !robots.includes('Allow: /') ||
    /^Sitemap:/im.test(robots)
  ) {
    throw new Error('robots: must expose noindex headers without advertising a sitemap')
  }

  const healthResponse = await expectOk('/healthz', 'health')
  expectNoIndex(healthResponse, 'health')
  const health = await healthResponse.json()
  if (
    health.ok !== true ||
    health.service !== 'oer2canvas-relay' ||
    health.canvasPushEnabled !== false
  ) {
    throw new Error('health: public deployment must report Canvas push disabled')
  }

  const missingTarget = await fetch(`${origin}/relay`)
  if (missingTarget.status !== 400) throw new Error(`relay missing-target guard: HTTP ${missingTarget.status}`)
  expectNoIndex(missingTarget, 'relay missing-target guard')

  const refusedTarget = await fetch(`${origin}/relay?url=${encodeURIComponent('https://example.com/')}`)
  if (refusedTarget.status !== 403) throw new Error(`relay host guard: HTTP ${refusedTarget.status}`)

  const refusedCanvasShape = await fetch(
    `${origin}/relay?url=${encodeURIComponent('https://example.com/api/v1/users/self')}`,
    { headers: { authorization: 'Bearer must-not-travel' } },
  )
  if (refusedCanvasShape.status !== 403) {
    throw new Error(`relay disabled-Canvas guard: HTTP ${refusedCanvasShape.status}`)
  }

  const refusedDelete = await fetch(`${origin}/relay?url=${encodeURIComponent('https://openstax.org/rex/release.json')}`, {
    method: 'DELETE',
  })
  if (refusedDelete.status !== 405) throw new Error(`relay method guard: HTTP ${refusedDelete.status}`)

  const refusedOrigin = await fetch(`${origin}/relay?url=${encodeURIComponent('https://openstax.org/rex/release.json')}`, {
    headers: { origin: 'https://example.com' },
  })
  if (refusedOrigin.status !== 403) throw new Error(`relay origin guard: HTTP ${refusedOrigin.status}`)

  const preflight = await fetch(`${origin}/relay`, {
    method: 'OPTIONS',
    headers: { origin },
  })
  if (preflight.status !== 204) throw new Error(`relay preflight: HTTP ${preflight.status}`)

  // UCF rejects the Workers runtime's default user agent. This one-book read
  // pins the target-specific compatible header used by the relay.
  const pressbooksTarget = 'https://pressbooks.online.ucf.edu/wp-json/pressbooks/v2/books?per_page=1&page=1'
  const pressbooksResponse = await expectOk(`/relay?url=${encodeURIComponent(pressbooksTarget)}`, 'Pressbooks relay')
  expectRelaySafe(pressbooksResponse, 'Pressbooks relay')
  const pressbooks = await pressbooksResponse.json()
  if (!Array.isArray(pressbooks) || pressbooks.length !== 1) throw new Error('Pressbooks relay: unexpected catalog response')

  const libreTarget = 'https://chem.libretexts.org/Bookshelves'
  const libreResponse = await expectOk(`/relay?url=${encodeURIComponent(libreTarget)}`, 'LibreTexts relay')
  expectRelaySafe(libreResponse, 'LibreTexts relay')
  const librePage = await libreResponse.text()
  if (!librePage.includes('mt-content-container')) throw new Error('LibreTexts relay: public hierarchy is missing')

  console.log(`production verification passed for ${origin}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
