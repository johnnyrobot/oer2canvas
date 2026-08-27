import type { Attribution, BookRef, Chapter, Section } from './types'

type PressbooksKind = 'front-matter' | 'chapters' | 'back-matter'

export interface WebBookSection {
  id: string
  title: string
  url?: string
  kind?: PressbooksKind | 'deki' | 'libre-tree'
}

/** A source-neutral outline produced by a public webbook TOC. */
export interface WebBookOutline {
  id: string
  title: string
  sections: WebBookSection[]
}

export interface WebBookClientDeps {
  fetch: typeof globalThis.fetch
  /** Same-origin relay path for publishers that do not send CORS headers. */
  relayUrl?: string
}

export interface WebBookClient {
  fetchOutlines(book: BookRef): Promise<WebBookOutline[]>
  fetchChapter(book: BookRef, outline: WebBookOutline, signal?: AbortSignal): Promise<Chapter>
}

function viaRelay(relayUrl: string | undefined, target: string): string {
  return relayUrl ? `${relayUrl}?url=${encodeURIComponent(target)}` : target
}

async function response(
  fetcher: typeof globalThis.fetch,
  url: string,
  signal?: AbortSignal,
): Promise<Response> {
  let failure: unknown
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal?.throwIfAborted()
    try {
      const result = await fetcher(url, { headers: { accept: 'application/json, text/html;q=0.9' }, ...(signal ? { signal } : {}) })
      if (!result.ok) {
        if (result.status < 500 || attempt === 3) throw new Error(`Source request failed: ${url} (HTTP ${result.status})`)
      } else {
        return result
      }
    } catch (error) {
      failure = error
      if (signal?.aborted || attempt === 3) throw error
    }
    await new Promise((resolve) => setTimeout(resolve, attempt * 250))
  }
  throw failure
}

async function responseText(fetcher: typeof globalThis.fetch, url: string, signal?: AbortSignal): Promise<string> {
  return (await response(fetcher, url, signal)).text()
}

async function responseJson(fetcher: typeof globalThis.fetch, url: string, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    signal?.throwIfAborted()
    const text = await responseText(fetcher, url, signal)
    try {
      return JSON.parse(text)
    } catch {
      if (attempt === 3) throw new Error(`Source returned invalid JSON: ${url}`)
      await new Promise((resolve) => setTimeout(resolve, attempt * 250))
    }
  }
  throw new Error(`Source returned invalid JSON: ${url}`)
}

function normalizeTitle(value: string): string {
  const doc = new DOMParser().parseFromString(value, 'text/html')
  return (doc.documentElement.textContent ?? value).replace(/\s+/g, ' ').trim()
}

function absoluteUrl(raw: string, baseUrl: string): string | undefined {
  if (!raw.trim()) return undefined
  try {
    const url = new URL(raw, baseUrl)
    if (url.protocol !== 'https:') return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function normalizedUrl(raw: string): string {
  try {
    const url = new URL(raw)
    url.hash = ''
    url.search = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return raw.replace(/\/$/, '')
  }
}

function isContentLink(url: string): boolean {
  const path = new URL(url).pathname.toLowerCase()
  return !/\.(?:pdf|epub|zip|png|jpe?g|gif|svg|webp|css|js)$/.test(path) && !url.includes('/@api/deki/')
}

function uniqueLinks(links: { title: string; url: string }[]): { title: string; url: string }[] {
  const seen = new Set<string>()
  return links.filter((link) => {
    if (!link.title || seen.has(link.url)) return false
    seen.add(link.url)
    return true
  })
}

/** Conservative generic parser retained for direct-page fallbacks and fixtures. */
export function parseWebBookToc(
  html: string,
  baseUrl: string,
  bookTitle: string,
  selectors: readonly string[],
): WebBookOutline[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const containers = selectors.flatMap((selector) => Array.from(doc.querySelectorAll(selector)))
  const container = containers[0] ?? doc.body
  const directItems = Array.from(container.querySelectorAll(':scope > ul > li, :scope > ol > li'))
  const sourceItems = directItems.length > 0 ? directItems : Array.from(container.querySelectorAll('li'))
  const outlines: WebBookOutline[] = []

  for (const item of sourceItems) {
    const own = item.querySelector(':scope > a[href]')
    const nested = Array.from(item.querySelectorAll(':scope > ul a[href], :scope > ol a[href]'))
    const links = uniqueLinks(
      (nested.length > 0 ? nested : own ? [own] : [])
        .map((anchor) => {
          const url = absoluteUrl(anchor.getAttribute('href') ?? '', baseUrl)
          return url && isContentLink(url)
            ? { title: normalizeTitle(anchor.textContent ?? ''), url }
            : undefined
        })
        .filter((link): link is { title: string; url: string } => link !== undefined),
    )
    if (links.length === 0) continue
    const title = normalizeTitle(own?.textContent ?? links[0]!.title) || bookTitle
    const chapterUrl = own ? absoluteUrl(own.getAttribute('href') ?? '', baseUrl) : undefined
    const sections = (nested.length > 0 ? links : links.slice(0, 1)).map((link, index) => ({
      id: `${encodeURIComponent(link.url)}:${index}`, title: link.title, url: link.url,
    }))
    outlines.push({ id: encodeURIComponent(chapterUrl ?? title), title, sections })
  }

  if (outlines.length > 0) return outlines
  const flat = uniqueLinks(
    Array.from(container.querySelectorAll('a[href]'))
      .map((anchor) => {
        const url = absoluteUrl(anchor.getAttribute('href') ?? '', baseUrl)
        return url && isContentLink(url) ? { title: normalizeTitle(anchor.textContent ?? ''), url } : undefined
      })
      .filter((link): link is { title: string; url: string } => link !== undefined),
  )
  return flat.length === 0 ? [] : [{
    id: encodeURIComponent(baseUrl),
    title: bookTitle,
    sections: flat.map((link, index) => ({ id: `${encodeURIComponent(link.url)}:${index}`, ...link })),
  }]
}

interface DekiNode {
  id?: string | number
  '@id'?: string | number
  title?: string
  uri?: string | { ui?: string }
  url?: string
  path?: string
  subpages?: unknown
  children?: unknown
  pages?: unknown
  page?: unknown
}

function dekiChildren(node: DekiNode): DekiNode[] {
  const raw = node.subpages ?? node.children ?? node.pages
  if (Array.isArray(raw)) return raw as DekiNode[]
  if (raw && typeof raw === 'object') {
    const page = (raw as { page?: unknown }).page
    if (Array.isArray(page)) return page as DekiNode[]
    if (page && typeof page === 'object') return [page as DekiNode]
  }
  return []
}

function dekiUrl(node: DekiNode, baseUrl: string): string | undefined {
  const uri = typeof node.uri === 'object' ? node.uri.ui : node.uri
  return absoluteUrl(uri ?? node.url ?? node.path ?? '', baseUrl)
}

/** Parse MindTouch's one-or-many tree envelopes into top-level chapters. */
export function parseDekiToc(raw: unknown, baseUrl: string): WebBookOutline[] {
  const envelope = raw && typeof raw === 'object' && 'page' in raw ? (raw as { page: unknown }).page : raw
  const roots = Array.isArray(envelope) ? envelope as DekiNode[] : envelope && typeof envelope === 'object' ? [envelope as DekiNode] : []
  const outlines: WebBookOutline[] = []
  for (const root of roots) {
    const top = dekiChildren(root)
    const chapters = top.length > 0 ? top : [root]
    for (const chapter of chapters) {
      const sections: WebBookSection[] = []
      const visit = (node: DekiNode) => {
        const id = String(node['@id'] ?? node.id ?? '')
        const title = normalizeTitle(node.title ?? '')
        const url = dekiUrl(node, baseUrl)
        if (id && title && url) sections.push({ id, title, url })
        for (const child of dekiChildren(node)) visit(child)
      }
      visit(chapter)
      if (sections.length > 0) outlines.push({
        id: sections[0]!.id,
        title: normalizeTitle(chapter.title ?? sections[0]!.title),
        sections,
      })
    }
  }
  return outlines
}

const REMOVED_CHROME = [
  'script', 'style', 'nav', 'header', 'footer', 'aside', 'form',
  '.mt-sortable-listings-container', '.mt-subpage-listings-container',
  '.mt-topic-hierarchy-listings', '.mt-category-container', '.noinclude', '.noindex',
]

function extractContent(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const root = doc.querySelector('section.mt-content-container, .entry-content, .book-content, main, article') ?? doc.body
  for (const node of Array.from(root.querySelectorAll(REMOVED_CHROME.join(',')))) node.remove()
  return root.innerHTML
}

interface PublicPage {
  id: string
  title: string
  html: string
  children: WebBookSection[]
}

export function parseLibreTextsPublicPage(html: string, currentUrl: string, rootUrl: string): PublicPage {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const content = doc.querySelector('section.mt-content-container')
  const rootScope = normalizedUrl(rootUrl)
  const children: WebBookSection[] = []
  const seen = new Set<string>()
  for (const item of Array.from(content?.querySelectorAll('li[data-page-id]') ?? [])) {
    // Topic-guide pages wrap their link in `<dl><dt>`, while book-level
    // listings put it directly under the `<li>`. Both are public LibreTexts
    // hierarchy markup, so looking only at a direct child silently discarded
    // every lesson below a chapter and left only the chapter's intro/links.
    const link = item.querySelector('a[href]')
    if (!link) continue
    const url = absoluteUrl(link.getAttribute('href') ?? '', currentUrl)
    if (!url) continue
    const normalized = normalizedUrl(url)
    if (!(normalized === rootScope || normalized.startsWith(`${rootScope}/`)) || seen.has(normalized)) continue
    seen.add(normalized)
    // `title` is often a long machine-generated overview on topic links. The
    // visible link text is the stable chapter/section name we want in Canvas;
    // the listing-title span remains preferred for book-level listings.
    const title = normalizeTitle(
      link.querySelector('.mt-sortable-listing-title')?.textContent
        ?? link.textContent
        ?? link.getAttribute('title')
        ?? '',
    )
    if (!title) continue
    children.push({ id: item.getAttribute('data-page-id') ?? normalized, title, url })
  }
  return {
    id: doc.querySelector('#pageIDHolder')?.textContent?.trim() || normalizedUrl(currentUrl),
    title: normalizeTitle(doc.querySelector('#title, #titleHolder')?.textContent ?? '') || decodeURIComponent(new URL(currentUrl).pathname.split('/').pop() ?? 'Page').replace(/_/g, ' '),
    html: extractContent(html),
    children,
  }
}

function hasImportableContent(html: string): boolean {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  return normalizeTitle(doc.body.textContent ?? '').length > 0 || doc.querySelector('img, math, table') !== null
}

function attribution(book: BookRef, publisher: string): Attribution {
  return {
    bookTitle: book.title,
    publisher,
    url: book.slug,
    authors: book.authors,
    ...(book.license ? { license: { name: book.license, ...(book.licenseUrl ? { url: book.licenseUrl } : {}) } } : {}),
  }
}

function chapter(book: BookRef, outline: WebBookOutline, sections: Section[], publisher: string): Chapter {
  return {
    source: book.source,
    bookId: book.id,
    title: outline.title,
    sections,
    xrefs: new Map(outline.sections.flatMap((section) => section.url ? [[section.id, section.url]] : [])),
    attribution: attribution(book, publisher),
  }
}

export function createLibreTextsClient(deps: WebBookClientDeps): WebBookClient {
  const maxPagesPerChapter = 250
  const cache = new Map<string, string>()
  const fetchHtml = async (url: string, signal?: AbortSignal) => {
    const normalized = normalizedUrl(url)
    const cached = cache.get(normalized)
    if (cached !== undefined) return cached
    const html = await responseText(deps.fetch, viaRelay(deps.relayUrl, url), signal)
    cache.set(normalized, html)
    return html
  }

  return {
    async fetchOutlines(book) {
      const match = /^([a-z1-2]{3,9})-(\d{2,10})$/.exec(book.id)
      if (match) {
        const api = `https://${match[1]}.libretexts.org/@api/deki/pages/${match[2]}/tree?dream.out.format=json`
        try {
          const result = await deps.fetch(viaRelay(deps.relayUrl, api), { headers: { accept: 'application/json' } })
          if (result.ok) {
            const outlines = parseDekiToc(await result.json(), book.slug)
            // Some Deki tree envelopes expose ids and titles but omit every
            // public UI/content URL. Those entries cannot be imported safely,
            // so use the rendered hierarchy fallback instead.
            if (outlines.length > 0 && outlines.every((outline) => outline.sections.every((section) => section.url))) return outlines
          }
        } catch {
          // The public page hierarchy below is authoritative when this
          // optional token-gated endpoint is unavailable or unusable.
        }
      }

      const rootHtml = await fetchHtml(book.slug)
      const root = parseLibreTextsPublicPage(rootHtml, book.slug, book.slug)
      if (root.children.length === 0) {
        return [{ id: root.id, title: root.title || book.title, sections: [{ id: root.id, title: root.title || book.title, url: book.slug }] }]
      }
      // The root already identifies the chapter-level children. Descendants
      // are expanded only after the instructor selects a chapter, keeping a
      // book browse to one public-page request instead of crawling the book.
      return root.children.map((top) => ({
        id: top.id,
        title: top.title,
        sections: [{ ...top, kind: 'libre-tree' }],
      }))
    },

    async fetchChapter(book, outline, signal) {
      const expanded: WebBookSection[] = []
      const visited = new Set<string>()
      const visit = async (seed: WebBookSection) => {
        signal?.throwIfAborted()
        if (!seed.url || visited.has(normalizedUrl(seed.url))) return
        if (visited.size >= maxPagesPerChapter) {
          throw new Error(`LibreTexts chapter exceeds the ${maxPagesPerChapter}-page import budget`)
        }
        visited.add(normalizedUrl(seed.url))
        const html = await fetchHtml(seed.url, signal)
        const page = parseLibreTextsPublicPage(html, seed.url, book.slug)
        if (page.children.length === 0 || hasImportableContent(page.html)) {
          expanded.push({ id: page.id || seed.id, title: page.title || seed.title, url: seed.url })
        }
        for (const child of page.children) await visit(child)
      }
      for (const item of outline.sections) {
        if (item.kind === 'libre-tree') await visit(item)
        else expanded.push(item)
      }
      if (expanded.length === 0) throw new Error('LibreTexts chapter did not contain readable public pages')

      const sections: Section[] = []
      for (const [order, item] of expanded.entries()) {
        signal?.throwIfAborted()
        if (!item.url) throw new Error(`LibreTexts section has no public URL: ${item.title}`)
        const html = item.kind === 'deki'
          ? await responseJson(deps.fetch, viaRelay(deps.relayUrl, item.url), signal)
          : await fetchHtml(item.url, signal)
        const content = typeof html === 'string'
          ? extractContent(html)
          : extractDekiContent(html)
        sections.push({ id: item.id, title: item.title, order, html: content, contentBaseUrl: item.url, canonicalUrl: item.url })
      }
      return chapter(book, outline, sections, 'LibreTexts')
    },
  }
}

function extractDekiContent(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const body = (raw as { body?: unknown }).body
  if (typeof body === 'string') return body
  if (Array.isArray(body)) return body.filter((part): part is string => typeof part === 'string').join('\n')
  return ''
}

interface PressbooksEntry {
  id?: number | string
  title?: string
  link?: string
  has_post_content?: boolean
  word_count?: number
}

export function parsePressbooksToc(raw: unknown): WebBookOutline[] {
  if (!raw || typeof raw !== 'object') return []
  const toc = raw as {
    'front-matter'?: PressbooksEntry[]
    parts?: { chapters?: PressbooksEntry[] }[]
    'back-matter'?: PressbooksEntry[]
  }
  const groups: [PressbooksKind, PressbooksEntry[]][] = [
    ['front-matter', toc['front-matter'] ?? []],
    ['chapters', (toc.parts ?? []).flatMap((part) => part.chapters ?? [])],
    ['back-matter', toc['back-matter'] ?? []],
  ]
  const outlines: WebBookOutline[] = []
  for (const [kind, entries] of groups) {
    for (const entry of entries) {
      if (entry.has_post_content === false || entry.word_count === 0) continue
      const id = String(entry.id ?? '')
      const title = normalizeTitle(entry.title ?? '')
      const url = typeof entry.link === 'string' ? entry.link : undefined
      if (!id || !title || !url) continue
      outlines.push({ id: `${kind}:${id}`, title, sections: [{ id, title, url, kind }] })
    }
  }
  return outlines
}

function isPressbooksKind(kind: WebBookSection['kind']): kind is PressbooksKind {
  return kind === 'front-matter' || kind === 'chapters' || kind === 'back-matter'
}

function pressbooksApi(bookUrl: string, path: string): string {
  return new URL(`wp-json/pressbooks/v2/${path}`, bookUrl.endsWith('/') ? bookUrl : `${bookUrl}/`).toString()
}

export function createPressbooksClient(deps: WebBookClientDeps): WebBookClient {
  return {
    async fetchOutlines(book) {
      const raw = await responseJson(deps.fetch, viaRelay(deps.relayUrl, pressbooksApi(book.slug, 'toc')))
      const outlines = parsePressbooksToc(raw)
      if (outlines.length === 0) throw new Error('Pressbooks book did not contain readable table-of-contents entries')
      return outlines
    },

    async fetchChapter(book, outline, signal) {
      const sections: Section[] = []
      for (const [order, item] of outline.sections.entries()) {
        signal?.throwIfAborted()
        if (!item.url || !isPressbooksKind(item.kind)) throw new Error(`Pressbooks section is incomplete: ${item.title}`)
        const endpoint = new URL(pressbooksApi(book.slug, item.kind))
        endpoint.searchParams.set('include', item.id)
        endpoint.searchParams.set('per_page', '10')
        const raw = await responseJson(deps.fetch, viaRelay(deps.relayUrl, endpoint.toString()), signal)
        const pages = Array.isArray(raw) ? raw : []
        const page = pages.find((candidate) => candidate && typeof candidate === 'object' && String((candidate as { id?: unknown }).id) === item.id) as { content?: { rendered?: unknown } } | undefined
        const html = typeof page?.content?.rendered === 'string' ? page.content.rendered : ''
        if (!html) throw new Error(`Pressbooks did not return content for ${item.title}`)
        sections.push({ id: item.id, title: item.title, order, html, contentBaseUrl: item.url, canonicalUrl: item.url })
      }
      return chapter(book, outline, sections, 'Pressbooks')
    },
  }
}
