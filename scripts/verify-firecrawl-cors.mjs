/**
 * Does a REAL browser accept a cross-origin request to Firecrawl?
 *
 * The design settled the fetch route on four curl probes (2026-08-29). curl is
 * not a browser: it never issues a preflight and never enforces one. This
 * probe closes that gap. It sends NO API KEY and spends NO FIRECRAWL CREDIT —
 *
 *  - the preflight carries no `Authorization` header, only the promise that one
 *    is coming, so the header contract is measured without a secret;
 *  - the request the preflight clears is unauthenticated and stops at
 *    Firecrawl's 401 before any page is scraped, so no credit is consumed;
 *  - it asserts a header contract, not a scrape result.
 *
 * WHY THE UNAUTHENTICATED REQUEST IS ALLOWED TO LAND. The plan asked for a
 * preflight-only probe, aborting the request that follows. That cannot be done
 * without destroying the measurement: Playwright's routing intercepts a request
 * BEFORE the network stack issues its CORS preflight, so aborting the POST
 * means no preflight is ever sent and the probe measures nothing. Letting the
 * keyless POST land costs nothing and proves strictly more — that the browser
 * surfaces a READABLE 401 rather than an opaque CORS failure, which is the only
 * reason this feature can ever tell a user their key is wrong.
 *
 * It is not part of `npm test`. It talks to a third party, so it must never
 * make the offline suite depend on a vendor being up. If it ever FAILS, the
 * browser-direct posture has been withdrawn by the vendor and the human has to
 * choose from the option table in the design again — do not work around it.
 */
import { createServer } from 'node:http'

const FIRECRAWL_ENDPOINT = 'https://api.firecrawl.dev/v2/scrape'

/**
 * Not a key. The preflight must ASK for the `authorization` header or the
 * vendor is never made to answer the question this probe exists to ask, and the
 * request that follows must fail authentication rather than scrape anything.
 */
const NOT_A_KEY = 'Bearer fc-preflight-probe-no-key'

export function assertPreflightHeaders(status, headers) {
  // 204 is what was measured. Anything else means the vendor answered the
  // preflight differently and the contract must be re-read, not coerced.
  if (status !== 204 && status !== 200) {
    throw new Error(`Preflight answered ${status}; expected 204.`)
  }
  const origin = headers['access-control-allow-origin']
  if (origin !== '*') {
    throw new Error(`access-control-allow-origin was ${origin ?? 'absent'}; expected *.`)
  }
  const allowed = (headers['access-control-allow-headers'] ?? '').toLowerCase()
  for (const header of ['authorization', 'content-type']) {
    if (!allowed.split(',').map((v) => v.trim()).includes(header)) {
      throw new Error(`access-control-allow-headers omits ${header}: "${allowed}".`)
    }
  }
  const methods = (headers['access-control-allow-methods'] ?? '').toUpperCase()
  if (!methods.split(',').map((v) => v.trim()).includes('POST')) {
    throw new Error(`access-control-allow-methods omits POST: "${methods}".`)
  }
}

/**
 * A throwaway origin for the page to sit on. `about:blank` and `data:` URLs
 * both have a null origin, which the browser sends as `Origin: null` — a
 * different code path from the real, non-null origin this app will be served
 * from, and one a vendor could plausibly answer differently.
 */
async function serveForeignOrigin() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><meta charset="utf-8"><title>firecrawl cors probe</title>')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { origin: `http://127.0.0.1:${port}`, close: () => new Promise((resolve) => server.close(resolve)) }
}

async function main() {
  const { chromium } = await import('playwright')
  const foreignOrigin = await serveForeignOrigin()
  const browser = await chromium.launch({ headless: true })
  try {
    const page = await browser.newPage()

    // The preflight is issued by the network stack, not by page script, so it
    // can only be observed — never constructed. `Access-Control-Request-*` are
    // forbidden header names precisely so that a page cannot forge this.
    //
    // Playwright's own `page.on('request'|'response')` does NOT report
    // preflights: they are issued beneath the layer those events describe, and
    // listening there observes nothing (measured 2026-08-29 — the first draft of
    // this probe saw zero preflights that way). CDP's Network domain reports
    // them as a request of type `Preflight`, which is the only place the header
    // contract is visible.
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    const preflightIds = new Set()
    const preflights = []
    cdp.on('Network.requestWillBeSent', (event) => {
      if (event.request.method === 'OPTIONS' && event.request.url.startsWith(FIRECRAWL_ENDPOINT)) {
        preflightIds.add(event.requestId)
      }
    })
    const record = (requestId, status, rawHeaders) => {
      if (!preflightIds.has(requestId)) return
      // CDP reports headers with the case the vendor sent. Every reader below
      // indexes them in lower case.
      const headers = {}
      for (const [name, value] of Object.entries(rawHeaders ?? {})) headers[name.toLowerCase()] = value
      preflights.push({ status, headers })
    }
    // `responseReceivedExtraInfo` carries the raw headers as they came off the
    // wire; `responseReceived` is the fallback when the network service does not
    // emit the extra-info event.
    cdp.on('Network.responseReceivedExtraInfo', (event) => record(event.requestId, event.statusCode, event.headers))
    cdp.on('Network.responseReceived', (event) => record(event.requestId, event.response.status, event.response.headers))

    await page.goto(`${foreignOrigin.origin}/`)
    const actual = await page.evaluate(async ({ endpoint, notAKey }) => {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: { authorization: notAKey, 'content-type': 'application/json' },
          body: JSON.stringify({ url: 'https://example.com', formats: ['markdown'] }),
        })
        return { reached: true, status: response.status }
      } catch (error) {
        // A CORS refusal reaches page script as an opaque TypeError with no
        // status. That is the outcome this whole posture is betting against.
        return { reached: false, error: String(error) }
      }
    }, { endpoint: FIRECRAWL_ENDPOINT, notAKey: NOT_A_KEY })

    if (preflights.length === 0) {
      throw new Error(
        `No preflight was observed for ${FIRECRAWL_ENDPOINT}. The browser either short-circuited `
        + 'the request or the vendor moved the endpoint; the header contract was NOT measured. '
        + `The keyless POST itself reported: ${JSON.stringify(actual)}`,
      )
    }

    const preflight = preflights[0]
    const { headers } = preflight
    // The values are the evidence, not the exit code. Print them either way.
    console.log(`origin under test:                  ${foreignOrigin.origin}`)
    console.log(`preflight status:                   ${preflight.status}`)
    console.log(`access-control-allow-origin:        ${headers['access-control-allow-origin'] ?? '(absent)'}`)
    console.log(`access-control-allow-headers:       ${headers['access-control-allow-headers'] ?? '(absent)'}`)
    console.log(`access-control-allow-methods:       ${headers['access-control-allow-methods'] ?? '(absent)'}`)
    console.log(
      actual.reached
        ? `keyless POST readable by page script: HTTP ${actual.status}`
        : `keyless POST was OPAQUE to page script: ${actual.error}`,
    )

    assertPreflightHeaders(preflight.status, headers)

    // A preflight that passes but a response the page cannot read still leaves
    // this feature unable to report an auth failure. Both halves must hold.
    if (!actual.reached) {
      throw new Error('The preflight passed but the response was opaque to page script.')
    }
    console.log('\nbrowser-direct Firecrawl verification passed')
  } finally {
    await browser.close()
    await foreignOrigin.close()
  }
}

// `main()` drives Playwright and is never run by vitest, which imports only the
// pure assertion above.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
