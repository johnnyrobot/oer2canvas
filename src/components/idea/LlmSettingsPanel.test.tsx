import { fireEvent, render, screen } from '@testing-library/react'
import { LlmSettingsPanel } from './LlmSettingsPanel'
import { PROVIDERS } from '../../engine/idea/llm/providers'

test('lists offered providers, prefills the default model, saves, and never renders the key as text', () => {
  const onSave = vi.fn()
  render(<LlmSettingsPanel settings={undefined} onSave={onSave} onForget={vi.fn()} />)
  const select = screen.getByRole('combobox', { name: 'Provider' })
  for (const p of PROVIDERS.filter((x) => x.offered)) expect(screen.getByRole('option', { name: p.label })).toBeInTheDocument()
  fireEvent.change(select, { target: { value: 'openrouter' } })
  expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue(PROVIDERS.find((p) => p.id === 'openrouter')!.defaultModel)
  const key = screen.getByLabelText('API key') as HTMLInputElement
  expect(key.type).toBe('password')
  fireEvent.change(key, { target: { value: 'sk-abc' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save on this device' }))
  expect(onSave).toHaveBeenCalledWith({ provider: 'openrouter', key: 'sk-abc', model: PROVIDERS.find((p) => p.id === 'openrouter')!.defaultModel })
  expect(document.body.textContent).not.toContain('sk-abc')
})

test('says where the key is stored and offers Forget key when one is saved', () => {
  const onForget = vi.fn()
  render(<LlmSettingsPanel settings={{ provider: 'gemini', key: 'k', model: 'gemini-2.5-flash' }} onSave={vi.fn()} onForget={onForget} />)
  expect(screen.getByText(/stored in this browser on this device/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Forget key' }))
  expect(onForget).toHaveBeenCalled()
})

test('a provider that is not offered is listed as unavailable with the evidence link, and cannot be chosen', () => {
  const notOffered = PROVIDERS.find((p) => !p.offered)
  if (!notOffered) return // every provider passed the probe; nothing to assert
  render(<LlmSettingsPanel settings={undefined} onSave={vi.fn()} onForget={vi.fn()} />)
  expect(screen.getByRole('option', { name: new RegExp(notOffered.label) })).toBeDisabled()
  expect(screen.getByText(new RegExp(`${notOffered.label} cannot be called from a browser directly`))).toBeInTheDocument()
})

test('a record that loads after mount fills the fields; forgetting empties them', () => {
  const { rerender } = render(<LlmSettingsPanel settings={undefined} onSave={vi.fn()} onForget={vi.fn()} />)
  expect(screen.getByLabelText('API key')).toHaveValue('')
  rerender(<LlmSettingsPanel settings={{ provider: 'openrouter', key: 'k1', model: 'm1' }} onSave={vi.fn()} onForget={vi.fn()} />)
  expect(screen.getByRole('combobox', { name: 'Provider' })).toHaveValue('openrouter')
  expect(screen.getByLabelText('API key')).toHaveValue('k1')
  expect(screen.getByRole('textbox', { name: 'Model' })).toHaveValue('m1')
  rerender(<LlmSettingsPanel settings={undefined} onSave={vi.fn()} onForget={vi.fn()} />)
  expect(screen.getByLabelText('API key')).toHaveValue('')
})

test('the panel says the prompts follow the Crosswalk and links it in a new tab', () => {
  render(<LlmSettingsPanel settings={undefined} onSave={vi.fn()} onForget={vi.fn()} />)
  const link = screen.getByRole('link', { name: /IDEA Framework Gen-AI Crosswalk Instructions/ })
  expect(link).toHaveAttribute('target', '_blank')
  expect(screen.getByText(/Prompts follow OERI's/)).toBeInTheDocument()
})
