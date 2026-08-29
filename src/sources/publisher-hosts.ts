import { pressbooksNetworks } from './catalogs'
import type { PublisherSourceId } from './types'

/**
 * Which publisher, if any, already has a tab of its own for this host.
 *
 * MIRRORS `PUBLISHER_PATTERNS` in `worker/allowlist-hosts.ts` and is not
 * imported from it. Nothing in production `src/` imports from `worker/` today —
 * only `relay.browser.test.ts` does — and pulling Worker code into the browser
 * bundle to read a hostname list would be a new boundary crossing for no gain.
 *
 * The Pressbooks half is not a copy at all: it reads `pressbooksNetworks`, the
 * same generated snapshot the Pressbooks tab loads from, so the two cannot
 * disagree about which networks exist. Only the two fixed families below are
 * written twice, and this comment is why.
 *
 * Used ONLY to nudge. Nothing routes, refuses or redirects on this answer: a
 * control that silently did something other than what its button says is the
 * surprise this repo's fail-closed rule exists to prevent.
 */
export function publisherForHost(hostname: string): PublisherSourceId | undefined {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'libretexts.org' || host.endsWith('.libretexts.org')) return 'libretexts'
  if (host === 'openstax.org' || host === 'assets.openstax.org') return 'openstax'
  if (pressbooksNetworks.some((network) => network.host.toLowerCase() === host)) return 'pressbooks'
  return undefined
}

export const PUBLISHER_TAB_LABELS: Readonly<Record<PublisherSourceId, string>> = {
  openstax: 'OpenStax',
  libretexts: 'LibreTexts',
  pressbooks: 'Pressbooks',
}
