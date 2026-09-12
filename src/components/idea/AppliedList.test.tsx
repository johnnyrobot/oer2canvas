import { fireEvent, render, screen } from '@testing-library/react'
import { AppliedList } from './AppliedList'

test('applied edits are listed with their change and Undo; stale ones say so', () => {
  const onUndo = vi.fn()
  render(
    <AppliedList
      applied={[
        { key: 's1::a::0::suffers from', edit: { kind: 'replace', replacement: 'has' }, stale: false, sectionTitle: 'S', category: '7.6' },
        { key: 's1::b::0::the blind', edit: { kind: 'keep', context: 'as quoted' }, stale: true, sectionTitle: 'S', category: '7.6' },
      ]}
      onUndo={onUndo}
    />,
  )
  expect(screen.getByText('“suffers from” → “has”')).toBeInTheDocument()
  expect(screen.getByText('“the blind” kept, with “(as quoted)”')).toBeInTheDocument()
  expect(screen.getByText('no longer matches; not applied')).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]!)
  expect(onUndo).toHaveBeenCalledWith('s1::a::0::suffers from')
})

test('an empty list renders nothing', () => {
  const { container } = render(<AppliedList applied={[]} onUndo={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
})
