import { validateAllowlist } from './engine/allowlist'
import { createAuditor } from './engine/audit/auditor'
import { createIframeRunner } from './engine/audit/iframe-runner'
import { enforceGate } from './engine/gate'
import { compileSection } from './engine/compile/index'
import { queueKeyOf, type QueueAnswer } from './engine/compile/answers'
import { fixtureContext, type FixtureName } from './engine/compile/fixture-context'

/**
 * Point the compiled resource urls at the committed fixture images (Task 21).
 * The audit iframe really does load images now that urls are absolute, and no
 * test in this suite may touch the network.
 */
function useLocalImages(html: string): string {
  return html.replace(
    /https:\/\/openstax\.org\/apps\/archive\/[^/]+\/resources\/([0-9a-f]{40})/g,
    (_full, sha: string) =>
      new URL(`/src/sources/fixtures/openstax/resources/${sha}.jpg`, location.origin).href,
  )
}

const LOCAL_RESOURCE_PATH = '/src/sources/fixtures/openstax/resources/'

// Both fixtures' <img> count from the jsdom/Chromium parity test — duplicated
// as a literal rather than imported, same rationale as parity.browser.test.ts.
const EXPECTED_IMAGE_COUNT: Record<FixtureName, number> = { page: 1, 'page-section': 7 }

describe.each<FixtureName>(['page', 'page-section'])('%s through compile and the gate', (name) => {
  it('meets the slice 4 milestone', async () => {
    const { section, ctx } = fixtureContext(name)
    const compiled = compileSection(section, ctx)
    const localized = useLocalImages(compiled.html)

    // `useLocalImages` is load-bearing for "no test in this suite may touch
    // the network" — an identity-function regression here would leave every
    // <img> pointed at openstax.org, and blockers/needsReview/queue would
    // come out byte-identical either way (every <img> carries explicit
    // width/height, so layout does not depend on whether it loads). Assert
    // the rewrite actually happened, not just that the gate still passes.
    expect(localized).not.toContain('https://openstax.org/apps/archive/')
    const localPaths = localized.match(new RegExp(LOCAL_RESOURCE_PATH.replace(/\//g, '\\/'), 'g')) ?? []
    expect(localPaths.length).toBe(EXPECTED_IMAGE_COUNT[name])

    // And prove the rewritten path serves something real, not just that the
    // string matches a pattern: fetch one from the test's own origin (the
    // local dev server, not the network) and check it is actually an image.
    if (localPaths.length > 0) {
      const [firstUrl] = localized.match(/https?:\/\/[^"']*\/src\/sources\/fixtures\/openstax\/resources\/[0-9a-f]{40}\.jpg/) ?? []
      expect(firstUrl).toBeDefined()
      const res = await fetch(firstUrl!)
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch(/^image\//)
    }

    const runner = createIframeRunner()
    try {
      const gate = await enforceGate(localized, {
        validateAllowlist,
        audit: createAuditor(runner),
      })

      // The gate ran end to end: allowlist repair produced real HTML, not an
      // empty or degenerate fragment. Auditing nothing would also report zero
      // issues, which would silently look identical to the expected clean
      // result below — so a non-empty check alone is not enough. The
      // attribution block is appended by the LAST compile step, so its
      // presence in the gate's output means the complete compile pipeline ran and the gate
      // preserved what they produced.
      expect(typeof gate.html).toBe('string')
      expect(gate.html.length).toBeGreaterThan(0)
      const repaired = new DOMParser().parseFromString(gate.html, 'text/html')
      expect(repaired.querySelectorAll('.b2c-attribution').length).toBeGreaterThan(0)

      const measured = {
        blockers: gate.conformance.blockers.length,
        needsReview: gate.conformance.needsHumanReview.length,
        queue: compiled.queue.length,
      }
      // eslint-disable-next-line no-console
      console.info(name, JSON.stringify(measured), JSON.stringify(gate.conformance.blockers))
      // `needsReview` is 1 for section 1.4, NOT 0, and that is correct. The
      // slices 1-3 outcome doc attributed that row entirely to MathML; it is
      // both. Six `<span class="token">` markers carrying circled letters
      // (ⓐⓑⓒ, U+24D0–U+24D2) sit in ordinary content OUTSIDE `<math>`, and
      // axe reports the same `nonBmp` "cannot judge" on them. Task 20's
      // exclusion removes the ~1446 math contributors from that row and
      // cannot touch these six — which is the right outcome, not a
      // shortfall: a row nobody could review shrinks to six nodes a human
      // settles in one glance.
      expect(measured).toEqual(
        name === 'page-section'
          ? { blockers: 0, needsReview: 1, queue: 4 }
          : { blockers: 0, needsReview: 0, queue: 0 },
      )
    } finally {
      await runner.dispose()
    }
  })
})

/**
 * A post-answer re-audit can surface a blocker that accept-time validation
 * missed. This compiles 1.4 with every one of its four items answered, and puts the
 * result through the SAME real allowlist repair and real axe run as the
 * test above. If answering ever starts emitting markup that fails the
 * gate, this is what says so.
 */
describe('the 1.4 fixture, answered end to end', () => {
  it('re-audits clean: applying four answers surfaces no new blocker', async () => {
    const { section, ctx } = fixtureContext('page-section')
    const before = compileSection(section, ctx)
    expect(before.queue).toHaveLength(4)

    // Both write paths, not one. `decorative` sets alt="" and `alt` writes a
    // sentence — different bytes into the published html, and a blocker could
    // come from either. Answering all four decorative would exercise half of
    // what the instructor can actually do.
    const answers = new Map<string, QueueAnswer>(
      before.queue.map((item, i) => [
        queueKeyOf(item),
        i % 2 === 0
          ? ({ type: 'decorative' } as const)
          : ({ type: 'alt', text: 'A step of the worked solution, written as an equation.' } as const),
      ]),
    )
    // Four distinct keys, so the map really carries four answers — the items
    // are four renderings of equations from one worked example, and if any two
    // ever shared a content hash this test would quietly answer three.
    expect(answers.size).toBe(4)

    const compiled = compileSection(section, { ...ctx, answers })
    // The queue empties because compile stops PRODUCING the items, which is the
    // whole mechanism (D5.1) — nothing removes them from a list.
    expect(compiled.queue).toHaveLength(0)

    const localized = useLocalImages(compiled.html)
    expect(localized).not.toContain('https://openstax.org/apps/archive/')

    const runner = createIframeRunner()
    try {
      const gate = await enforceGate(localized, {
        validateAllowlist,
        audit: createAuditor(runner),
      })
      const repaired = new DOMParser().parseFromString(gate.html, 'text/html')
      expect(repaired.querySelectorAll('.b2c-attribution').length).toBeGreaterThan(0)

      // The answers reached the published bytes, rather than the queue merely
      // going quiet: two images carry the written sentence, and the gate kept it.
      const described = [...repaired.querySelectorAll('img')].filter(
        (img) => img.getAttribute('alt') === 'A step of the worked solution, written as an equation.',
      )
      expect(described).toHaveLength(2)

      const measured = {
        blockers: gate.conformance.blockers.length,
        needsReview: gate.conformance.needsHumanReview.length,
        queue: compiled.queue.length,
      }
      // eslint-disable-next-line no-console
      console.info('page-section answered', JSON.stringify(measured), JSON.stringify(gate.conformance.blockers))
      // Identical to the unanswered run above except the queue, which is the
      // point: answering changed the html and changed nothing the gate objects
      // to. `needsReview` stays 1 for the six circled-letter spans, which are
      // ordinary content and have nothing to do with any answer.
      expect(measured).toEqual({ blockers: 0, needsReview: 1, queue: 0 })
    } finally {
      await runner.dispose()
    }
  })
})
