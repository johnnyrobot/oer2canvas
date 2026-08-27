import { render, screen, fireEvent } from '@testing-library/react'
import { CanvasConnect, formatEdited } from './CanvasConnect'

function setup(over: Partial<Parameters<typeof CanvasConnect>[0]> = {}) {
  const onConnect = vi.fn(), onCancel = vi.fn(), onPickCourse = vi.fn(), onForget = vi.fn()
  render(
    <CanvasConnect
      status="idle"
      onConnect={onConnect}
      onCancel={onCancel}
      onPickCourse={onPickCourse}
      onForget={onForget}
      {...over}
    />,
  )
  return { onConnect, onCancel, onPickCourse, onForget }
}

const address = () => screen.getByLabelText('Canvas address')
const token = () => screen.getByLabelText('Access token')

test('asks for the address and the token, each with a visible label', () => {
  setup()
  expect(address()).toBeInTheDocument()
  expect(token()).toBeInTheDocument()
  // §2.3: people do not know where a token comes from unless told, on the screen.
  expect(screen.getByText(/Account → Settings → New Access Token/)).toBeInTheDocument()
})

// A token is shoulder-surfable and 70 characters long, so it is masked by
// default — and unmaskable, because a mistyped one is otherwise unfindable.
test('masks the token, and reveals it on request', () => {
  setup()
  expect(token()).toHaveAttribute('type', 'password')
  fireEvent.click(screen.getByRole('button', { name: 'Show token' }))
  expect(token()).toHaveAttribute('type', 'text')
  fireEvent.click(screen.getByRole('button', { name: 'Hide token' }))
  expect(token()).toHaveAttribute('type', 'password')
})

test('connecting hands over only what was typed', () => {
  const { onConnect } = setup()
  fireEvent.change(address(), { target: { value: 'yourschool.instructure.com' } })
  fireEvent.change(token(), { target: { value: 'secret-token' } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect(onConnect).toHaveBeenCalledWith('yourschool.instructure.com', 'secret-token')
})

test('a self-host deployment pins the Canvas address', () => {
  const { onConnect } = setup({ fixedAddress: 'https://canvas.operator.example' })
  expect(address()).toHaveValue('https://canvas.operator.example')
  expect(address()).toHaveAttribute('readonly')
  expect(screen.getByText('Pinned by this self-hosted deployment.')).toBeInTheDocument()
  fireEvent.change(token(), { target: { value: 'secret-token' } })
  fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
  expect(onConnect).toHaveBeenCalledWith('https://canvas.operator.example', 'secret-token')
})

test('while connecting it says so, disables the fields, and offers Cancel beside the line', () => {
  const { onCancel } = setup({ status: 'connecting' })
  expect(screen.getByText('Connecting to Canvas…')).toBeInTheDocument()
  expect(address()).toBeDisabled()
  expect(token()).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalled()
})

// §2.5, quoted. The copy names both fields because the app cannot tell which one
// is wrong when nothing answered at all.
test('a failed connection says which two things to check', () => {
  setup({ error: 'Could not connect to Canvas. Check the address and token, then try again.' })
  expect(
    screen.getByText('Could not connect to Canvas. Check the address and token, then try again.'),
  ).toBeInTheDocument()
})

test('a failure is announced, not just drawn', () => {
  setup({ error: 'Could not connect to Canvas. Check the address and token, then try again.' })
  expect(screen.getByRole('alert')).toHaveTextContent('Could not connect to Canvas.')
})

const CONNECTED = {
  status: 'idle' as const,
  user: { id: 1, name: 'Ada Lovelace' },
  courses: [
    { id: 7, name: 'Intro Algebra', term: 'Fall 2026' },
    { id: 8, name: 'Biology 101', term: 'Fall 2026' },
  ],
}

test('once connected it names whose token this is, and offers to forget it', () => {
  const { onForget } = setup({ ...CONNECTED })
  fireEvent.change(token(), { target: { value: 'secret-token' } })
  expect(screen.getByText(/Ada Lovelace/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Forget this token' }))
  expect(onForget).toHaveBeenCalled()
  expect(token()).toHaveValue('')
  expect(screen.queryByLabelText(/Remember this token/)).not.toBeInTheDocument()
})

// A radio group, not a select: §2.7 asks for arrow-key movement between courses
// and a full-row click target.
test('courses are a radio group naming the term, because names repeat across years', () => {
  setup(CONNECTED)
  // The term is in the ACCESSIBLE NAME, not merely on screen beside it: two
  // "Intro Algebra" rows a year apart are otherwise indistinguishable to anyone
  // choosing by voice or by screen reader.
  expect(screen.getByRole('radio', { name: 'Intro Algebra Fall 2026' })).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: 'Biology 101 Fall 2026' })).toBeInTheDocument()
})

test('choosing a course reports which one', () => {
  const { onPickCourse } = setup(CONNECTED)
  fireEvent.click(screen.getByRole('radio', { name: /Biology 101/ }))
  expect(onPickCourse).toHaveBeenCalledWith(8)
})

test('an account with nothing it can edit is told so, and told the cartridge still works', () => {
  setup({ ...CONNECTED, courses: [] })
  expect(
    screen.getByText('This account has no courses you can edit. Cartridge export works without one.'),
  ).toBeInTheDocument()
})

const WITH_COURSE = {
  ...CONNECTED,
  selectedCourseId: 7,
  pages: [
    { title: 'Syllabus', url: 'syllabus', updatedAt: '2026-08-12T09:00:00Z' },
    { title: 'Lab safety', url: 'lab-safety', updatedAt: '2026-08-03T14:30:00Z' },
  ],
}

test('shows the pages already in the chosen course, which is the reason this comes first', () => {
  setup(WITH_COURSE)
  expect(screen.getByRole('heading', { name: 'Pages already in Intro Algebra' })).toBeInTheDocument()
  expect(screen.getByText('Syllabus')).toBeInTheDocument()
  expect(screen.getByText('lab-safety')).toBeInTheDocument()
  expect(screen.getAllByText(/Last edited/)).toHaveLength(2)
})

// §2.4 keeps the three questions linked, so the list is not just trivia.
test('says what this list will be used for', () => {
  setup(WITH_COURSE)
  expect(
    screen.getByText('Chapters you pick will be checked against this list on the Plan screen.'),
  ).toBeInTheDocument()
})

test('an empty course is knowledge, and says what follows from it', () => {
  setup({ ...WITH_COURSE, pages: [] })
  expect(
    screen.getByText('This course has no pages yet. Everything you push will be new.'),
  ).toBeInTheDocument()
})

// The course stays selected on failure: losing the selection would make the
// retry a re-do of two steps rather than one.
test('a failed page load offers a retry and keeps the course chosen', () => {
  const onRetryPages = vi.fn()
  setup({ ...WITH_COURSE, pages: undefined, pagesError: true, onRetryPages })
  expect(
    screen.getByText('Could not load pages for Intro Algebra. Check your connection, then try again.'),
  ).toBeInTheDocument()
  expect(screen.getByRole('radio', { name: /Intro Algebra/ })).toBeChecked()
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
  expect(onRetryPages).toHaveBeenCalled()
})

test('an edited date reads as a date, not as a timestamp', () => {
  expect(formatEdited('2026-08-12T09:00:00Z', 'en-GB')).toBe('12 Aug 2026')
})

// Canvas is not obliged to send a parseable date, and a page row reading
// "Last edited Invalid Date" is worse than one showing the raw value.
test('an unparseable date is passed through rather than rendered as Invalid Date', () => {
  expect(formatEdited('not a date', 'en-GB')).toBe('not a date')
})
