import { assertPreflightHeaders } from './verify-firecrawl-cors.mjs'

/*
 * The three headers that decide whether this feature is buildable at all, and
 * the one that is easy to miss. `access-control-allow-origin: *` on the SUCCESS
 * response is not enough: a vendor that answered 401 without it would give the
 * browser an opaque network error, and this feature could never tell a user
 * their key was wrong. Measured 2026-08-29: the wildcard is present on 200, 401
 * and 403.
 */
test('a preflight is accepted only when it admits both headers this feature sends', () => {
  const ok = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,HEAD,PUT,PATCH,POST,DELETE',
  }
  expect(() => assertPreflightHeaders(204, ok)).not.toThrow()
  expect(() => assertPreflightHeaders(204, { ...ok, 'access-control-allow-headers': 'content-type' }))
    .toThrow(/authorization/)
  expect(() => assertPreflightHeaders(204, { ...ok, 'access-control-allow-methods': 'GET,HEAD' }))
    .toThrow(/POST/)
  expect(() => assertPreflightHeaders(403, ok)).toThrow(/403/)
})
