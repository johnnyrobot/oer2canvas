/**
 * OpenStax content client.
 *
 * Three hops, verified live 2026-08-21. CORS is per-ENDPOINT here, not per-host,
 * and only the first hop needs help (re-confirmed 2026-08-22):
 *   1. GET /rex/release.json                              -> archiveUrl + per-book defaultVersion
 *      NO Access-Control-Allow-Origin. Goes through the relay — see `Deps.relayUrl`.
 *   2. GET {archiveUrl}/contents/{uuid}@{ver}.json        -> book TOC
 *   3. GET {archiveUrl}/contents/{uuid}@{ver}:{page}.json -> page content
 *      Both send `ACAO: *`, so both talk to the network DIRECTLY — relaying them
 *      would add a hop and spend a free-tier request for nothing.
 *
 * Hop 1 blocks the other two when it fails, so before the relay landed the app
 * could not load a book at all despite two thirds of the client working fine.
 */
import type { Attribution, BookRef, Chapter, Section } from './types'

const DEFAULT_BASE_URL = 'https://openstax.org'

export interface Release {
  archiveUrl: string
  /** book uuid -> default version */
  versions: Record<string, string>
}

export interface TocNode {
  id: string
  title: string
  contents?: TocNode[]
  /**
   * OpenStax's own structural tag for the node. Observed values, verified live
   * 2026-08-21: `'unit'` (a Unit/Part holding chapters), `'chapter'`,
   * `'sub-book-tree'` (a grouping node with no page — "Chapter Review",
   * "Exercises", and also root-level "Answer Key"), and `'book-content'` (a real
   * page). Undocumented, so `flattenToc` treats it as a hint and still works
   * without it. Snake_case because that is the wire name.
   */
  toc_type?: string
  /**
   * The wire field that makes a page's public url. Verified present on every
   * `book-content` node in the committed TOC.
   */
  slug?: string
}

export interface BookToc {
  title: string
  tree: TocNode
  /**
   * D9 needs BOTH halves. The content API supplies name and url together
   * (`{"url": "http://creativecommons.org/licenses/by/4.0/", "name": "Creative
   * Commons Attribution License"}`), and the spec requires the emitted licence
   * link to carry descriptive text rather than a bare URL — so neither half may
   * be discarded at the type level.
   */
  license?: { name?: string; url?: string }
  language?: string
}

export interface PageContent {
  id: string
  title: string
  content: string
}

export interface OpenStaxClient {
  resolveRelease(): Promise<Release>
  fetchToc(bookUuid: string): Promise<BookToc>
  fetchPage(bookUuid: string, pageId: string): Promise<PageContent>
  pageUrl(bookUuid: string, pageId: string): Promise<string>
}

interface Deps {
  fetch: typeof globalThis.fetch
  baseUrl?: string
  /**
   * Relay path for the ONE endpoint a browser cannot reach directly.
   *
   * `/rex/release.json` sends no `Access-Control-Allow-Origin` header (measured
   * 2026-08-21, re-confirmed 2026-08-22), and it is the FIRST of this client's
   * three hops — so without a relay it blocks the other two even though both of
   * those do send the header. There is no way around needing it: every
   * version-less content url 404s, so the archive url and per-book version have
   * to come from the manifest.
   *
   * Whether the header was ever there is unknown. The provenance importer this
   * client was ported from is a Tauri app issuing requests from Rust, where CORS
   * does not exist, and `curl` ignores it identically — so the original survey
   * could not have detected an absent header either way.
   *
   * Deliberately NOT applied to the archive endpoints: those do send the header,
   * and relaying them would add a hop and spend a request against the free tier
   * for nothing. Left undefined, the client goes direct everywhere, which is what
   * every injected-fetch test relies on.
   */
  relayUrl?: string
}

/** `GET /relay?url=<target>` — the shape `worker/relay.ts` reads. */
function viaRelay(relayUrl: string, target: string): string {
  return `${relayUrl}?url=${encodeURIComponent(target)}`
}

export function createOpenStaxClient(deps: Deps): OpenStaxClient {
  const baseUrl = (deps.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
  let cached: Release | undefined

  async function json<T>(url: string): Promise<T> {
    const res = await deps.fetch(url)
    if (!res.ok) throw new Error(`OpenStax: request to ${url} failed with HTTP ${res.status}`)
    try {
      return (await res.json()) as T
    } catch (cause) {
      // These APIs are undocumented and WILL change shape. A bare SyntaxError
      // with no URL and no status is the worst possible signal when they do —
      // it looks like our bug and says nothing about whose response broke.
      throw new Error(
        `OpenStax: ${url} returned HTTP ${res.status} but the body is not JSON ` +
          `(content-type: ${res.headers.get('content-type') ?? 'none'})`,
        { cause },
      )
    }
  }

  async function resolveRelease(): Promise<Release> {
    if (cached) return cached
    // The only hop that goes through the relay — see `Deps.relayUrl`.
    const releaseUrl = `${baseUrl}/rex/release.json`
    const raw = await json<{ archiveUrl: string; books: Record<string, { defaultVersion: string }> }>(
      deps.relayUrl ? viaRelay(deps.relayUrl, releaseUrl) : releaseUrl,
    )
    const versions: Record<string, string> = {}
    for (const [uuid, book] of Object.entries(raw.books)) versions[uuid] = book.defaultVersion
    cached = { archiveUrl: raw.archiveUrl, versions }
    return cached
  }

  async function versionFor(bookUuid: string): Promise<{ archiveUrl: string; version: string }> {
    const release = await resolveRelease()
    const version = release.versions[bookUuid]
    if (!version) throw new Error(`unknown OpenStax book: ${bookUuid}`)
    return { archiveUrl: release.archiveUrl, version }
  }

  return {
    resolveRelease,

    async fetchToc(bookUuid) {
      const { archiveUrl, version } = await versionFor(bookUuid)
      return json<BookToc>(`${baseUrl}${archiveUrl}/contents/${bookUuid}@${version}.json`)
    },

    async fetchPage(bookUuid, pageId) {
      const { archiveUrl, version } = await versionFor(bookUuid)
      return json<PageContent>(
        `${baseUrl}${archiveUrl}/contents/${bookUuid}@${version}:${pageId}.json`,
      )
    },

    async pageUrl(bookUuid, pageId) {
      const { archiveUrl, version } = await versionFor(bookUuid)
      return `${baseUrl}${archiveUrl}/contents/${bookUuid}@${version}:${pageId}.json`
    },
  }
}

/**
 * The client the app ships with — the one production call site.
 *
 * `fetch` is handed over as a WRAPPER rather than as `globalThis.fetch` itself,
 * and that is load-bearing: `createOpenStaxClient` calls it as `deps.fetch(url)`,
 * a method call, so an unwrapped `globalThis.fetch` would reach the platform with
 * the deps bag as its receiver. Every WebIDL operation on the global brand-checks
 * its receiver and rejects a foreign object with a `TypeError` — measured
 * 2026-08-21 in Chromium 151.0.7922.34 and WebKit 26.5 for `atob`,
 * `querySelector`, `getComputedStyle`, the `localStorage` getter, and for `fetch`
 * itself. `fetch` fails as a REJECTED PROMISE rather than a synchronous throw,
 * because WebIDL converts the TypeError for a promise-returning operation — which
 * is why this shape reads as harmless when it is not: unbound, every `fetchToc`
 * and `fetchPage` rejects with `TypeError: Failed to execute 'fetch' on 'Window':
 * Illegal invocation` and no request is made. The receiver is pinned by
 * `openstax.browser.test.ts` so the construction cannot silently drift back.
 */
export function createDefaultOpenStaxClient(): OpenStaxClient {
  return createOpenStaxClient({
    fetch: (...args) => globalThis.fetch(...args),
    // Same-origin path: the deployed Worker claims `/relay` via `run_worker_first`
    // in wrangler.jsonc, and `vite.config.ts` proxies it to `wrangler dev` locally.
    relayUrl: '/relay',
  })
}

export interface ChapterOutline {
  id: string
  title: string
  sections: { id: string; title: string; slug?: string; url?: string }[]
}

/** TOC ids arrive as "<uuid>@<version>"; the content API wants the bare uuid. */
function bareId(id: string): string {
  const at = id.indexOf('@')
  return at === -1 ? id : id.slice(0, at)
}

/**
 * TOC titles arrive as markup — nested `<span class="os-number">`/`os-part-text`/
 * `os-divider`/`os-text` wrappers with embedded newlines between them, e.g.
 * `<span class="os-number">...1</span>\n<span class="os-divider"> </span>\n<span
 * class="os-text">Prerequisites</span>`. `Section.title`/`Chapter.title` are typed as
 * plain titles and Task 14 renders them as React text, so strip tags, decode the basic
 * HTML entities defensively, and collapse whitespace (including the embedded newlines)
 * to single spaces before a title leaves this module. Only applied to TOC-derived
 * titles — `PageContent.title` from the content API is already plain text.
 *
 * The ORDER of the two passes is deliberate and must stay this way: strip tags
 * FIRST, decode entities SECOND. Decoding first would turn `&lt;b&gt;` into
 * `<b>` and hand the tag-stripper markup that was never markup in the source.
 * Decoding second can produce a string that merely *looks* like a tag, which is
 * harmless here because the result is only ever rendered as a React text node —
 * never as HTML, and never through `innerHTML`.
 */
function normalizeTitle(title: string): string {
  const withoutTags = title.replace(/<[^>]*>/g, '')
  const withoutEntities = withoutTags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
  return withoutEntities.replace(/\s+/g, ' ').trim()
}

/**
 * Recursively collects the leaf nodes (no children) under `nodes`, in document order.
 * A node with children but no leaf-page-of-its-own — e.g. real OpenStax chapters carry
 * "Chapter Review" (Key Terms / Key Equations / Key Concepts) and "Exercises" (Review
 * Exercises / Practice Test) grouping nodes — is never itself a section: `fetchPage` on
 * a grouping node's id 404s, because it has no page. Only its leaves do.
 */
function collectLeaves(nodes: TocNode[]): TocNode[] {
  const leaves: TocNode[] = []
  for (const node of nodes) {
    if (!node.contents || node.contents.length === 0) {
      leaves.push(node)
    } else {
      leaves.push(...collectLeaves(node.contents))
    }
  }
  return leaves
}

/**
 * Root-level containers holding back matter rather than adoptable content.
 *
 * Deliberately a SHORT list of exact normalized titles rather than a heuristic.
 * The structural tag cannot carry this on its own: OpenStax marks "Answer Key"
 * `toc_type: 'sub-book-tree'`, the very same tag it puts on the in-chapter
 * "Chapter Review" and "Exercises" grouping nodes, so the tag says "this holds
 * other nodes", not "this is back matter". Most back matter (Preface, each
 * Appendix, Index) is a root-level LEAF and is already skipped for having no
 * children; only the ones that are containers need naming here.
 */
const BACK_MATTER_TITLES = new Set(['answer key', 'index', 'glossary'])

/**
 * How many levels of container may be recursed through before everything with
 * children is taken to be a chapter. OpenStax nests at most Unit → Chapter, so
 * one is enough, and capping it bounds what a surprising TOC can do: at the cap,
 * the worst case is the current behaviour rather than an unbounded descent.
 */
const MAX_CONTAINER_DEPTH = 1

/**
 * Does this node HOLD chapters (a Unit/Part), rather than being one?
 *
 * This is the difference between adopting a chapter and adopting a book. The
 * spec's opening scope statement is explicit — "The unit of work is a chapter,
 * never a book" — and treating a Unit as a chapter is exactly how a book gets
 * adopted by accident: University Physics Volume 1's "Unit 1 Mechanics" flattens
 * to 190 leaf sections, which is 190 sequential page fetches and 190 audits.
 */
function isChapterContainer(node: TocNode): boolean {
  // Trust OpenStax's own tag when it is there. Verified live 2026-08-21:
  // University Physics Volume 1 tags "Unit 1 Mechanics" `unit` and each of its
  // 14 children `chapter`; the committed Algebra and Trigonometry TOC has no
  // units at all and tags all 13 chapters `chapter`.
  if (node.toc_type === 'unit') return true
  if (node.toc_type === 'chapter') return false
  // Fallback for a TOC that carries no `toc_type`: a node is a container when
  // EVERY child has children of its own. A unit matches, because every child is
  // a chapter. A chapter does not, because it always mixes leaf sections with
  // its grouping nodes ("Chapter Review", "Exercises").
  const children = node.contents ?? []
  return children.every((c) => (c.contents?.length ?? 0) > 0)
}

/**
 * A chapter is a root-level TOC node with children — unless that node is a
 * CONTAINER of chapters (a Unit/Part), in which case its children are the
 * chapters and it is recursed into, or back matter, in which case it is skipped.
 * A root-level leaf (Preface, Appendix, Index) is not a chapter and is skipped.
 *
 * Within a chapter, a node with children is a grouping node, never a section —
 * recurse into it instead of emitting it, because it has no page of its own and
 * fetching one 404s (see `collectLeaves`). Only leaf nodes become sections,
 * collected in document order and flattened into the chapter's single `sections`
 * list regardless of how deep they were nested.
 */
export function flattenToc(tree: TocNode): ChapterOutline[] {
  const out: ChapterOutline[] = []
  for (const node of tree.contents ?? []) collectChapters(node, out, 0)
  return out
}

function collectChapters(node: TocNode, out: ChapterOutline[], depth: number): void {
  const children = node.contents ?? []
  if (children.length === 0) return

  const title = normalizeTitle(node.title)
  if (BACK_MATTER_TITLES.has(title.toLowerCase())) return

  if (depth < MAX_CONTAINER_DEPTH && isChapterContainer(node)) {
    for (const child of children) collectChapters(child, out, depth + 1)
    return
  }

  out.push({
    id: bareId(node.id),
    title,
    sections: collectLeaves(children).map((c) => ({
      id: bareId(c.id),
      title: normalizeTitle(c.title),
      slug: c.slug,
    })),
  })
}

/** The public, human-facing url of one section. D9 attribution links this. */
export function canonicalSectionUrl(bookSlug: string, sectionSlug: string): string {
  return `https://openstax.org/books/${bookSlug}/pages/${sectionSlug}`
}

/**
 * Every page uuid in the book → its public url.
 *
 * Chapter HTML links siblings as `./{bookUuid}@{ver}:{pageUuid}`, which resolves
 * to a JSON endpoint, not a page a human can read. This map is what turns those
 * into real urls. A node the TOC gave no slug is OMITTED rather than guessed at:
 * a wrong url that looks right is worse than a link the caller knows it could
 * not resolve, and the caller has a documented fallback (the book url).
 */
export function buildXrefMap(tree: TocNode, bookSlug: string): Map<string, string> {
  const out = new Map<string, string>()
  const visit = (node: TocNode): void => {
    if (node.slug) out.set(bareId(node.id), canonicalSectionUrl(bookSlug, node.slug))
    for (const child of node.contents ?? []) visit(child)
  }
  visit(tree)
  return out
}

/**
 * The best licence available for D9, preferring the TOC's over the catalog's.
 *
 * `BookRef.license` is a bare NAME string from the bundled catalog; `BookToc`
 * carries name AND url straight from the content API. D9 requires the emitted
 * attribution block to link the licence with descriptive text, so the url is not
 * optional detail — it is half the requirement, and the TOC is the only source
 * that has it. The catalog name stays as the fallback for a caller that has no
 * TOC to hand, because attribution degrades and never disappears.
 */
function resolveLicense(book: BookRef, toc?: Pick<BookToc, 'license'>): Attribution['license'] {
  const name = toc?.license?.name ?? book.license
  if (!name) return undefined
  const url = toc?.license?.url
  return url ? { name, url } : { name }
}

export async function fetchChapter(
  client: OpenStaxClient,
  book: BookRef,
  outline: ChapterOutline,
  /** The book's TOC, when the caller has one. Supplies the licence url for D9,
   * and the whole tree the xref map and per-section canonical urls are built from. */
  toc?: BookToc,
  /**
   * Cancels the run between page requests.
   *
   * A chapter is a dozen sequential fetches, so without this the user's cancel
   * is not acted on until every one of them has come back. The check is BETWEEN
   * requests, not inside the in-flight one — aborting the request itself would
   * mean threading the signal through `OpenStaxClient` into `deps.fetch`, and
   * one page of latency is not worth widening that interface for.
   */
  signal?: AbortSignal,
): Promise<Chapter> {
  const sections: Section[] = []
  const xrefs = toc ? buildXrefMap(toc.tree, book.slug) : new Map<string, string>()
  const bookUrl = `https://openstax.org/books/${book.slug}`

  // Sequential on purpose: polite to the archive, and order is trivially preserved.
  for (const [order, ref] of outline.sections.entries()) {
    signal?.throwIfAborted()
    const page = await client.fetchPage(book.id, ref.id)
    sections.push({
      id: ref.id,
      title: ref.title || page.title,
      order,
      html: page.content,
      contentBaseUrl: await client.pageUrl(book.id, ref.id),
      // Degrade to the book url rather than emitting nothing: D9 says
      // attribution degrades, it never disappears.
      canonicalUrl: ref.slug ? canonicalSectionUrl(book.slug, ref.slug) : bookUrl,
    })
  }

  return {
    source: 'openstax',
    bookId: book.id,
    title: outline.title,
    sections,
    xrefs,
    // D9: the source is never stripped.
    attribution: {
      bookTitle: book.title,
      publisher: 'OpenStax',
      url: bookUrl,
      authors: book.authors,
      license: resolveLicense(book, toc),
    },
  }
}
