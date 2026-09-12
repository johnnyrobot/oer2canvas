import { fireEvent, render, screen } from '@testing-library/react'
import { PlaceImageDialog } from './PlaceImageDialog'
import type { ImageHit } from '../../engine/idea/images/search'

const hit: ImageHit = { provider: 'commons', id: 'File:A.jpg', title: 'Students at a bench', thumbUrl: 't', fullUrl: 'f', width: 10, height: 10, license: { kind: 'by-sa', name: 'CC BY-SA 4.0', url: 'u' }, creator: 'Jane', sourcePageUrl: 's' }
const options = [
  { placement: { kind: 'insert-after' as const, elementId: 'b2c-blk-0' }, label: 'After “Intro paragraph…”' },
  { placement: { kind: 'replace' as const, elementId: 'b2c-fig-0' }, label: 'Replace Figure 1' },
]

test('requires alt text, refuses a filename, and states the credit and the share-alike obligation before Use', () => {
  const onUse = vi.fn()
  render(<PlaceImageDialog hit={hit} options={options} onUse={onUse} onCancel={vi.fn()} busy={false} error="" />)
  expect(screen.getByRole('dialog', { name: 'Place this image' })).toBeInTheDocument()
  expect(screen.getByText(/This page will credit: “Students at a bench” by Jane, Wikimedia Commons, CC BY-SA 4.0/)).toBeInTheDocument()
  expect(screen.getByText(/adaptations of the image must carry the same licence/)).toBeInTheDocument()
  const alt = screen.getByRole('textbox', { name: /Describe this image/ })
  fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
  expect(onUse).not.toHaveBeenCalled()
  expect(screen.getByRole('alert')).toHaveTextContent('Not saved: the description is empty.')
  fireEvent.change(alt, { target: { value: 'students.jpg' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
  expect(screen.getByRole('alert')).toHaveTextContent(/file name/)
  fireEvent.change(alt, { target: { value: 'Two students share a microscope at a lab bench.' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Where' }), { target: { value: '1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
  expect(onUse).toHaveBeenCalledWith({ placement: { kind: 'replace', elementId: 'b2c-fig-0' }, alt: 'Two students share a microscope at a lab bench.', caption: '' })
})

test('the caption is optional and passed through; a CC BY image has no share-alike sentence', () => {
  const onUse = vi.fn()
  const by: ImageHit = { ...hit, license: { kind: 'by', name: 'CC BY 4.0', url: 'u' } }
  render(<PlaceImageDialog hit={by} options={options} onUse={onUse} onCancel={vi.fn()} busy={false} error="" />)
  expect(screen.queryByText(/adaptations of the image/)).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('textbox', { name: /Describe this image/ }), { target: { value: 'A bench with two students.' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Caption (optional)' }), { target: { value: 'Lab partners.' } })
  fireEvent.click(screen.getByRole('button', { name: 'Use this image' }))
  expect(onUse.mock.calls[0]![0].caption).toBe('Lab partners.')
})

test('while the bytes are fetched the button is replaced by a status, and a fetch error is shown as an alert', () => {
  const { rerender } = render(<PlaceImageDialog hit={hit} options={options} onUse={vi.fn()} onCancel={vi.fn()} busy error="" />)
  expect(screen.getByRole('status')).toHaveTextContent('Fetching the image…')
  expect(screen.queryByRole('button', { name: 'Use this image' })).not.toBeInTheDocument()
  rerender(<PlaceImageDialog hit={hit} options={options} onUse={vi.fn()} onCancel={vi.fn()} busy={false} error="upload.wikimedia.org does not let this browser fetch it directly." />)
  expect(screen.getByRole('alert')).toHaveTextContent(/upload\.wikimedia\.org/)
})

test('Cancel hands back without using', () => {
  const onCancel = vi.fn()
  render(<PlaceImageDialog hit={hit} options={options} onUse={vi.fn()} onCancel={onCancel} busy={false} error="" />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalled()
})

test('focus moves to the alt field on open, Escape cancels, and focus returns to the opener on close', () => {
  const onCancel = vi.fn()
  const opener = document.createElement('button')
  document.body.appendChild(opener)
  opener.focus()
  const view = render(<PlaceImageDialog hit={hit} options={options} onUse={vi.fn()} onCancel={onCancel} busy={false} error="" />)
  const alt = screen.getByRole('textbox', { name: /Describe this image/ })
  expect(alt).toHaveFocus()
  expect(screen.getByRole('dialog')).not.toHaveAttribute('aria-modal')
  fireEvent.keyDown(alt, { key: 'Escape' })
  expect(onCancel).toHaveBeenCalledTimes(1)
  view.unmount()
  expect(opener).toHaveFocus()
  opener.remove()
})
