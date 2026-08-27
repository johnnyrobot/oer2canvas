import { render, screen, fireEvent } from '@testing-library/react'
import { DestinationScreen } from './screens'

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

test('the default public destination exposes only the cartridge path', () => {
  const onChoose = vi.fn()
  render(<DestinationScreen onChoose={onChoose} />)

  expect(screen.queryByRole('button', { name: /A Canvas course/ })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Canvas address')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Access token')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/ }))
  expect(onChoose).toHaveBeenCalledWith({ kind: 'cartridge' })
})

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

// §2.5: "Nothing to set up." The credential-free path stays one click.
test('the cartridge is still chosen in a single click, with nothing to configure', () => {
  const { onChoose } = setup()
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/ }))
  expect(onChoose).toHaveBeenCalledWith({ kind: 'cartridge' })
  expect(screen.queryByLabelText('Canvas address')).not.toBeInTheDocument()
})
