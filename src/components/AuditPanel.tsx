import { useId } from 'react'
import type { GateResult } from '../engine/gate'

/**
 * One section's gate result.
 *
 * The heading id is generated with `useId()` rather than hard-coded, because
 * `ChapterView` renders one of these PER SECTION: a literal id would put N
 * identical ids in the document for an N-section chapter, and accessible-name
 * resolution takes the first match — so every panel would be announced with the
 * first section's label, and `aria-labelledby` would point at a duplicated id.
 *
 * Worth stating why that was not caught by our own self-audit for a while: axe
 * classifies `duplicate-id-aria` as INCOMPLETE, not a violation, because a scoped
 * run cannot prove document-wide uniqueness. A violations-only assertion is
 * structurally blind to it, which is why `App.a11y.browser.test.tsx` now also
 * asserts directly that no id repeats.
 */
export function AuditPanel({ result }: { result: GateResult }) {
  const headingId = useId()
  const { blockers, warnings, needsHumanReview, passedChecks } = result.conformance
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>Accessibility</h3>
      <p>{passedChecks ? 'No blocking issues found.' : `${blockers.length} blocking issue(s).`}</p>
      {blockers.length > 0 && (
        <>
          <h4>Blockers</h4>
          <ul>
            {blockers.map((b, i) => (
              <li key={`${b.id}-${i}`}>
                <strong>{b.id}</strong> — {b.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {warnings.length > 0 && (
        <>
          <h4>Warnings</h4>
          <ul>{warnings.map((w, i) => <li key={`${w.id}-${i}`}>{w.message}</li>)}</ul>
        </>
      )}
      {needsHumanReview.length > 0 && (
        <>
          <h4>Needs review</h4>
          <ul>{needsHumanReview.map((n, i) => <li key={`${n.id}-${i}`}>{n.message}</li>)}</ul>
        </>
      )}
    </section>
  )
}
