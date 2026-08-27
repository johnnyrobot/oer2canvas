import { describe, expect, it, vi } from 'vitest'
import { SELECTED_VLM_MODEL, VLM_MODELS, type VlmPipeline } from './vlm'
import { createBrowserVlmRuntime } from './vlm-runtime'

describe('browser VLM runtime', () => {
  it('loads the selected model once and shares its cached pipeline', async () => {
    const pipeline: VlmPipeline = async () => [{ generated_text: 'A graph.' }]
    const load = vi.fn(async (_model, onProgress) => {
      onProgress?.({ phase: 'loading', loaded: 1, total: 2 })
      return pipeline
    })
    const runtime = createBrowserVlmRuntime(load)
    const progress: number[] = []

    const first = await runtime.load(SELECTED_VLM_MODEL, (event) => progress.push(event.loaded ?? 0))
    const second = await runtime.load(SELECTED_VLM_MODEL)

    expect(first).toBe(second)
    expect(load).toHaveBeenCalledOnce()
    expect(progress).toEqual([1])
  })

  it('does not expose an unimplemented candidate as a production runtime', async () => {
    const runtime = createBrowserVlmRuntime(vi.fn())
    await expect(runtime.load(VLM_MODELS[1]!)).rejects.toThrow(/not enabled/i)
  })

  it('lets a cancelled request stop after a shared load completes', async () => {
    const runtime = createBrowserVlmRuntime(async () => async () => 'A graph.')
    const controller = new AbortController()
    controller.abort()
    await expect(runtime.load(SELECTED_VLM_MODEL, undefined, controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    })
  })
})

