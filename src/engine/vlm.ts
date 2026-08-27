/**
 * Local vision-language drafting seam.
 *
 * The runtime remains injected so the queue can be tested without downloading
 * model weights. Production supplies the browser adapter in `vlm-runtime.ts`;
 * the model itself is fetched and cached by the user's browser on first use.
 */
import { fitCanvasAltText } from './alt-text'

export interface VlmModel {
  id: string
  label: string
  /** Immutable model revision used by the benchmark and eventual runtime. */
  revision: string
  license: string
  downloadMiB: number
  /** Evidence state, not a quality claim. */
  status: 'benchmark-pending' | 'incompatible' | 'selected'
}

export const VLM_MODELS: readonly VlmModel[] = [
  {
    id: 'onnx-community/Florence-2-base-ft',
    label: 'Florence-2 base',
    revision: 'e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f',
    license: 'MIT',
    downloadMiB: 318,
    status: 'selected',
  },
  {
    id: 'onnx-community/Florence-2-large-ft',
    label: 'Florence-2 large',
    revision: '04ace74913c28d7ec94af32cee5c111a10126b6f',
    license: 'MIT',
    downloadMiB: 754,
    status: 'benchmark-pending',
  },
  {
    id: 'HuggingFaceTB/SmolVLM-256M-Instruct',
    label: 'SmolVLM 256M',
    revision: '7e3e67edbbed1bf9888184d9df282b700a323964',
    license: 'Apache-2.0',
    downloadMiB: 252,
    status: 'benchmark-pending',
  },
  {
    id: 'vikhyatk/moondream2',
    label: 'Moondream 2',
    revision: '6b714b26eea5cbd9f31e4edb2541c170afa935ba',
    license: 'Apache-2.0',
    downloadMiB: 3680,
    status: 'incompatible',
  },
]

/** The first browser-ready model shipped in the local drafting flow. */
export const SELECTED_VLM_MODEL = VLM_MODELS.find((model) => model.status === 'selected')!

export interface VlmProgress {
  phase: 'loading' | 'drafting'
  loaded?: number
  total?: number
}

export interface VlmPipeline {
  (
    image: string | Blob,
    options?: { prompt?: string; max_new_tokens?: number; signal?: AbortSignal },
  ): Promise<unknown>
}

export interface VlmRuntime {
  load(
    model: VlmModel,
    onProgress?: (progress: VlmProgress) => void,
    signal?: AbortSignal,
  ): Promise<VlmPipeline>
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output.trim()
  if (Array.isArray(output)) {
    const first = output[0]
    if (typeof first === 'string') return first.trim()
    if (first && typeof first === 'object') {
      const value = (first as { generated_text?: unknown; text?: unknown }).generated_text ?? (first as { text?: unknown }).text
      if (typeof value === 'string') return value.trim()
    }
  }
  if (output && typeof output === 'object') {
    const value = (output as { generated_text?: unknown; text?: unknown }).generated_text ?? (output as { text?: unknown }).text
    if (typeof value === 'string') return value.trim()
  }
  return ''
}

/**
 * Draft an alt description locally. The caller must still present the result
 * as an unaccepted proposal and run the normal answer validation/re-audit.
 */
export async function draftAltText(
  runtime: VlmRuntime,
  model: VlmModel,
  image: string | Blob,
  onProgress?: (progress: VlmProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted()
  if (typeof navigator !== 'undefined' && !('gpu' in navigator)) {
    throw new Error('This browser does not expose WebGPU; choose a written description instead.')
  }
  const pipeline = await runtime.load(model, onProgress, signal)
  signal?.throwIfAborted()
  onProgress?.({ phase: 'drafting' })
  const text = outputText(await pipeline(image, {
    prompt: 'Describe this educational figure for a screen-reader user.',
    max_new_tokens: 120,
    ...(signal ? { signal } : {}),
  }))
  signal?.throwIfAborted()
  if (!text) throw new Error('The local model returned no description; write one instead.')
  // Generation is deliberately capped twice: `max_new_tokens` bounds model
  // work, while this character-level fit guarantees the value can be accepted
  // by Canvas even when a model ignores the requested token budget.
  return fitCanvasAltText(text)
}
