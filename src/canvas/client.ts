import { createTransport, type Transport } from './transport'

/**
 * What went wrong, in terms the Destination screen can turn into a sentence.
 *
 * §2.5 gives two failures distinct copy — "Could not connect to Canvas. Check the
 * address and token" versus "Could not load your courses" — and the difference
 * only helps if the app can actually tell them apart. A status code cannot: a
 * user who typed the wrong host and a user who pasted an expired token both see
 * "it didn't work", and the one thing each needs to know is WHICH FIELD to fix.
 */
export type CanvasErrorKind =
  /** The token was refused. The address was fine — we reached Canvas to be told. */
  | 'token'
  /** Nothing answered at that address, or what answered was not Canvas. */
  | 'address'
  /** Reached, authenticated, and not allowed to do this. Re-trying will not help. */
  | 'permission'
  /** Canvas answered, and said no in a way that is its business rather than ours. */
  | 'canvas'
  /**
   * THE RELAY refused, and Canvas never saw the request.
   *
   * Its own vocabulary: `cross-origin request not allowed`, `host not allowed`,
   * `https required`, `upstream unreachable`. None of these are about the token
   * or the course, and reporting them as if they were is how someone spends an
   * afternoon auditing Canvas permissions over a misconfigured proxy — measured,
   * on this very build.
   */
  | 'relay'

export class CanvasError extends Error {
  readonly kind: CanvasErrorKind
  readonly status: number
  constructor(kind: CanvasErrorKind, status: number, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'CanvasError'
    this.kind = kind
    this.status = status
  }
}

/**
 * Whether this failure is the relay's, and what it said.
 *
 * `worker/relay.ts` answers every refusal as `{"error":"<reason>"}` — a SINGULAR
 * `error` holding a string. Canvas uses a plural `errors` ARRAY. That difference
 * is the whole discriminator, and it is load-bearing: both speak in 403s, and a
 * relay 403 has nothing to do with the token or the course.
 */
function relayReason(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error?: unknown }
    return typeof parsed.error === 'string' ? parsed.error : undefined
  } catch {
    return undefined
  }
}

/**
 * A 502 is the RELAY's word, not Canvas's.
 *
 * `worker/relay.ts` answers `502 {"error":"upstream unreachable"}` for DNS, TLS
 * and connection failures, precisely so the browser gets something readable
 * instead of an opaque CORS error. That is the signature of a mistyped
 * institutional host, so it is reported against the address field even though
 * the relay is the one saying it.
 */
function classify(status: number): CanvasErrorKind {
  if (status === 401) return 'token'
  if (status === 403) return 'permission'
  if (status === 502 || status === 404) return 'address'
  return 'canvas'
}

/**
 * The error for a response that failed, relay or Canvas.
 *
 * The body is read to tell them apart, which means it cannot also be handed back
 * unread — hence `clone()`. Cheap here: an error body is a line of text, not the
 * 168 KB page bodies this client reads on the way in.
 */
async function errorFor(res: Response): Promise<CanvasError> {
  const reason = relayReason(await res.clone().text())
  // `upstream unreachable` stays an address problem: it IS the relay speaking,
  // but what it is reporting is a host that did not answer, and the address field
  // is the one the user can act on.
  if (reason !== undefined && res.status !== 502) {
    return new CanvasError('relay', res.status, `The relay refused this request: ${reason}.`)
  }
  const kind = classify(res.status)
  return new CanvasError(kind, res.status, `${MESSAGE[kind]} (HTTP ${res.status})`)
}

const MESSAGE: Record<CanvasErrorKind, string> = {
  token: 'Canvas did not accept that access token.',
  address: 'Nothing at that address answered as a Canvas instance.',
  relay: 'The relay refused this request.',
  permission: 'That token is not allowed to do this in this course.',
  canvas: 'Canvas refused the request.',
}

/** Who the token belongs to. Shown on connect, so the user can see it is them. */
export interface CanvasUser {
  id: number
  name: string
}

/** A course the picker can offer. Term is secondary text, per §2.9's flat list. */
export interface CanvasCourse {
  id: number
  name: string
  term?: string
}

/**
 * Which enrollments can create a page.
 *
 * A student enrollment is a real, active course that will come back from the
 * courses endpoint and cannot be pushed to. Offering it would put a course in
 * the picker whose only possible outcome is a 403 fifteen pages into a run —
 * which is the worst place to discover it, because E7 has NO ROLLBACK and the
 * pages that landed before it stay landed.
 */
const CAN_AUTHOR = new Set(['teacher', 'ta', 'designer'])

interface RawCourse {
  id: number
  name?: string
  enrollments?: { type: string }[]
  term?: { name?: string }
}

/**
 * A page that is already in the course.
 *
 * This is §2.4's list, and it is the reason the Destination screen asks for a
 * course BEFORE the user picks chapters: the Plan screen collides the selection
 * against it, so "2 would overwrite pages already in the course" is a statement
 * the app can make before anything is sent rather than a surprise afterwards.
 */
export interface CanvasPage {
  title: string
  /** The slug in the course url. What a push collides on. */
  url: string
  updatedAt?: string
}

export interface CanvasClient {
  verify(): Promise<CanvasUser>
  listCourses(): Promise<CanvasCourse[]>
  listPages(courseId: number): Promise<CanvasPage[]>
  upsertPage(courseId: number, page: PageWrite): Promise<CanvasPage>
}

export interface PageWrite {
  title: string
  /** The compiled html, VERBATIM. This transport never re-derives it. */
  body: string
  /**
   * The url of the page to overwrite. Absent means create.
   *
   * It is CANVAS'S url, from the course's own page list, and never a slug of
   * ours — see `resolve.ts` for the measurement that forced this. There is no
   * way to ask Canvas to put a page at a chosen url, so the only page this can
   * safely aim at is one that already exists.
   */
  existingUrl?: string
}

/**
 * The `rel="next"` target from a Canvas `Link` header, as a path.
 *
 * Returned as a PATH rather than the absolute url Canvas sends, because the
 * transport composes every request from the base origin the user typed. Handing
 * it an absolute url would let Canvas's own idea of its hostname — which behind
 * an institutional load balancer is routinely not the one the user reached it
 * by — silently redirect the second page somewhere the first page did not come
 * from.
 */
function nextPage(link: string | null): string | undefined {
  if (!link) return undefined
  for (const part of link.split(',')) {
    const m = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part)
    if (!m) continue
    try {
      const url = new URL(m[1]!)
      return `${url.pathname}${url.search}`
    } catch {
      return undefined
    }
  }
  return undefined
}

async function readAll<T>(transport: Transport, path: string): Promise<T[]> {
  const all: T[] = []
  let next: string | undefined = path
  // Canvas caps `per_page` at 100, so a teacher with 340 courses genuinely needs
  // four round trips. Bounded so a malformed Link header cannot loop forever.
  for (let page = 0; next !== undefined && page < 50; page++) {
    const res: Response = await request(transport, next)
    all.push(...((await parse(res)) as T[]))
    next = nextPage(res.headers.get('link'))
  }
  return all
}

async function request(transport: Transport, path: string): Promise<Response> {
  const res = await transport.request(path)
  if (!res.ok) throw await errorFor(res)
  return res
}

async function parse<T>(res: Response): Promise<T> {
  try {
    return (await res.json()) as T
  } catch (cause) {
    // A 200 that is not JSON means something that is not Canvas answered — a
    // captive portal, an SSO login page, a parked domain. That is an address
    // problem wearing a success code, and reporting it as one saves the user
    // from checking a token that was never the issue.
    throw new CanvasError('address', res.status, MESSAGE.address, { cause })
  }
}

async function read<T>(transport: Transport, path: string): Promise<T> {
  return parse<T>(await request(transport, path))
}

export function createCanvasClient(transport: Transport): CanvasClient {
  return {
    verify: () => read<CanvasUser>(transport, '/api/v1/users/self'),

    async listCourses() {
      const raw = await readAll<RawCourse>(
        transport,
        '/api/v1/courses?enrollment_state=active&include[]=term&per_page=100',
      )
      return raw
        .filter((c) => (c.enrollments ?? []).some((e) => CAN_AUTHOR.has(e.type)))
        .map((c) => ({
          id: c.id,
          name: c.name ?? `Course ${c.id}`,
          ...(c.term?.name ? { term: c.term.name } : {}),
        }))
    },

    /**
     * Create with `POST`, update with `PUT` — and the split is forced, not stylistic.
     *
     * This was one call, a `PUT` to our own slug, on the documented understanding
     * that Canvas's "update/create page" creates at that url when it is absent.
     * MEASURED 2026-08-23 on a live instance, it does not: the url is derived
     * from the TITLE, `wiki_page[url]` is ignored on both verbs, and a `PUT` at
     * an absent url creates a second page — `alpha-title`, then `alpha-title-2`.
     * The old shape would have duplicated every page on every re-push, which is
     * precisely the failure this product exists to avoid.
     *
     * `published: true` because a page that arrives unpublished is invisible to
     * students and reads, to the instructor who goes looking for it, exactly like
     * a run that silently failed. The cartridge path sets `workflow_state=active`
     * for the same reason.
     */
    async upsertPage(courseId, page) {
      const path = page.existingUrl
        ? `/api/v1/courses/${courseId}/pages/${encodeURIComponent(page.existingUrl)}`
        : `/api/v1/courses/${courseId}/pages`
      const res = await transport.request(path, {
        method: page.existingUrl ? 'PUT' : 'POST',
        body: { wiki_page: { title: page.title, body: page.body, published: true } },
      })
      if (!res.ok) throw await errorFor(res)
      const stored = (await parse<{ url?: string; title?: string }>(res))
      return { title: stored.title ?? page.title, url: stored.url ?? page.existingUrl ?? '' }
    },

    async listPages(courseId) {
      const raw = await readAll<{ title?: string; url?: string; updated_at?: string }>(
        transport,
        `/api/v1/courses/${courseId}/pages?per_page=100`,
      )
      return raw.map((p) => ({
        title: p.title ?? p.url ?? 'Untitled',
        url: p.url ?? '',
        ...(p.updated_at ? { updatedAt: p.updated_at } : {}),
      }))
    },
  }
}

/**
 * The client the app actually uses.
 *
 * `/relay` is the same same-origin path `createDefaultOpenStaxClient` uses — the
 * deployed Worker claims it via `run_worker_first` in `wrangler.jsonc`, and
 * `vite.config.ts` proxies it to `wrangler dev` locally. Canvas has no choice
 * about going through it: see `TransportDeps.relayUrl`.
 */
export function createDefaultCanvasClient(
  baseUrl: string,
  token: string,
  onWait?: (ms: number, attempt: number) => void,
): CanvasClient {
  return createCanvasClient(
    createTransport({
      fetch: (...args) => globalThis.fetch(...args),
      baseUrl,
      token,
      relayUrl: '/relay',
      ...(onWait ? { onWait } : {}),
    }),
  )
}
