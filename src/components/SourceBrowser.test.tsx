import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { SourceBrowser } from './SourceBrowser'

const libreBook = {
  source: 'libretexts', id: 'chem-1', slug: 'https://chem.libretexts.org/Bookshelves/Organic_Chemistry',
  title: 'Organic Chemistry', authors: ['Ada Author'], subject: 'Chemistry',
}
const pressBook = {
  source: 'pressbooks', id: 'https://milnepublishing.geneseo.edu/logic/',
  slug: 'https://milnepublishing.geneseo.edu/logic/', title: 'Concise Logic', authors: ['Craig DeLancey'],
}

beforeEach(() => {
  globalThis.fetch = vi.fn(async (input) => Response.json({
    books: String(input).includes('/pressbooks/') ? [pressBook] : [libreBook],
  })) as typeof globalThis.fetch
})

test('LibreTexts URL entry validates the host before starting a load', () => {
  const onPick = vi.fn()
  render(<SourceBrowser onPick={onPick} />)
  fireEvent.click(screen.getByRole('tab', { name: 'LibreTexts' }))
  fireEvent.change(screen.getByLabelText('LibreTexts book or chapter URL'), { target: { value: 'https://example.com/book' } })
  fireEvent.click(screen.getByRole('button', { name: 'Open LibreTexts book' }))
  expect(screen.getByRole('alert')).toHaveTextContent('libretexts.org')
  expect(onPick).not.toHaveBeenCalled()
})

test('LibreTexts URL entry rejects plaintext and lookalike hosts', () => {
  const onPick = vi.fn()
  render(<SourceBrowser onPick={onPick} />)
  fireEvent.click(screen.getByRole('tab', { name: 'LibreTexts' }))
  const input = screen.getByLabelText('LibreTexts book or chapter URL')
  for (const value of ['http://chem.libretexts.org/book', 'https://notlibretexts.org/book']) {
    fireEvent.change(input, { target: { value } })
    fireEvent.click(screen.getByRole('button', { name: 'Open LibreTexts book' }))
    expect(screen.getByRole('alert')).toHaveTextContent('HTTPS URL')
  }
  expect(onPick).not.toHaveBeenCalled()
})

test('LibreTexts URL entry creates a source book after validation', () => {
  const onPick = vi.fn()
  render(<SourceBrowser onPick={onPick} />)
  fireEvent.click(screen.getByRole('tab', { name: 'LibreTexts' }))
  fireEvent.change(screen.getByLabelText('LibreTexts book or chapter URL'), { target: { value: 'https://chem.libretexts.org/Bookshelves/Book_1' } })
  fireEvent.click(screen.getByRole('button', { name: 'Open LibreTexts book' }))
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ source: 'libretexts', title: 'Book 1' }))
})

test('browses, searches, and selects a LibreTexts catalog book', async () => {
  const onPick = vi.fn()
  render(<SourceBrowser onPick={onPick} />)
  fireEvent.click(screen.getByRole('tab', { name: 'LibreTexts' }))
  expect(await screen.findByRole('button', { name: /Organic Chemistry/ })).toBeVisible()
  fireEvent.change(screen.getByLabelText('Search books'), { target: { value: 'Ada' } })
  expect(screen.getByText('1 book')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: /Organic Chemistry/ }))
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ source: 'libretexts', id: 'chem-1' }))
})

test('browses and selects a Pressbooks network catalog book', async () => {
  const onPick = vi.fn()
  render(<SourceBrowser onPick={onPick} />)
  fireEvent.click(screen.getByRole('tab', { name: 'Pressbooks' }))
  expect(screen.getByLabelText('Network')).toBeVisible()
  fireEvent.click(await screen.findByRole('button', { name: /Concise Logic/ }))
  expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ source: 'pressbooks' }))
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith(
    expect.stringContaining('/catalogs/pressbooks/'), expect.anything(),
  ))
})

test('text and markup are a content choice without removing the publisher catalogs', () => {
  render(<SourceBrowser onPick={() => {}} onImportText={() => {}} />)

  fireEvent.click(screen.getByRole('tab', { name: 'Text / Markdown / HTML' }))
  expect(screen.getByLabelText('Content to import')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Create page plan' })).toBeVisible()

  fireEvent.click(screen.getByRole('tab', { name: 'OpenStax' }))
  expect(screen.getByRole('button', { name: 'Algebra and Trigonometry' })).toBeVisible()
})

test('tested structured formats are one document choice beside text-like content and publisher catalogs', () => {
  render(
    <SourceBrowser
      onPick={() => {}}
      onImportText={() => {}}
      onImportDocument={() => {}}
    />,
  )

  fireEvent.click(screen.getByRole('tab', { name: 'Document' }))
  const input = screen.getByLabelText('Document file')
  expect(input).toHaveAttribute('accept', expect.stringContaining('.docx'))
  expect(input).toHaveAttribute('accept', expect.stringContaining('.epub'))
  expect(input).toHaveAttribute('accept', expect.stringContaining('.odt'))
  expect(input).toHaveAttribute('accept', expect.stringContaining('.rtf'))
  expect(screen.getByRole('button', { name: 'Inspect document' })).toBeVisible()

  fireEvent.click(screen.getByRole('tab', { name: 'Text / Markdown / HTML' }))
  expect(screen.getByLabelText('Content to import')).toBeVisible()
  fireEvent.click(screen.getByRole('tab', { name: 'OpenStax' }))
  expect(screen.getByRole('button', { name: 'Algebra and Trigonometry' })).toBeVisible()
})
