import { draftAltText, SELECTED_VLM_MODEL, VLM_MODELS, type VlmRuntime } from './vlm'

test('model manifest pins one browser-ready model and keeps alternatives evidence-visible', () => {
  expect(VLM_MODELS).toHaveLength(4)
  expect(VLM_MODELS.filter((model) => model.status === 'selected')).toEqual([SELECTED_VLM_MODEL])
  expect(VLM_MODELS.filter((model) => model.status === 'benchmark-pending')).toHaveLength(2)
  expect(VLM_MODELS.find((model) => model.id === 'vikhyatk/moondream2')?.status).toBe('incompatible')
  expect(VLM_MODELS.every((model) => model.revision.length === 40 && model.downloadMiB > 0)).toBe(true)
})

test('draftAltText loads locally, reports progress, and returns text', async () => {
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
  const seen: string[] = []
  const runtime: VlmRuntime = {
    async load(_model, progress) {
      progress?.({ phase: 'loading', loaded: 10, total: 20 })
      return async () => [{ generated_text: 'A triangle above a square.' }]
    },
  }
  const text = await draftAltText(runtime, VLM_MODELS[0]!, 'blob-or-url', (progress) => seen.push(progress.phase))
  expect(text).toBe('A triangle above a square.')
  expect(seen).toEqual(['loading', 'drafting'])
})

test('draftAltText rejects empty model output', async () => {
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
  const runtime: VlmRuntime = { async load() { return async () => [{ generated_text: '' }] } }
  await expect(draftAltText(runtime, VLM_MODELS[0]!, 'image')).rejects.toThrow(/no description/i)
})

test('draftAltText fits a model response to Canvas before returning it', async () => {
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
  const runtime: VlmRuntime = {
    async load() {
      return async () => [{ generated_text: 'A very long figure description '.repeat(10) }]
    },
  }
  const text = await draftAltText(runtime, SELECTED_VLM_MODEL, 'image')
  expect(text.length).toBeLessThanOrEqual(120)
})

test('draftAltText stops before loading when already cancelled', async () => {
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
  const load = vi.fn()
  const controller = new AbortController()
  controller.abort()
  await expect(
    draftAltText({ load }, VLM_MODELS[0]!, 'image', undefined, controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
  expect(load).not.toHaveBeenCalled()
})

test('draftAltText passes cancellation into model loading and generation', async () => {
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
  const controller = new AbortController()
  const pipeline = vi.fn(async () => [{ generated_text: 'A labeled triangle.' }])
  const load = vi.fn(async () => pipeline)
  await draftAltText({ load }, VLM_MODELS[0]!, 'image', undefined, controller.signal)
  expect(load).toHaveBeenCalledWith(VLM_MODELS[0], undefined, controller.signal)
  expect(pipeline).toHaveBeenCalledWith('image', expect.objectContaining({ signal: controller.signal }))
})

test('draftAltText surfaces a model load failure without changing its meaning', async () => {
  Object.defineProperty(navigator, 'gpu', { configurable: true, value: {} })
  const runtime: VlmRuntime = { async load() { throw new Error('model cache is corrupt') } }
  await expect(draftAltText(runtime, VLM_MODELS[0]!, 'image')).rejects.toThrow('model cache is corrupt')
})
