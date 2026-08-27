import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { AppShell } from './AppShell'
import { EMPTY_SHELL } from './phases'

function renderShell() {
  return render(
    <AppShell active="destination" onNavigate={vi.fn()} shell={EMPTY_SHELL}>
      <p>content</p>
    </AppShell>,
  )
}

test('the mobile navigation control opens and closes the workflow navigation', () => {
  renderShell()
  const toggle = screen.getByRole('button', { name: 'Toggle navigation' })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
  fireEvent.click(toggle)
  expect(toggle).toHaveAttribute('aria-expanded', 'true')
  fireEvent.click(screen.getByRole('button', { name: 'Close navigation' }))
  expect(toggle).toHaveAttribute('aria-expanded', 'false')
})

test('settings is an actionable dialog rather than a dead control', () => {
  renderShell()
  const settings = screen.getByRole('button', { name: 'Settings' })
  fireEvent.click(settings)
  const dialog = screen.getByRole('dialog', { name: 'Settings' })
  expect(dialog).toBeInTheDocument()
  expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
  fireEvent.click(within(dialog).getByRole('button', { name: 'Dark' }))
  expect(within(dialog).getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  return waitFor(() => expect(settings).toHaveFocus())
})

test('screen heading is focusable for navigation handoff', () => {
  renderShell()
  expect(screen.getByRole('heading', { name: 'Destination' })).toHaveAttribute('tabindex', '-1')
})
