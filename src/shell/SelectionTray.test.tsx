import { render, screen, fireEvent } from '@testing-library/react'
import { SelectionTray } from './SelectionTray'

const items = [
  { id: 'a', title: 'Chapter 1 The Study of Life', sectionCount: 8 },
  { id: 'b', title: 'Chapter 2 The Chemical Foundation of Life', sectionCount: 9 },
]

function setup(over: Partial<Parameters<typeof SelectionTray>[0]> = {}) {
  const onRemove = vi.fn(), onClear = vi.fn(), onClose = vi.fn()
  render(<SelectionTray items={items} onRemove={onRemove} onClear={onClear} onClose={onClose} {...over} />)
  return { onRemove, onClear, onClose }
}

test('names what is selected and the total it adds up to', () => {
  setup()
  expect(screen.getByRole('heading', { name: '2 chapters selected' })).toBeInTheDocument()
  expect(screen.getByText('17 sections in total')).toBeInTheDocument()
})

// A list of eight identical "Remove" buttons is unusable by anyone navigating by
// control, which is the whole reason the title is in the accessible name.
test('each remove button names the chapter it removes', () => {
  const { onRemove } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Remove Chapter 2 The Chemical Foundation of Life from the selection' }))
  expect(onRemove).toHaveBeenCalledWith('b')
})

test('it is a modal dialog with an accessible name', () => {
  setup()
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveAttribute('aria-modal', 'true')
  expect(dialog).toHaveAccessibleName('2 chapters selected')
})

test('Escape closes it', () => {
  const { onClose } = setup()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(onClose).toHaveBeenCalled()
})

// §1.5: anything that throws work away confirms. A second click on a button that
// has changed its own label does that without stacking a modal on a modal.
test('Clear all takes two clicks, and says so in between', () => {
  const { onClear } = setup()
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
  expect(onClear).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /click again to confirm/i }))
  expect(onClear).toHaveBeenCalled()
})

test('the singular reads properly', () => {
  setup({ items: [items[0]!] })
  expect(screen.getByRole('heading', { name: '1 chapter selected' })).toBeInTheDocument()
  expect(screen.getByText('8 sections in total')).toBeInTheDocument()
})
