import { fireEvent, render, screen } from '@testing-library/react'
import { FindingRow } from './FindingRow'
import type { EditFinding, ObservationFinding } from '../../engine/idea/findings'

const edit: EditFinding = {
  kind: 'edit', key: 's1::a::0::suffers from', category: '7.6', sectionId: 's1', elementId: 'a',
  original: 'suffers from', occurrence: 0, replacement: 'has', inQuotation: false,
  rule: { id: 'ablist-suffers-from', source: 'terms', note: 'Say what the person has.', sourceUrl: 'https://ncdj.org/style-guide/' },
  origin: 'rule',
}

test('a rule edit finding shows original, replacement, note, source link, and location', () => {
  render(<FindingRow finding={edit} sectionTitle="4.2 Nutrients" onEvent={vi.fn()} onFocus={vi.fn()} />)
  expect(screen.getByText('suffers from')).toBeInTheDocument()
  expect(screen.getByText('has')).toBeInTheDocument()
  expect(screen.getByText('Say what the person has.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /ncdj\.org/ })).toHaveAttribute('href', 'https://ncdj.org/style-guide/')
  expect(screen.getByText('in 4.2 Nutrients')).toBeInTheDocument()
  expect(screen.getByText('rule')).toBeInTheDocument()
})

test('Replace dispatches a replace event with the finding’s replacement', () => {
  const onEvent = vi.fn()
  render(<FindingRow finding={edit} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'replace', key: edit.key, replacement: 'has', category: '7.6' })
})

test('Edit… opens a field prefilled with the replacement and Save dispatches what was typed', () => {
  const onEvent = vi.fn()
  render(<FindingRow finding={edit} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit…' }))
  const field = screen.getByRole('textbox', { name: 'Replacement' })
  expect(field).toHaveValue('has')
  fireEvent.change(field, { target: { value: 'is living with' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'replace', key: edit.key, replacement: 'is living with', category: '7.6' })
})

test('a quotation finding leads with Keep, add context… and Save dispatches a keep with context', () => {
  const onEvent = vi.fn()
  render(<FindingRow finding={{ ...edit, inQuotation: true }} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  expect(screen.getByText('inside a quotation')).toBeInTheDocument()
  const buttons = screen.getAllByRole('button').map((b) => b.textContent)
  expect(buttons.indexOf('Keep, add context…')).toBeLessThan(buttons.indexOf('Replace'))
  fireEvent.click(screen.getByRole('button', { name: 'Keep, add context…' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Context to add after the term' }), { target: { value: 'a term used at the time' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'keep', key: edit.key, context: 'a term used at the time', category: '7.6' })
})

test('Keep as is dispatches a keep without context; Dismiss dispatches dismiss', () => {
  const onEvent = vi.fn()
  render(<FindingRow finding={edit} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Keep as is' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'keep', key: edit.key, category: '7.6' })
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'dismiss', key: edit.key })
})

test('focus and blur report the element to highlight', () => {
  const onFocus = vi.fn()
  render(<FindingRow finding={edit} sectionTitle="s" onEvent={vi.fn()} onFocus={onFocus} />)
  fireEvent.focus(screen.getByRole('button', { name: 'Replace' }))
  expect(onFocus).toHaveBeenLastCalledWith({ sectionId: 's1', elementId: 'a' })
  fireEvent.blur(screen.getByRole('button', { name: 'Replace' }))
  expect(onFocus).toHaveBeenLastCalledWith(undefined)
})

test('an observation renders its columns and a Use-this-wording button when a suggestion is present', () => {
  const obs: ObservationFinding = {
    kind: 'observation', key: 's1::a::0::hit the books', category: '7.6', sectionId: 's1', elementId: 'a',
    columns: { idiom: 'hit the books', gloss: 'study hard', suggestion: 'hit the books (study hard)' },
    rule: { id: 'idiom-hit-the-books', source: 'idiom' }, origin: 'rule',
  }
  const onEvent = vi.fn()
  render(<FindingRow finding={obs} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  expect(screen.getByText('study hard')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Use this wording' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'replace', key: obs.key, replacement: 'hit the books (study hard)', category: '7.6' })
})

test('a draft finding is labelled draft', () => {
  render(<FindingRow finding={{ ...edit, origin: 'draft' }} sectionTitle="s" onEvent={vi.fn()} onFocus={vi.fn()} />)
  expect(screen.getByText('draft')).toBeInTheDocument()
})

test('an inventory observation has no Dismiss and no suggestion controls', () => {
  const inv: ObservationFinding = {
    kind: 'observation', key: 's1::i1::0::image', category: '7.1', sectionId: 's1', elementId: 'i1',
    columns: { image: 'a.png', description: 'A nurse', 'mentions people': 'yes' },
    rule: { id: 'inventory-image', source: 'inventory' }, origin: 'rule',
  }
  render(<FindingRow finding={inv} sectionTitle="s" onEvent={vi.fn()} onFocus={vi.fn()} />)
  expect(screen.getByText('A nurse')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Use this wording' })).not.toBeInTheDocument()
})
