import { importDocx } from './docx'
import { DOCUMENT_IMPORT_LIMITS } from './limits'

const metadata = {
  title: 'Budget check',
  rightsAuthority: 'own' as const,
  rightsAcknowledged: true,
}

test('an oversized DOCX is refused before allocating its source buffer or starting a Worker', async () => {
  const file = new File(['not read'], 'oversized.docx')
  Object.defineProperty(file, 'size', {
    configurable: true,
    value: DOCUMENT_IMPORT_LIMITS.maximumInputBytes + 1,
  })
  const read = vi.spyOn(file, 'arrayBuffer')

  await expect(importDocx(file, { metadata })).rejects.toThrow(/exceeds the 16 MiB browser limit/i)
  expect(read).not.toHaveBeenCalled()
})

test('file selection stays narrow even when an unsupported file claims the DOCX MIME type', async () => {
  const file = new File(['plain'], 'notes.txt', {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })
  const read = vi.spyOn(file, 'arrayBuffer')

  await expect(importDocx(file, { metadata })).rejects.toThrow(/\.docx extension/i)
  expect(read).not.toHaveBeenCalled()
})
