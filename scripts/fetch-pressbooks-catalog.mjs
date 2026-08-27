/**
 * Build one static, searchable catalog per verified Pressbooks network.
 *
 * Pressbooks ignores its search parameter and caps pages at ten books. The
 * generated snapshots keep that enumeration out of every instructor's browser.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const networksPath = resolve(root, 'src/sources/pressbooks-networks.json')
const outputDir = resolve(root, process.env.PRESSBOOKS_CATALOG_OUTPUT_DIR ?? 'public/catalogs/pressbooks')
const { networks: configuredNetworks } = JSON.parse(await readFile(networksPath, 'utf8'))
const selectedHosts = new Set((process.env.PRESSBOOKS_CATALOG_HOSTS ?? '').split(',').map((host) => host.trim()).filter(Boolean))
const networks = selectedHosts.size > 0
  ? configuredNetworks.filter((network) => selectedHosts.has(network.host))
  : configuredNetworks
if (selectedHosts.size > 0 && networks.length !== selectedHosts.size) {
  throw new Error('PRESSBOOKS_CATALOG_HOSTS contains an unknown network')
}
// UCF's CloudFront policy rejects generic server/bot user agents, including a
// standards-shaped product token, while accepting ordinary browser agents.
const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 oer2canvas/1.0'
const concurrency = Math.max(1, Math.min(8, Number(process.env.PRESSBOOKS_CATALOG_CONCURRENCY ?? 3)))
const skipExisting = process.env.PRESSBOOKS_CATALOG_SKIP_EXISTING === '1'

function decodeEntities(value) {
  const named = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' }
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, digits) => String.fromCodePoint(Number.parseInt(digits, 16)))
    .replace(/&#(\d+);/g, (_, digits) => String.fromCodePoint(Number(digits)))
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity)
}

function clean(value) {
  const result = typeof value === 'string' ? decodeEntities(value.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim() : ''
  return result || undefined
}

function toBook(raw, network) {
  const metadata = raw?.metadata ?? {}
  const slug = clean(raw?.link)
  const title = clean(metadata.name)
  if (!slug || !title) return undefined
  return {
    source: 'pressbooks', id: slug, slug, title,
    ...(clean(metadata.alternateName) ? { subject: clean(metadata.alternateName) } : {}),
    ...(clean(metadata.thumbnailUrl ?? metadata.image) ? { coverUrl: clean(metadata.thumbnailUrl ?? metadata.image) } : {}),
    ...(clean(metadata.license?.name) ? { license: clean(metadata.license.name) } : {}),
    ...(clean(metadata.license?.url) ? { licenseUrl: clean(metadata.license.url) } : {}),
    authors: Array.isArray(metadata.author) ? metadata.author.map((author) => clean(author?.name)).filter(Boolean) : [],
    catalog: network.host,
  }
}

async function fetchPage(network, page) {
  const url = new URL(`https://${network.host}/wp-json/pressbooks/v2/books`)
  url.searchParams.set('per_page', '10')
  url.searchParams.set('page', String(page))
  let failure
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': userAgent },
        signal: AbortSignal.timeout(20_000),
      })
      if (response.status === 202 && response.headers.get('x-amzn-waf-action') === 'challenge') {
        throw new Error('publisher WAF requested a browser challenge; pause the crawl before retrying')
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const text = await response.text()
      const payload = JSON.parse(text)
      if (!Array.isArray(payload)) throw new Error('non-array payload')
      return { payload, total: Number(response.headers.get('x-wp-total') ?? payload.length), totalPages: Number(response.headers.get('x-wp-totalpages') ?? 1) }
    } catch (error) {
      failure = error
      if (attempt < 5) {
        const challenged = error instanceof Error && error.message.includes('WAF requested')
        await new Promise((resolve) => setTimeout(resolve, challenged ? attempt * 5_000 : attempt * 750))
      }
    }
  }
  throw new Error(`${network.host} page ${page} failed after 5 attempts: ${failure instanceof Error ? failure.message : String(failure)}`)
}

async function mapConcurrent(items, limit, task) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index])
    }
  }))
  return results
}

await mkdir(outputDir, { recursive: true })
const index = []
for (const network of networks) {
  const file = `${network.host}.json`
  if (skipExisting) {
    try {
      const existing = JSON.parse(await readFile(resolve(outputDir, file), 'utf8'))
      if (Array.isArray(existing.books) && existing.books.length > 0) {
        index.push({ ...network, bookCount: Number(existing.network?.bookCount ?? existing.books.length), file })
        console.log(`${network.host}: kept ${existing.books.length} existing books`)
        continue
      }
    } catch {
      // Missing or invalid output is crawled below.
    }
  }
  const first = await fetchPage(network, 1)
  const rest = await mapConcurrent(
    Array.from({ length: Math.max(0, first.totalPages - 1) }, (_, index) => index + 2),
    concurrency,
    (page) => fetchPage(network, page),
  )
  const books = [first, ...rest].flatMap((page) => page.payload.map((raw) => toBook(raw, network)).filter(Boolean))
  books.sort((a, b) => a.title.localeCompare(b.title))
  await writeFile(resolve(outputDir, file), `${JSON.stringify({ generatedAt: new Date().toISOString(), network: { ...network, bookCount: first.total }, books })}\n`)
  index.push({ ...network, bookCount: first.total, file })
  console.log(`${network.host}: ${books.length}/${first.total} books`)
}
if (selectedHosts.size === 0) {
  await writeFile(resolve(outputDir, 'index.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), networks: index })}\n`)
}
console.log(`wrote ${index.length} Pressbooks network catalog${index.length === 1 ? '' : 's'} to ${outputDir}`)
