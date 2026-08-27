/**
 * Which targets the relay will forward to.
 *
 * Publisher content is matched against fixed patterns. Canvas API traffic is a
 * separate, default-off capability: an operator must configure the exact HTTPS
 * origin of the Canvas instance they administer. An `/api/v1/` path on any
 * other host is refused, even when it otherwise looks like Canvas.
 *
 * Exact origin pinning is the authority boundary. It keeps the public
 * cartridge-only deployment from being an arbitrary bearer-token proxy and
 * ensures an opted-in self-host deployment can reach only its paired Canvas
 * instance. The public-host checks below remain defense in depth against SSRF.
 */

const PRESSBOOKS_PATTERNS: RegExp[] = [
  /(^|\.)pressbooks\.pub$/,
  /^pressbooks\.online\.ucf\.edu$/,
  /^milnepublishing\.geneseo\.edu$/,
  /^open\.maricopa\.edu$/,
  /^open\.library\.okstate\.edu$/,
]

const PUBLISHER_PATTERNS: RegExp[] = [
  /^openstax\.org$/,
  /^assets\.openstax\.org$/,
  /(^|\.)libretexts\.org$/,
  ...PRESSBOOKS_PATTERNS,
]

const IP_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$|^\[?[0-9a-f:]+\]?$/i

/**
 * Query-key families commonly interpreted as credentials by HTTP APIs.
 *
 * Normalize separators and bracket notation first, so variants such as
 * `access_token[]`, `oauth-token`, and `X-Amz-Signature` cannot slip around an
 * exact spelling list. Values are deliberately not inspected or logged.
 */
function isCredentialQueryKey(raw: string): boolean {
  const key = raw
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[^a-z0-9]/g, '')

  if (['auth', 'authorization', 'key', 'sig'].includes(key)) return true
  if (['token', 'secret', 'credential', 'password', 'passwd', 'signature'].some(
    (family) => key.includes(family),
  )) return true
  return ['apikey', 'subscriptionkey', 'accesskey'].some((family) => key.includes(family))
}

/**
 * Rejects private, loopback, and reserved hostnames to prevent the relay from
 * being used to access internal services or reserved TLDs.
 */
function isPrivateHostname(host: string): boolean {
  // Single-label hostname (no dots) — not a real institutional domain
  if (!host.includes('.')) return true

  // Reserved private-use TLDs
  if (
    host.endsWith('.corp') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    host.endsWith('.test') ||
    host.endsWith('.intranet') ||
    host.endsWith('.private')
  ) {
    return true
  }

  // home.arpa and *.home.arpa
  if (host === 'home.arpa' || host.endsWith('.home.arpa')) return true

  // Existing patterns: localhost, *.local, *.internal, *.localhost
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) {
    return true
  }

  return false
}

export type TargetCheck =
  | { ok: true; url: URL; kind: 'publisher' | 'canvas' }
  | { ok: false; reason: string }

export function isPressbooksTarget(url: URL): boolean {
  const host = url.hostname.toLowerCase().replace(/\.$/, '')
  return PRESSBOOKS_PATTERNS.some((pattern) => pattern.test(host))
}

export function normalizeSelfHostedCanvasOrigin(raw: string | undefined): string | undefined {
  if (raw === undefined || raw.trim() === '') return undefined

  try {
    const url = new URL(raw.trim())
    const host = url.hostname.toLowerCase().replace(/\.$/, '')
    if (
      url.protocol !== 'https:' ||
      url.username !== '' ||
      url.password !== '' ||
      url.pathname !== '/' ||
      url.search !== '' ||
      url.hash !== '' ||
      isPrivateHostname(host) ||
      IP_LITERAL.test(host)
    ) {
      return undefined
    }
    return url.origin
  } catch {
    return undefined
  }
}

export function isAllowedTarget(raw: string, selfHostedCanvasOrigin?: string): TargetCheck {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: 'malformed url' }
  }

  if (url.protocol !== 'https:') return { ok: false, reason: 'https required' }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'url credentials not allowed' }
  }

  // Normalize the hostname by stripping a trailing dot (FQDN form)
  const host = url.hostname.toLowerCase().replace(/\.$/, '')

  if (isPrivateHostname(host)) return { ok: false, reason: 'private host' }
  if (IP_LITERAL.test(host)) return { ok: false, reason: 'ip literal' }

  const canvasOrigin = normalizeSelfHostedCanvasOrigin(selfHostedCanvasOrigin)

  // A configured Canvas origin wins even if its hostname happens to match a
  // publisher pattern. That classification controls whether credentials and
  // write methods may be forwarded by the Worker.
  if (url.pathname.startsWith('/api/v1/') && canvasOrigin === url.origin) {
    return { ok: true, url, kind: 'canvas' }
  }

  if (PUBLISHER_PATTERNS.some((p) => p.test(host))) {
    for (const key of url.searchParams.keys()) {
      if (isCredentialQueryKey(key)) {
        return { ok: false, reason: 'publisher credentials not allowed' }
      }
    }
    return { ok: true, url, kind: 'publisher' }
  }

  if (url.pathname.startsWith('/api/v1/')) {
    return {
      ok: false,
      reason: selfHostedCanvasOrigin?.trim()
        ? 'canvas origin not allowed'
        : 'canvas access disabled',
    }
  }

  return { ok: false, reason: 'host not allowed' }
}
