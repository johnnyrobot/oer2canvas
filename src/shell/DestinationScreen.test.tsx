import { render, screen, fireEvent } from '@testing-library/react'
import { DestinationScreen } from './screens'

const canvas = {
  status: 'idle' as const,
  onConnect: vi.fn(),
  onCancel: vi.fn(),
  onPickCourse: vi.fn(),
  onForget: vi.fn(),
}

function setup(over: Partial<Parameters<typeof DestinationScreen>[0]> = {}) {
  const onChoose = vi.fn()
  render(<DestinationScreen onChoose={onChoose} canvas={canvas} {...over} />)
  return { onChoose }
}

test('the default public destination exposes only the cartridge path', () => {
  const onChoose = vi.fn()
  render(<DestinationScreen onChoose={onChoose} />)

  expect(screen.queryByRole('button', { name: /A Canvas course/ })).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Canvas address')).not.toBeInTheDocument()
  expect(screen.queryByLabelText('Access token')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/ }))
  expect(onChoose).toHaveBeenCalledWith({ kind: 'cartridge' })
})

// §2.5: "Nothing to set up." The credential-free path stays one click.
test('the cartridge is still chosen in a single click, with nothing to configure', () => {
  const { onChoose } = setup()
  fireEvent.click(screen.getByRole('button', { name: /A cartridge file/ }))
  expect(onChoose).toHaveBeenCalledWith({ kind: 'cartridge' })
  expect(screen.queryByLabelText('Canvas address')).not.toBeInTheDocument()
})
