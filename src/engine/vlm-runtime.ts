/**
 * Browser-only Transformers.js adapter for the local alt-text draft seam.
 *
 * This module intentionally imports Transformers.js lazily. The normal source
 * picker and compiler do not need a multi-hundred-megabyte ML chunk, and model
 * weights are not requested until an instructor presses "Draft locally".
 * Transformers.js then stores the model files in the browser Cache API, so a
 * later draft on the same origin reuses the local copy.
 */
import type { VlmModel, VlmPipeline, VlmProgress, VlmRuntime } from './vlm'

const FLORENCE_CAPTION_TASK = '<MORE_DETAILED_CAPTION>'

type ProgressInfo = {
  status?: string
  loaded?: number
  total?: number
}

type FlorenceProcessor = {
  construct_prompts: (text: string | string[]) => string[]
  (image: unknown, text?: unknown, options?: unknown): Promise<unknown>
  batch_decode: (tokens: unknown, options?: unknown) => string[]
  post_process_generation: (text: string, task: string, imageSize: [number, number]) => Record<string, unknown>
}

type FlorenceModel = {
  generate: (inputs: Record<string, unknown>) => Promise<unknown>
}

type LoadPipeline = (
  model: VlmModel,
  onProgress?: (progress: VlmProgress) => void,
) => Promise<VlmPipeline>

function relayImageUrl(image: string): string | undefined {
  if (typeof window === 'undefined' || !/^https?:\/\//i.test(image)) return undefined
  try {
    const target = new URL(image)
    if (target.origin === window.location.origin) return undefined
    return `/relay?url=${encodeURIComponent(target.toString())}`
  } catch {
    return undefined
  }
}

function reportProgress(
  onProgress: ((progress: VlmProgress) => void) | undefined,
  info: ProgressInfo,
): void {
  if (typeof info.loaded !== 'number' || typeof info.total !== 'number') return
  onProgress?.({ phase: 'loading', loaded: info.loaded, total: info.total })
}

/**
 * Build the selected Florence-2 pipeline. The manual model/processor path is
 * deliberate: Florence needs a task token (`<MORE_DETAILED_CAPTION>`) and the
 * generic `image-to-text` pipeline does not provide one.
 */
async function loadFlorencePipeline(
  model: VlmModel,
  onProgress?: (progress: VlmProgress) => void,
): Promise<VlmPipeline> {
  const transformers = await import('@huggingface/transformers')
  transformers.env.allowLocalModels = false
  transformers.env.allowRemoteModels = true
  transformers.env.useBrowserCache = true
  transformers.env.useFSCache = false
  transformers.env.logLevel = transformers.LogLevel.ERROR

  const progress_callback = (info: ProgressInfo) => reportProgress(onProgress, info)
  const [loadedModel, loadedProcessor] = await Promise.all([
    transformers.Florence2ForConditionalGeneration.from_pretrained(model.id, {
      revision: model.revision,
      device: 'webgpu',
      dtype: 'q4',
      progress_callback,
    }),
    transformers.AutoProcessor.from_pretrained(model.id, {
      revision: model.revision,
      progress_callback,
    }),
  ])
  const florenceModel = loadedModel as unknown as FlorenceModel
  const processor = loadedProcessor as unknown as FlorenceProcessor

  return async (image, options = {}) => {
    options.signal?.throwIfAborted()
    let rawImage
    try {
      rawImage = await transformers.load_image(image)
    } catch (firstError) {
      // Publisher pages often allow an image element to display cross-origin
      // while omitting CORS headers needed by fetch(). Retry through the same
      // allowlisted, byte-forwarding relay used by source ingestion. If the
      // relay also fails, preserve the original model error for the user.
      const relayUrl = typeof image === 'string' ? relayImageUrl(image) : undefined
      if (!relayUrl) throw firstError
      try {
        rawImage = await transformers.load_image(relayUrl)
      } catch {
        throw firstError
      }
    }
    options.signal?.throwIfAborted()
    const prompts = processor.construct_prompts(FLORENCE_CAPTION_TASK)
    const inputs = await processor(rawImage, prompts)
    options.signal?.throwIfAborted()
    const generated = await florenceModel.generate({
      ...(inputs as Record<string, unknown>),
      max_new_tokens: options.max_new_tokens ?? 120,
    })
    options.signal?.throwIfAborted()
    const decoded = processor.batch_decode(generated, { skip_special_tokens: false })[0] ?? ''
    const result = processor.post_process_generation(decoded, FLORENCE_CAPTION_TASK, rawImage.size)
    return result[FLORENCE_CAPTION_TASK] ?? decoded
  }
}

const defaultLoader: LoadPipeline = loadFlorencePipeline

/**
 * Create the production browser runtime. Pipelines are shared by model ID so
 * accepting one draft and asking for another does not reload the weights.
 */
export function createBrowserVlmRuntime(loadPipeline: LoadPipeline = defaultLoader): VlmRuntime {
  const pipelines = new Map<string, Promise<VlmPipeline>>()
  return {
    async load(model, onProgress, signal) {
      signal?.throwIfAborted()
      if (model.id !== 'onnx-community/Florence-2-base-ft') {
        throw new Error(`${model.label} is not enabled for local drafting yet.`)
      }

      let pending = pipelines.get(model.id)
      if (!pending) {
        pending = loadPipeline(model, onProgress)
        pipelines.set(model.id, pending)
        void pending.catch(() => {
          // Do not permanently poison the cache after a transient network or
          // GPU allocation failure. The next click should be able to retry.
          if (pipelines.get(model.id) === pending) pipelines.delete(model.id)
        })
      }

      return pending.then((pipeline) => {
        signal?.throwIfAborted()
        return pipeline
      })
    },
  }
}
