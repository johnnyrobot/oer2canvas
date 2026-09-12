import { fireEvent, render, screen } from '@testing-library/react'
import { AskModel } from './AskModel'
import { providerById } from '../../engine/idea/llm/providers'

test('without a provider it explains and offers no button', () => {
  render(<AskModel provider={undefined} state={{ status: 'idle' }} onSend={vi.fn()} onCancel={vi.fn()} firstRun />)
  expect(screen.getByText(/No provider set/)).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('with a provider the button names it, the disclosure is above it, and nothing is sent until clicked', () => {
  const onSend = vi.fn()
  const { container } = render(<AskModel provider={providerById('gemini')} state={{ status: 'idle' }} onSend={onSend} onCancel={vi.fn()} firstRun />)
  const button = screen.getByRole('button', { name: 'Send this section to Gemini' })
  const disclosure = screen.getByText(/What leaves your browser/)
  expect(disclosure.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(container.textContent).toContain('Google’s Gemini API terms govern')
  expect(onSend).not.toHaveBeenCalled()
  fireEvent.click(button)
  expect(onSend).toHaveBeenCalledTimes(1)
})

test('running shows a cancel; failed shows the mapped message', () => {
  const onCancel = vi.fn()
  const { rerender } = render(<AskModel provider={providerById('gemini')} state={{ status: 'running', controller: new AbortController() }} onSend={vi.fn()} onCancel={onCancel} firstRun={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(onCancel).toHaveBeenCalled()
  rerender(<AskModel provider={providerById('gemini')} state={{ status: 'failed', failure: 'bad-key', message: 'x' }} onSend={vi.fn()} onCancel={vi.fn()} firstRun={false} />)
  expect(screen.getByText(/rejected this key/)).toBeInTheDocument()
})
