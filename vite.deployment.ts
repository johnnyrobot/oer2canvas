import { normalizePinnedHttpsOrigin } from './worker/allowlist-hosts.js'

/**
 * The build-time decision behind `__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__`.
 *
 * Its own file, and taking the environment as an ARGUMENT rather than reading
 * `process.env`, for one reason: `vite.config.ts` executes its plugin factories
 * at module load, so a test that imported it to reach this function would start
 * React, Tailwind and the PWA plugin to check a string. Here it is a pure
 * function of a record, and `vite.config.test.ts` calls it directly.
 *
 * A separate axis from `OER2CANVAS_DEPLOYMENT_MODE`, deliberately. An operator
 * may self-host this app and an extraction service and still hand out cartridge
 * files; folding a third value into the Canvas mode would invent a coupling
 * that does not exist.
 */
export type WebExtractionMode = 'firecrawl' | 'self-hosted-extractor'

export function selfHostedExtractorOrigin(env: Record<string, string | undefined>): string {
  const mode = env.OER2CANVAS_WEB_EXTRACTION?.trim() || 'firecrawl'
  const raw = env.OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN?.trim()

  if (mode === 'firecrawl') {
    /*
     * Fail closed in BOTH directions, which is the half that is easy to leave
     * out. An origin exported into a shell and silently ignored is how an
     * operator comes to believe a capability is on when it is off — the same
     * failure `wrangler.jsonc`'s committed `DEPLOYMENT_MODE` exists to prevent
     * on the Worker side, arriving from the other end.
     */
    if (raw) {
      throw new Error(
        'OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN is set but is honoured only in '
        + 'self-hosted-extractor mode. Set OER2CANVAS_WEB_EXTRACTION=self-hosted-extractor, '
        + 'or unset the origin.',
      )
    }
    return ''
  }

  if (mode !== 'self-hosted-extractor') {
    throw new Error('OER2CANVAS_WEB_EXTRACTION must be firecrawl or self-hosted-extractor')
  }
  if (!raw) {
    throw new Error('self-hosted-extractor mode requires OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN')
  }

  /*
   * The same rule the pinned Canvas origin obeys, from the same function, so
   * the two capabilities cannot come to disagree about what a pinnable origin
   * is. Loopback and private hosts are refused here rather than at run time
   * because a browser refuses them anyway: measured 2026-08-30 on Chromium 151,
   * an HTTPS page reaches neither. A build error naming this variable is the
   * diagnosable version of that failure.
   */
  const normalized = normalizePinnedHttpsOrigin(raw)
  if (!normalized) {
    throw new Error(
      'OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN must be a public HTTPS FQDN without a path. '
      + 'A loopback, private, or plain-HTTP address cannot be reached from an HTTPS page at '
      + 'all — see README.md, "Optional self-hosted web extraction".',
    )
  }
  return normalized
}
