import { createDefaultOpenStaxClient } from './openstax'
import release from './fixtures/openstax/release.json'
import bookToc from './fixtures/openstax/book-toc.json'

/**
 * The app's ONE network construction, exercised in a real browser.
 *
 * `createOpenStaxClient` calls its injected fetch as `deps.fetch(url)` — a
 * method call, so the receiver is the deps bag and not the global. Every unit
 * test runs under Node, whose undici `fetch` ignores its receiver entirely, so
 * the whole 179-test unit project is structurally incapable of noticing what
 * receiver the app hands the platform. This file is the one that can.
 *
 * WHAT IS ASSERTED, and why it is the receiver rather than a throw: Blink and
 * WebKit both brand-check the receiver of a WebIDL operation on the global and
 * reject a foreign object with a `TypeError` — measured 2026-08-21 in Chromium
 * 151.0.7922.34 and WebKit 26.5 for `atob`, `querySelector`,
 * `getComputedStyle`, the `localStorage` getter, and for `fetch` itself:
 * `({ fetch: window.fetch }).fetch(url)` fails with `TypeError: Failed to
 * execute 'fetch' on 'Window': Illegal invocation` (Blink) and `TypeError: Can
 * only call Window.fetch on instances of Window` (WebKit). `fetch` differs from
 * its neighbours only in HOW it fails: it returns a promise, so WebIDL delivers
 * that TypeError as a REJECTED PROMISE instead of a synchronous throw, and a
 * probe that does not await the result sees what looks like success. That is how
 * the unbound construction read as harmless; unbound, the app's first book click
 * would have rejected before a request was ever made.
 *
 * A throw is still not what this test waits for. It asserts the invariant the
 * binding establishes — the platform sees the GLOBAL as the receiver, never the
 * deps bag — through a stub, so it holds whichever way an engine chooses to
 * deliver the failure, and it fails against the unbound construction on every
 * engine.
 */

const UUID = '13ac107a-f15f-49d2-97e8-60ab2e3b519c'

test('the shipped client calls the global fetch with the global as its receiver', async () => {
  const realFetch = window.fetch
  const receivers: unknown[] = []
  const urls: string[] = []

  try {
    // A genuine replacement installed ON THE WINDOW and genuinely invoked — not
    // a pre-bound function handed to the client, which would defeat the point by
    // fixing the receiver before the client ever touches it. Declared with
    // `function` rather than an arrow precisely so it can observe its own
    // receiver; an arrow would close over the module's `this` and see nothing.
    window.fetch = function (this: unknown, input: RequestInfo | URL): Promise<Response> {
      receivers.push(this)
      const url = String(input)
      urls.push(url)
      // Decoded, because the shipped client sends the release manifest through
      // `/relay?url=<percent-encoded target>` — matching on the literal path
      // would silently serve the wrong body.
      const body = decodeURIComponent(url).includes('/rex/release.json') ? release : bookToc
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
    } as typeof window.fetch

    const toc = await createDefaultOpenStaxClient().fetchToc(UUID)

    // The call really went through the stub and really produced a parsed TOC:
    // release manifest first, then the book contents.
    expect(urls).toHaveLength(2)
    // Hop 1 goes through the relay: `/rex/release.json` sends no CORS header and
    // a browser cannot reach it directly. Hop 2 does not: the archive endpoints
    // do send the header, so relaying them would cost a request for nothing.
    expect(urls[0]).toBe('/relay?url=' + encodeURIComponent('https://openstax.org/rex/release.json'))
    expect(urls[1]).toContain(`/contents/${UUID}@`)
    expect(urls[1]).not.toContain('/relay')
    expect(toc.title).toBe('Algebra and Trigonometry')

    // The assertion that fails against `fetch: globalThis.fetch`, where every
    // receiver would be the deps bag `{ fetch }` instead.
    expect(receivers).toHaveLength(2)
    for (const receiver of receivers) expect(receiver).toBe(window)
  } finally {
    window.fetch = realFetch
  }
})

test('a foreign receiver is rejected by the platform for operations on the global', () => {
  // The brand check is real and alive in this engine — which is what makes the
  // receiver worth pinning above even while `fetch` itself still tolerates one.
  // No network is involved: the check throws before any work is done.
  expect(() => ({ atob: window.atob }).atob('')).toThrow(TypeError)
  expect(() => ({ g: window.getComputedStyle }).g.call({}, document.body)).toThrow(TypeError)
})
