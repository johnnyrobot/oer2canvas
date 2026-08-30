import { render, screen, fireEvent } from '@testing-library/react'
import { DestinationScreen } from './screens'

/*
 * THE CANVAS HALF OF `DestinationScreen.test.tsx`, in the `unit-self-hosted`
 * project because it needs a build where the Canvas capability exists.
 *
 * Issue 22 made the destination card and the connection panel fold away on a
 * public build rather than merely go unrendered, so a public-defines project
 * cannot reach them by passing a `canvas` prop any more. The public half of the
 * screen — that neither the card nor its fields appear, and that the cartridge
 * path is one click — stays in the sibling file, where a public build is
 * exactly the configuration under test.
 */
const canvas = {
  status: 'idle' as const,
  onConnect: vi.fn(),
  onCancel: vi.fn(),
  onPickCourse: vi.fn(),
  onForget: vi.fn(),
}

function setup(over: Partial<Parameters<typeof DestinationScreen>[0]> = {}) {
  const onChoose = vi.fn()
  render(<DestinationScreen onChoose={onChoose} canvas={canvas} {...over} />)
  return { onChoose }
}

/*
  The card used to set a destination the app could not honour — `courseId: 0`,
  `courseName: 'A Canvas course'` — which put a fictional course in the top bar
  and on the Plan screen. Choosing Canvas is now the START of a decision.
*/
test('choosing Canvas opens the connection form rather than inventing a course', () => {
  const { onChoose } = setup()
  fireEvent.click(screen.getByRole('button', { name: /A Canvas course/ }))
  expect(screen.getByLabelText('Canvas address')).toBeInTheDocument()
  expect(onChoose).not.toHaveBeenCalled()
})

test('the destination becomes real only when a course is chosen', () => {
  const { onChoose } = setup({
    canvas: {
      ...canvas,
      user: { id: 1, name: 'Ada' },
      courses: [{ id: 7, name: 'Intro Algebra', term: 'Fall 2026' }],
    },
  })
  fireEvent.click(screen.getByRole('button', { name: /A Canvas course/ }))
  fireEvent.click(screen.getByRole('radio', { name: /Intro Algebra/ }))
  expect(onChoose).toHaveBeenCalledWith({
    kind: 'canvas',
    courseId: 7,
    courseName: 'Intro Algebra',
  })
})
