/*
 * The two modules are read as TEXT rather than imported as modules, because this
 * asserts what the source says and not what it does.
 *
 * `?raw` rather than `node:fs`: `tsconfig.json` deliberately omits node types so
 * that a `process` reference in `src/` is a compile error, and its comment says
 * a test needing node belongs in `tsconfig.node.json` — whose own comment says
 * that list is "meant to be hard to grow by accident". Vite's `?raw` reads the
 * same bytes off disk at transform time and grows nothing.
 */
import webSource from './web.ts?raw'
import firecrawlSource from './firecrawl.ts?raw'

/** Every Firecrawl endpoint that would make this something other than one page. */
const FORBIDDEN = ['/v2/crawl', '/v2/map', '/v2/search', '/v2/batch', '/v2/agent'] as const

const SOURCES = { 'web.ts': webSource, 'firecrawl.ts': firecrawlSource }

test('the web import modules name one firecrawl endpoint and no other', () => {
  /*
   * Four independent reasons this feature cannot crawl, of which this is the
   * first: one endpoint is named. The others are structural and are asserted
   * elsewhere — `formats: ['markdown']` means the link set is never received
   * (`firecrawl.test.ts`), `importText` emits a one-element `sections` array
   * (`text.test.ts`), and this path reaches `ImportPlanEditor` rather than
   * `ChapterPicker`, so there is no second network request in it at all
   * (`SourceBrowser.test.tsx`).
   *
   * The check does not care whether a match is code or a comment, which is the
   * point: it caught its own author writing the forbidden paths into an
   * explanatory comment in `firecrawl.ts` on 2026-08-29.
   */
  for (const [name, source] of Object.entries(SOURCES)) {
    for (const path of FORBIDDEN) {
      expect(source, `${name} names ${path}`).not.toContain(path)
    }
  }
  // Present, not merely absent: a check that passes because the endpoint was
  // deleted is not a check.
  expect(firecrawlSource).toContain('/v2/scrape')
})

test('the web import path never mentions the relay', () => {
  // Not a style rule. Routing this key through the app's relay would put a
  // user's vendor credential on this project's infrastructure and reverse the
  // documented posture in `worker/relay.ts`: "Allowlists destination hosts so
  // this cannot become an open proxy."
  for (const [name, source] of Object.entries(SOURCES)) {
    expect(source, `${name} names the relay`).not.toMatch(/['"`]\/relay/)
  }
})
