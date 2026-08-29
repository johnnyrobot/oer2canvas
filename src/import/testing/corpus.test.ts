import { expect, test } from 'vitest'
import { CORPUS_CASES } from './corpus'
import { RELEASED_SOURCES } from '../released-sources'

test('every released file source has at least one corpus case', () => {
  // Criterion 1's "corpus-tested" made checkable: a format nobody wrote a case
  // for is a format this release claims support for on no evidence.
  const covered = new Set(CORPUS_CASES.map((entry) => entry.format))
  for (const source of RELEASED_SOURCES.filter((entry) => entry.kind === 'file')) {
    expect(covered.has(source.format), `no corpus case for ${source.format}`).toBe(true)
  }
})

test('every corpus case says what real-world property it stands in for', () => {
  // A generated fixture is evidence only if a reader can see what it is evidence
  // OF. This is the rule the design makes non-negotiable, enforced.
  for (const entry of CORPUS_CASES) {
    expect(entry.standsInFor.length, `${entry.id} has no rationale`).toBeGreaterThan(20)
  }
})

test('corpus ids are unique', () => {
  const ids = CORPUS_CASES.map((entry) => entry.id)
  expect(new Set(ids).size).toBe(ids.length)
})
