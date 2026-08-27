import { isAllowedTarget } from './allowlist-hosts'

test('allows a LibreTexts subdomain', () => {
  const r = isAllowedTarget('https://chem.libretexts.org/@api/deki/pages/123/contents')
  expect(r.ok).toBe(true)
})

test('allows a Pressbooks network', () => {
  expect(isAllowedTarget('https://ecampusontario.pressbooks.pub/app/uploads/x.jpg').ok).toBe(true)
})

test('allows openstax', () => {
  expect(isAllowedTarget('https://openstax.org/rex/release.json').ok).toBe(true)
})

test('allows the OpenStax assets host, rejects a lookalike suffix', () => {
  expect(isAllowedTarget('https://assets.openstax.org/x.svg').ok).toBe(true)
  expect(isAllowedTarget('https://assets.openstax.org.evil.example/x.svg').ok).toBe(false)
})

test('allows the UCF Pressbooks host, rejects a lookalike subdomain', () => {
  expect(isAllowedTarget('https://pressbooks.online.ucf.edu/x').ok).toBe(true)
  expect(isAllowedTarget('https://evil.pressbooks.online.ucf.edu/x').ok).toBe(false)
})

test('allows Milne Publishing, rejects a lookalike suffix', () => {
  expect(isAllowedTarget('https://milnepublishing.geneseo.edu/x').ok).toBe(true)
  expect(isAllowedTarget('https://milnepublishing.geneseo.edu.evil.example/x').ok).toBe(false)
})

test('allows Maricopa Open, rejects a lookalike prefix', () => {
  expect(isAllowedTarget('https://open.maricopa.edu/x').ok).toBe(true)
  expect(isAllowedTarget('https://notopen.maricopa.edu/x').ok).toBe(false)
})

test('allows Oklahoma State Open Library, rejects a lookalike suffix', () => {
  expect(isAllowedTarget('https://open.library.okstate.edu/x').ok).toBe(true)
  expect(isAllowedTarget('https://open.library.okstate.edu.attacker.test/x').ok).toBe(false)
})

test('Canvas API paths are disabled unless an exact origin is configured', () => {
  expect(isAllowedTarget('https://canvas.ubc.ca/api/v1/courses').ok).toBe(false)
  expect(
    isAllowedTarget('https://canvas.ubc.ca/api/v1/courses', 'https://canvas.ubc.ca').ok,
  ).toBe(true)
  expect(
    isAllowedTarget('https://canvas.other.edu/api/v1/courses', 'https://canvas.ubc.ca').ok,
  ).toBe(false)
})

test('rejects a non-api path on an unknown host', () => {
  const r = isAllowedTarget('https://evil.example/secret')
  expect(r.ok).toBe(false)
})

test('rejects http', () => {
  expect(isAllowedTarget('http://canvas.ubc.ca/api/v1/courses').ok).toBe(false)
})

test('rejects loopback and private hosts', () => {
  expect(isAllowedTarget('https://localhost/api/v1/courses').ok).toBe(false)
  expect(isAllowedTarget('https://127.0.0.1/api/v1/courses').ok).toBe(false)
  expect(isAllowedTarget('https://192.168.1.5/api/v1/courses').ok).toBe(false)
  expect(isAllowedTarget('https://10.0.0.1/api/v1/courses').ok).toBe(false)
  expect(isAllowedTarget('https://foo.internal/api/v1/courses').ok).toBe(false)
})

test('rejects a malformed url', () => {
  expect(isAllowedTarget('not-a-url').ok).toBe(false)
})

test('rejects URL userinfo and publisher credential query parameters', () => {
  expect(isAllowedTarget('https://secret@openstax.org/rex/release.json').ok).toBe(false)
  expect(
    isAllowedTarget('https://openstax.org/rex/release.json?access_token=secret').ok,
  ).toBe(false)
  expect(isAllowedTarget('https://openstax.org/rex/release.json?api_key=secret').ok).toBe(false)
  expect(isAllowedTarget('https://openstax.org/rex/release.json?oauth_token=secret').ok).toBe(false)
  expect(isAllowedTarget('https://openstax.org/rex/release.json?refresh-token=secret').ok).toBe(false)
  expect(isAllowedTarget('https://openstax.org/rex/release.json?access_token[]=secret').ok).toBe(false)
  expect(isAllowedTarget('https://openstax.org/rex/release.json?subscription_key=secret').ok).toBe(false)
  expect(isAllowedTarget('https://openstax.org/rex/release.json?X-Amz-Signature=secret').ok).toBe(false)
  expect(isAllowedTarget('https://openstax.org/rex/release.json?page=2').ok).toBe(true)
})

test('rejects single-label hostnames', () => {
  expect(isAllowedTarget('https://backend/api/v1/x').ok).toBe(false)
  expect(isAllowedTarget('https://intranet/api/v1/x').ok).toBe(false)
})

test('rejects reserved private-use TLDs', () => {
  expect(isAllowedTarget('https://foo.corp/api/v1/x').ok).toBe(false)
  expect(isAllowedTarget('https://foo.lan/api/v1/x').ok).toBe(false)
  expect(isAllowedTarget('https://router.home/api/v1/x').ok).toBe(false)
  expect(isAllowedTarget('https://foo.test/api/v1/x').ok).toBe(false)
  expect(isAllowedTarget('https://foo.intranet/api/v1/x').ok).toBe(false)
  expect(isAllowedTarget('https://foo.private/api/v1/x').ok).toBe(false)
})

test('rejects home.arpa', () => {
  expect(isAllowedTarget('https://foo.home.arpa/api/v1/x').ok).toBe(false)
  expect(isAllowedTarget('https://home.arpa/api/v1/x').ok).toBe(false)
})

test('allows normal FQDN Canvas host (regression guard)', () => {
  const r = isAllowedTarget('https://canvas.ubc.ca/api/v1/courses', 'https://canvas.ubc.ca')
  expect(r.ok).toBe(true)
})

test('an invalid or path-bearing Canvas configuration fails closed', () => {
  expect(isAllowedTarget('https://canvas.ubc.ca/api/v1/courses', 'not-a-url').ok).toBe(false)
  expect(
    isAllowedTarget('https://canvas.ubc.ca/api/v1/courses', 'https://canvas.ubc.ca/courses').ok,
  ).toBe(false)
})

test('rejects dotted institutional host with non-api path', () => {
  const r = isAllowedTarget('https://institution.edu/secret')
  expect(r.ok).toBe(false)
  expect(r.ok === false && r.reason).toBe('host not allowed')
})

test('allows trailing-dot publisher host', () => {
  expect(isAllowedTarget('https://openstax.org./rex/release.json').ok).toBe(true)
  expect(isAllowedTarget('https://chem.libretexts.org./content').ok).toBe(true)
})

test('rejects trailing-dot private host', () => {
  const r = isAllowedTarget('https://localhost./api/v1/x')
  expect(r.ok).toBe(false)
  expect(r.ok === false && r.reason).toBe('private host')
})
