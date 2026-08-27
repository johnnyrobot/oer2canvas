/**
 * Browser-facing type boundary for the lazily loaded Transformers.js bundle.
 *
 * The upstream declaration also exposes optional Node/Sharp types. Keeping the
 * small surface used by the PWA here prevents those optional types from
 * leaking Node globals into the browser compilation while Vite still bundles
 * the package's browser export at runtime.
 */
export const LogLevel: { readonly ERROR: number }
export const env: {
  allowLocalModels: boolean
  allowRemoteModels: boolean
  useBrowserCache: boolean
  useFSCache: boolean
  logLevel: number
}

export const Florence2ForConditionalGeneration: {
  from_pretrained(
    model: string,
    options: {
      revision: string
      device: 'webgpu'
      dtype: 'q4'
      progress_callback: (info: any) => void
    },
  ): Promise<unknown>
}

export const AutoProcessor: {
  from_pretrained(
    model: string,
    options: { revision: string; progress_callback: (info: any) => void },
  ): Promise<unknown>
}

export function load_image(image: string | Blob): Promise<{ size: [number, number] }>
