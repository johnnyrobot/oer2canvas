import { describe, it, expect } from 'vitest'
import { isPublishable } from './index'
import type { CompiledChapter, QueueItem } from './index'
import type { GateResult } from '../engine/gate'

const clean: GateResult = {
  html: '<p>x</p>',
  conformance: { passedChecks: true, blockers: [], warnings: [], needsHumanReview: [] },
  badgeWithheld: false,
}

const item: QueueItem = {
  kind: 'confirm-decorative',
  sectionId: 's1',
  elementId: 'b2c-img-1',
  context: { src: 'https://x/y' },
}

const chapter = (over: Partial<CompiledChapter> = {}): CompiledChapter => ({
  chapter: { title: 'c' } as CompiledChapter['chapter'],
  sections: [{ id: 's1', title: 't', html: '<p>x</p>', notes: [], queue: [], gate: clean }],
  queue: [],
  ...over,
})

describe('isPublishable', () => {
  it('is true when there are no blockers and the queue is empty', () => {
    expect(isPublishable(chapter())).toBe(true)
  })

  it('is FALSE while the queue is non-empty, even though every gate passed', () => {
    // D5: nothing publishes until the queue is empty. This is the exact case
    // `GateResult.passedChecks` gets wrong — it is `true` here.
    const c = chapter({ queue: [item] })
    expect(c.sections[0]!.gate!.conformance.passedChecks).toBe(true)
    expect(isPublishable(c)).toBe(false)
  })

  it('is false when a section failed to compile', () => {
    expect(
      isPublishable(
        chapter({ sections: [{ id: 's1', title: 't', html: '', notes: [], queue: [], error: 'boom' }] }),
      ),
    ).toBe(false)
  })

  it('is false when a section was never audited', () => {
    expect(
      isPublishable(chapter({ sections: [{ id: 's1', title: 't', html: '<p>x</p>', notes: [], queue: [] }] })),
    ).toBe(false)
  })

  it('is false when any gate reports a blocker', () => {
    const blocked: GateResult = {
      ...clean,
      conformance: {
        passedChecks: false,
        blockers: [{ id: 'x', severity: 'blocker', message: 'm' }],
        warnings: [],
        needsHumanReview: [],
      },
      badgeWithheld: true,
    }
    expect(
      isPublishable(
        chapter({ sections: [{ id: 's1', title: 't', html: '<p>x</p>', notes: [], queue: [], gate: blocked }] }),
      ),
    ).toBe(false)
  })
})
