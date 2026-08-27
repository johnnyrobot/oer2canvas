import {
  EMPTY_SHELL, destinationLabel, phaseAvailability, selectionLabel,
  type ShellState,
} from './phases'

const CANVAS = { kind: 'canvas', courseId: 7, courseName: 'Intro Algebra' } as const
const state = (over: Partial<ShellState> = {}): ShellState => ({ ...EMPTY_SHELL, ...over })

test('on first run only Destination is reachable, and the rest say why not', () => {
  const a = phaseAvailability(state())
  expect(a.destination).toEqual({ state: 'available' })
  expect(a.chapters).toEqual({ state: 'unavailable', reason: 'choose where this goes first' })
  expect(a.review).toEqual({ state: 'unavailable', reason: 'select chapters first' })
  expect(a.result).toEqual({ state: 'unavailable', reason: 'nothing has been sent yet' })
})

// The whole point of the sidebar being a progress model: a blocked step is
// visible AND explains itself. A reason that is empty is a hidden step wearing a
// disabled attribute, which is the failure this redesign exists to fix.
test('every unavailable phase carries a non-empty reason', () => {
  for (const s of [state(), state({ destination: CANVAS }), state({ destination: CANVAS, selectedCount: 3 })]) {
    for (const [id, av] of Object.entries(phaseAvailability(s))) {
      if (av.state === 'unavailable') expect(av.reason, id).not.toBe('')
    }
  }
})

test('choosing a destination unlocks Chapters and marks Destination done', () => {
  const a = phaseAvailability(state({ destination: CANVAS }))
  expect(a.destination).toEqual({ state: 'done' })
  expect(a.chapters).toEqual({ state: 'available' })
})

test('Plan stays shut while checks are still running', () => {
  const a = phaseAvailability(state({ destination: CANVAS, selectedCount: 3, preparedCount: 1 }))
  expect(a.plan).toEqual({ state: 'unavailable', reason: 'checks are still running' })
})

// D5 is the product's whole claim, so the sidebar states it rather than letting
// the user walk to Plan and meet a disabled button with no explanation.
test('Plan names the outstanding queue count rather than just refusing', () => {
  const a = phaseAvailability(state({
    destination: CANVAS, selectedCount: 3, preparedCount: 3, unansweredCount: 4,
  }))
  expect(a.plan).toEqual({ state: 'unavailable', reason: '4 items still need answers' })
})

test('Plan opens only when the selection is prepared and the queue is empty', () => {
  const a = phaseAvailability(state({ destination: CANVAS, selectedCount: 3, preparedCount: 3 }))
  expect(a.plan).toEqual({ state: 'available' })
  expect(a.review).toEqual({ state: 'done' })
})

// Walking back to a finished step must not present it as forbidden.
test('a satisfied phase reads done, never unavailable, once later phases move on', () => {
  const a = phaseAvailability(state({
    destination: CANVAS, selectedCount: 2, preparedCount: 2, committed: true,
  }))
  expect(a.destination).toEqual({ state: 'done' })
  expect(a.chapters).toEqual({ state: 'done' })
  expect(a.plan).toEqual({ state: 'done' })
  expect(a.result).toEqual({ state: 'available' })
})

// Absence is information. A chip that disappears when empty teaches the user
// nothing; a chip that says "No chapters selected" teaches them the concept.
test('both chips say something in every state, including empty', () => {
  expect(selectionLabel(0)).toBe('No chapters selected')
  expect(selectionLabel(1)).toBe('1 chapter')
  expect(selectionLabel(5)).toBe('5 chapters')
  expect(destinationLabel(undefined)).toBe('Choose where this goes')
  expect(destinationLabel(CANVAS)).toBe('Intro Algebra')
  expect(destinationLabel({ kind: 'cartridge' })).toBe('Cartridge file')
})
