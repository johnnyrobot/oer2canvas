import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ImageSearch } from './ImageSearch'
import type { ImageHit, ImageSearch as Port } from '../../engine/idea/images/search'

const hit: ImageHit = { provider: 'commons', id: 'File:A.jpg', title: 'Students', thumbUrl: 'https://t/a', fullUrl: 'https://f/a', width: 10, height: 10, license: { kind: 'by-sa', name: 'CC BY-SA 4.0', url: 'u' }, creator: 'Jane', sourcePageUrl: 'https://s/a' }
const port = (id: 'commons' | 'openverse', hits: ImageHit[], offered = true): Port =>
  ({ id, label: id === 'commons' ? 'Wikimedia Commons' : 'Openverse', offered, evidence: 'e', search: vi.fn(async () => hits) })

test('searches the chosen source with the chosen licences and shows results with licence badges', async () => {
  const commons = port('commons', [hit])
  const onChoose = vi.fn()
  render(<ImageSearch initialQuery="students" onChoose={onChoose} onClose={vi.fn()} sources={[]} providers={[commons, port('openverse', [])]} />)
  expect(screen.getByRole('textbox', { name: 'Search for' })).toHaveValue('students')
  fireEvent.click(screen.getByRole('checkbox', { name: /CC BY-SA/ })) // turn off BY-SA
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() => expect(commons.search).toHaveBeenCalledWith('students', expect.objectContaining({ licenses: ['cc0', 'by', 'pd'] })))
  expect(await screen.findByText('Students')).toBeInTheDocument()
  expect(screen.getByText('CC BY-SA 4.0')).toBeInTheDocument()
  expect(screen.getByText('by Jane')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /Use this image/ }))
  expect(onChoose).toHaveBeenCalledWith(hit)
})

test('zero results shows the guidance and the More sources list', async () => {
  render(<ImageSearch onChoose={vi.fn()} onClose={vi.fn()} sources={[{ label: 'nappy', url: 'https://nappy.co/' }]} providers={[port('commons', [])]} />)
  fireEvent.change(screen.getByRole('textbox', { name: 'Search for' }), { target: { value: 'x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByText(/No images matched/)).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /nappy/ })).toHaveAttribute('href', 'https://nappy.co/')
})

test('the Framework guidance sits above the results', () => {
  render(<ImageSearch onChoose={vi.fn()} onClose={vi.fn()} sources={[]} providers={[port('commons', [])]} />)
  expect(screen.getByText('Look for people whose identity is not the subject of the image.')).toBeInTheDocument()
})

test('a provider that is not offered is listed but disabled, and says why', () => {
  render(<ImageSearch onChoose={vi.fn()} onClose={vi.fn()} sources={[]} providers={[port('commons', []), port('openverse', [], false)]} />)
  expect(screen.getByRole('option', { name: 'Openverse' })).toBeDisabled()
  expect(screen.getByText('Openverse could not be reached from a browser when last measured.')).toBeInTheDocument()
})

test('a failed search shows the provider message as an alert', async () => {
  const failing: Port = { ...port('commons', []), search: vi.fn(async () => { throw new Error('Wikimedia Commons could not be reached (HTTP 503).') }) }
  render(<ImageSearch initialQuery="x" onChoose={vi.fn()} onClose={vi.fn()} sources={[]} providers={[failing]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Wikimedia Commons could not be reached (HTTP 503).')
})

test('Close hands back to the caller', () => {
  const onClose = vi.fn()
  render(<ImageSearch onChoose={vi.fn()} onClose={onClose} sources={[]} providers={[port('commons', [])]} />)
  fireEvent.click(screen.getByRole('button', { name: 'Close image search' }))
  expect(onClose).toHaveBeenCalled()
})
