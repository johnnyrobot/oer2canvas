import { selfHostedExtractorOrigin } from './vite.deployment'

const ORIGIN = 'https://extract.example.edu'

test('the default build has the capability compiled out', () => {
  expect(selfHostedExtractorOrigin({})).toBe('')
  expect(selfHostedExtractorOrigin({ OER2CANVAS_WEB_EXTRACTION: 'firecrawl' })).toBe('')
  // Whitespace is not a mode. A CI variable that ended up as " " must not
  // silently become the opted-in build or the public one by accident; blank
  // falls back to the public default, which is the safe direction.
  expect(selfHostedExtractorOrigin({ OER2CANVAS_WEB_EXTRACTION: '  ' })).toBe('')
})

test('an opted-in build bakes in the exact origin, with the trailing slash removed', () => {
  expect(selfHostedExtractorOrigin({
    OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor',
    OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: `${ORIGIN}/`,
  })).toBe(ORIGIN)
})

test.each([
  [
    'an unknown mode',
    { OER2CANVAS_WEB_EXTRACTION: 'crawl4ai' },
    /must be firecrawl or self-hosted-extractor/,
  ],
  [
    'the mode with no origin',
    { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor' },
    /requires OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN/,
  ],
  [
    // The direction that is easy to leave out: a variable that is set and
    // silently ignored is how a capability appears on while it is off.
    'an origin with no mode',
    { OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: ORIGIN },
    /honoured only in self-hosted-extractor mode/,
  ],
  [
    'plain http',
    { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'http://extract.example.edu' },
    /public HTTPS FQDN/,
  ],
  [
    // Measured 2026-08-30: an HTTPS page cannot reach a loopback origin at all.
    'loopback',
    { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://localhost:11235' },
    /public HTTPS FQDN/,
  ],
  [
    'an ip literal',
    { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://10.0.0.5' },
    /public HTTPS FQDN/,
  ],
  [
    'a reserved private hostname',
    { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://extract.internal' },
    /public HTTPS FQDN/,
  ],
  [
    'a path',
    { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://extract.example.edu/api' },
    /public HTTPS FQDN/,
  ],
  [
    'credentials in the url',
    { OER2CANVAS_WEB_EXTRACTION: 'self-hosted-extractor', OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN: 'https://user:pass@extract.example.edu' },
    /public HTTPS FQDN/,
  ],
])('refuses %s', (_label, env, message) => {
  expect(() => selfHostedExtractorOrigin(env)).toThrow(message)
})
