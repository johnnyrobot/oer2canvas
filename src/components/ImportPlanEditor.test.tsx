import { useState } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ImportPlanEditor, createImportDraft, type ImportDraft } from './ImportPlanEditor'
import type { ImportFinding, ImportResult } from '../import/types'

const STRUCTURED =
  '<h1>Cell biology</h1>' +
  '<h2>Membranes</h2><p>Lipid bilayer.</p><h3>Transport</h3><p>Osmosis.</p>' +
  '<h2>Nucleus</h2><p>Stores DNA.</p>' +
  '<h2>Mitochondria</h2><p>Energy.</p>'

function imported(html = STRUCTURED, findings: ImportFinding[] = []): ImportResult {
  return {
    work: {
      id: 'document-abc123',
      title: 'Cell biology',
      format: 'markdown',
      sections: [{ id: 'document-abc123-page-1', title: 'Cell biology', order: 0, html }],
      assets: [],
      provenance: {
        kind: 'paste',
        author: 'Ada Instructor',
        rights: { authority: 'own', acknowledged: true },
      },
    },
    report: {
      parser: 'native',
      format: 'markdown',
      originalBytes: 120,
      findings,
      counts: { sections: 1, headings: 4, tables: 0, images: 0, equations: 0, notes: 0, unavailableAssets: 0, packagedAssetBytes: 0 },
    },
  }
}

/** A controlled harness: the editor never owns the draft, exactly as `App` uses it. */
function Harness({ initial, onConfirm, onDiscard }: {
  initial: ImportDraft
  onConfirm?: (result: ImportResult) => void
  onDiscard?: () => void
}) {
  const [draft, setDraft] = useState(initial)
  return (
    <ImportPlanEditor
      draft={draft}
      onChange={setDraft}
      onConfirm={onConfirm ?? (() => {})}
      onDiscard={onDiscard ?? (() => {})}
    />
  )
}

function pageItems() {
  return within(screen.getByRole('list', { name: 'Proposed Canvas pages' })).getAllByRole('listitem')
}

function titles() {
  return pageItems().map((item) => (within(item).getByLabelText(/^Title of page/) as HTMLInputElement).value)
}

test('the proposal lists every page, its structure, and the parse findings before confirming', () => {
  const onConfirm = vi.fn()
  render(<Harness initial={createImportDraft(imported(STRUCTURED, [
    { code: 'import-active-content-removed', severity: 'warning', message: 'Removed active content.' },
  ]))} onConfirm={onConfirm} />)

  expect(screen.getByRole('heading', { name: 'Page plan: Cell biology' })).toBeVisible()
  expect(screen.getByText(/3 proposed pages · 3 included/)).toBeVisible()
  expect(screen.getByText(/split at heading level 2/i)).toBeVisible()
  expect(titles()).toEqual(['Membranes', 'Nucleus', 'Mitochondria'])
  expect(screen.getByText('Removed active content.')).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Prepare 3 pages' }))
  expect(onConfirm).toHaveBeenCalledTimes(1)
  const result = onConfirm.mock.calls[0]![0] as ImportResult
  expect(result.work.sections.map((section) => section.title)).toEqual(['Membranes', 'Nucleus', 'Mitochondria'])
  expect(result.work.sections[0]!.html).toContain('<h1>Cell biology</h1><h2>Membranes</h2>')
})

test('renaming, excluding, and editing document details flow into the confirmed result', () => {
  const onConfirm = vi.fn()
  render(<Harness initial={createImportDraft(imported())} onConfirm={onConfirm} />)

  fireEvent.change(screen.getByLabelText('Title of page 2'), { target: { value: 'The nucleus' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Include: Membranes' }))
  expect(screen.getByRole('status')).toHaveTextContent('Membranes is excluded from export.')
  expect(screen.getByText(/3 proposed pages · 2 included/)).toBeVisible()

  fireEvent.change(screen.getByLabelText('Document title'), { target: { value: 'Cells, week 1' } })
  fireEvent.change(screen.getByLabelText('Publisher or source'), { target: { value: 'Biology Department' } })
  fireEvent.click(screen.getByRole('radio', { name: 'I have permission to republish or adapt it' }))
  expect(screen.getByRole('heading', { name: 'Page plan: Cells, week 1' })).toBeVisible()

  fireEvent.click(screen.getByRole('button', { name: 'Prepare 2 pages' }))
  const result = onConfirm.mock.calls[0]![0] as ImportResult
  expect(result.work.title).toBe('Cells, week 1')
  expect(result.work.provenance).toMatchObject({
    author: 'Ada Instructor',
    sourceName: 'Biology Department',
    rights: { authority: 'permission', acknowledged: true },
  })
  expect(result.work.sections.map((section) => section.title)).toEqual(['The nucleus', 'Mitochondria'])
})

test('an empty plan and duplicate titles are named and block preparation', () => {
  const onConfirm = vi.fn()
  render(<Harness initial={createImportDraft(imported())} onConfirm={onConfirm} />)

  fireEvent.change(screen.getByLabelText('Title of page 3'), { target: { value: 'nucleus' } })
  expect(screen.getByText(/Two or more included pages are titled "Nucleus"/)).toBeVisible()
  expect(screen.getByRole('button', { name: 'Prepare 3 pages' })).toBeDisabled()

  fireEvent.change(screen.getByLabelText('Title of page 3'), { target: { value: '' } })
  expect(screen.getByText('Every included page needs a title.')).toBeVisible()

  for (const name of ['Include: Membranes', 'Include: Nucleus', 'Include: page 3']) {
    fireEvent.click(screen.getByRole('checkbox', { name }))
  }
  expect(screen.getByText('Include at least one page before preparing this document.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Prepare 0 pages' })).toBeDisabled()
  expect(onConfirm).not.toHaveBeenCalled()
})

test('splitting is chosen from named points, focuses the new page, and is announced', async () => {
  render(<Harness initial={createImportDraft(imported())} />)

  fireEvent.click(screen.getByRole('button', { name: 'Split: Membranes' }))
  const picker = screen.getByLabelText('Start a new page at')
  expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual([
    'Heading: Membranes',
    'Paragraph: Lipid bilayer.',
    'Heading: Transport',
    'Paragraph: Osmosis.',
  ])
  fireEvent.change(picker, { target: { value: '3' } })
  fireEvent.click(screen.getByRole('button', { name: 'Split page' }))

  expect(titles()).toEqual(['Membranes', 'Transport', 'Nucleus', 'Mitochondria'])
  expect(screen.getByRole('status')).toHaveTextContent('Split Membranes. New page Transport added after it.')
  await waitFor(() => expect(screen.getByLabelText('Title of page 2')).toHaveFocus())
})

test('a one-block page cannot be split and says so', () => {
  render(<Harness initial={createImportDraft(imported('<p>Only one block.</p>'))} />)
  const button = screen.getByRole('button', { name: 'Split: Cell biology' })
  expect(button).toHaveAttribute('aria-disabled', 'true')
  fireEvent.click(button)
  expect(screen.getByRole('status')).toHaveTextContent('Cell biology has one block and cannot be split.')
  expect(screen.queryByLabelText('Start a new page at')).not.toBeInTheDocument()
})

test('merging joins the next page and moving reorders by keyboard-operable buttons', () => {
  render(<Harness initial={createImportDraft(imported())} />)

  fireEvent.click(screen.getByRole('button', { name: 'Merge with next page: Nucleus' }))
  expect(titles()).toEqual(['Membranes', 'Nucleus'])
  expect(screen.getByRole('status')).toHaveTextContent('Merged Mitochondria into Nucleus.')
  expect(screen.queryByRole('button', { name: 'Merge with next page: Nucleus' })).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole('button', { name: 'Move up: Nucleus' }))
  expect(titles()).toEqual(['Nucleus', 'Membranes'])
  expect(screen.getByRole('status')).toHaveTextContent('Moved Nucleus to position 1 of 2.')
  expect(screen.getByRole('button', { name: 'Move up: Nucleus' })).toHaveFocus()

  fireEvent.click(screen.getByRole('button', { name: 'Move up: Nucleus' }))
  expect(titles()).toEqual(['Nucleus', 'Membranes'])
  expect(screen.getByRole('status')).toHaveTextContent('Nucleus is already first.')
})

test('page previews render the sanitized page html without executing it', async () => {
  const { container } = render(<Harness initial={createImportDraft(imported(
    '<h2>One</h2><p>Safe prose</p><h2>Two</h2><p>&lt;script&gt;x&lt;/script&gt;</p>',
  ))} />)

  expect(screen.queryByText('Safe prose')).not.toBeInTheDocument()
  fireEvent.click(screen.getByText('Preview One'))
  expect(await screen.findByText('Safe prose')).toBeVisible()
  expect(container.querySelector('script')).toBeNull()
})

test('a blocking parse finding disables preparation and stays visible', () => {
  render(<Harness initial={createImportDraft(imported(STRUCTURED, [
    { code: 'embedded-content', severity: 'blocker', message: 'This document contains images.' },
  ]))} />)
  expect(screen.getByText('This document contains images.')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Prepare 3 pages' })).toBeDisabled()
})

test('invalid document details are reported at confirm time with focus and nothing is prepared', async () => {
  const onConfirm = vi.fn()
  render(<Harness initial={createImportDraft(imported())} onConfirm={onConfirm} />)
  fireEvent.change(screen.getByLabelText('Public source URL'), { target: { value: 'http://localhost/x' } })
  fireEvent.click(screen.getByRole('button', { name: 'Prepare 3 pages' }))

  const alert = await screen.findByRole('alert')
  expect(alert).toHaveTextContent('Enter a valid HTTPS public source URL.')
  await waitFor(() => expect(alert).toHaveFocus())
  expect(onConfirm).not.toHaveBeenCalled()
})

test('choosing different content discards the draft', () => {
  const onDiscard = vi.fn()
  render(<Harness initial={createImportDraft(imported())} onDiscard={onDiscard} />)
  fireEvent.click(screen.getByRole('button', { name: 'Choose different content' }))
  expect(onDiscard).toHaveBeenCalledTimes(1)
})
