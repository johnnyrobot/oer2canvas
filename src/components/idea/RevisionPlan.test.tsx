import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { RevisionPlan } from './RevisionPlan'
import { providerById } from '../../engine/idea/llm/providers'

const base = {
  provider: providerById('gemini'), state: { status: 'idle' as const }, stored: undefined, firstRun: true, canPlan: true,
  onSend: vi.fn(), onCancel: vi.fn(), onExport: vi.fn(() => 'idea-revision-plan-x.md'), onAnnounce: vi.fn(),
}

test('with nothing to plan the button is disabled and the sentence says why', () => {
  render(<RevisionPlan {...base} canPlan={false} />)
  expect(screen.getByRole('button', { name: 'Draft a revision plan with Gemini' })).toBeDisabled()
  expect(screen.getByText(/the plan is built from your review/)).toBeInTheDocument()
})

test('Send calls once; the disclosure says no text is sent', () => {
  const onSend = vi.fn()
  render(<RevisionPlan {...base} onSend={onSend} />)
  expect(screen.getByText(/Not the chapter’s text/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Draft a revision plan with Gemini' }))
  expect(onSend).toHaveBeenCalledTimes(1)
})

test('a result renders the plan sorted by priority, student drafts with Copy only, and Copy announces', async () => {
  const stored = { draft: {
    plan: [{ priority: 2 as const, where: 'b', issue: 'i2', revision: 'r', rationale: 'y', licence: 'in-page' }, { priority: 1 as const, where: 'a', issue: 'i1', revision: 'r', rationale: 'y', licence: 'supplement' }],
    studentText: [{ where: '4.1', purpose: 'framing', text: 'Before reading…' }],
  }, provider: 'Gemini', at: 1 }
  const writeText = vi.fn(async () => {})
  const onAnnounce = vi.fn()
  render(<RevisionPlan {...base} state={{ status: 'done', findings: [], at: 1 }} stored={stored} writeText={writeText} onAnnounce={onAnnounce} />)
  const rows = within(screen.getByRole('table', { name: 'Revision plan' })).getAllByRole('row')
  expect(rows[1]).toHaveTextContent('i1')
  expect(rows[2]).toHaveTextContent('i2')
  expect(screen.getByText('Before reading…')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Place|Replace/ })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  expect(writeText).toHaveBeenCalledWith('Before reading…')
  await waitFor(() => expect(onAnnounce).toHaveBeenCalledWith('Copied.'))
  expect(screen.getByText(/paste it through Edit…/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Download plan (JSON)' }))
  expect(base.onExport).toHaveBeenCalledWith('json')
})

test('a rejected clipboard write announces that the copy failed', async () => {
  const stored = { draft: { plan: [], studentText: [{ where: '4.1', purpose: 'framing', text: 'Before reading…' }] }, provider: 'Gemini', at: 1 }
  const writeText = vi.fn(async () => { throw new Error('denied') })
  const onAnnounce = vi.fn()
  render(<RevisionPlan {...base} state={{ status: 'done', findings: [], at: 1 }} stored={stored} writeText={writeText} onAnnounce={onAnnounce} />)
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  await waitFor(() => expect(onAnnounce).toHaveBeenCalledWith('Could not copy. Select the text and copy it by hand.'))
})
