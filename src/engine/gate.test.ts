import { enforceGate } from './gate'
import type { GateDeps } from './gate'

const clean: GateDeps = {
  validateAllowlist: async (html) => ({ html, removedSemantic: [] }),
  audit: async () => ({ issues: [] }),
}

test('a clean fragment passes', async () => {
  const r = await enforceGate('<p>hi</p>', clean)
  expect(r.conformance.passedChecks).toBe(true)
  expect(r.badgeWithheld).toBe(false)
})

test('a serious violation blocks', async () => {
  const r = await enforceGate('<img>', {
    ...clean,
    audit: async () => ({ issues: [{ id: 'image-alt', severity: 'error', message: 'no alt' }] }),
  })
  expect(r.conformance.passedChecks).toBe(false)
  expect(r.conformance.blockers).toHaveLength(1)
})

test('a warning does not block', async () => {
  const r = await enforceGate('<p>x</p>', {
    ...clean,
    audit: async () => ({ issues: [{ id: 'x', severity: 'warning', message: 'meh' }] }),
  })
  expect(r.conformance.passedChecks).toBe(true)
  expect(r.conformance.warnings).toHaveLength(1)
})

test('each removed semantic tag is a distinct blocker', async () => {
  const r = await enforceGate('<figure></figure>', {
    ...clean,
    validateAllowlist: async (html) => ({ html, removedSemantic: ['figure', 'figcaption'] }),
  })
  expect(r.conformance.blockers.map((b) => b.id)).toEqual([
    'allowlist-removed-semantic:figure',
    'allowlist-removed-semantic:figcaption',
  ])
})

test('the audit runs on the REPAIRED html, not the input', async () => {
  let audited = ''
  await enforceGate('<script>x</script><p>hi</p>', {
    validateAllowlist: async () => ({ html: '<p>hi</p>', removedSemantic: [] }),
    audit: async (html) => { audited = html; return { issues: [] } },
  })
  expect(audited).toBe('<p>hi</p>')
})

test('advisory and alert issues land in needsHumanReview, not blockers or warnings, and do not block', async () => {
  const r = await enforceGate('<p>x</p>', {
    ...clean,
    audit: async () => ({
      issues: [
        { id: 'adv-1', severity: 'advisory', message: 'consider rephrasing' },
        { id: 'alert-1', severity: 'alert', message: 'possible reading-order issue' },
      ],
    }),
  })
  expect(r.conformance.needsHumanReview.map((i) => i.id)).toEqual(['adv-1', 'alert-1'])
  expect(r.conformance.blockers).toHaveLength(0)
  expect(r.conformance.warnings).toHaveLength(0)
  expect(r.conformance.passedChecks).toBe(true)
  expect(r.badgeWithheld).toBe(false)
})

test('a blocker severity from the audit blocks, and badgeWithheld reflects it', async () => {
  const r = await enforceGate('<div></div>', {
    ...clean,
    audit: async () => ({ issues: [{ id: 'crit-1', severity: 'blocker', message: 'critical failure' }] }),
  })
  expect(r.conformance.blockers.map((b) => b.id)).toEqual(['crit-1'])
  expect(r.conformance.passedChecks).toBe(false)
  expect(r.badgeWithheld).toBe(true)
})

test('GateResult.html is the repaired html', async () => {
  const r = await enforceGate('<script>x</script><p>hi</p>', {
    validateAllowlist: async () => ({ html: '<p>hi</p>', removedSemantic: [] }),
    audit: async () => ({ issues: [] }),
  })
  expect(r.html).toBe('<p>hi</p>')
})

/*
  A stripped url is a blocker for the same reason a removed <figure> is: the
  published bytes no longer carry what the author put there, and the person who
  can fix it is the only one who can decide what to do about it.
*/
test('a stripped url attribute blocks', async () => {
  const r = await enforceGate('<img src="data:image/png;base64,AAAA" alt="A chart">', {
    validateAllowlist: async () => ({
      html: '<img alt="A chart">', removedSemantic: [], strippedUrls: ['img.src'],
    }),
    audit: async () => ({ issues: [] }),
  })
  expect(r.badgeWithheld).toBe(true)
  expect(r.conformance.blockers).toContainEqual(expect.objectContaining({
    id: 'allowlist-stripped-url:img.src',
  }))
})

test('an allowlist result that reports no stripped urls still gates normally', async () => {
  // The field is optional so existing validators keep typechecking; absent must
  // mean "nothing stripped", never "unknown, assume the worst" — a validator
  // that does not report cannot be made to fail every page.
  const r = await enforceGate('<p>hi</p>', clean)
  expect(r.conformance.blockers).toEqual([])
})
