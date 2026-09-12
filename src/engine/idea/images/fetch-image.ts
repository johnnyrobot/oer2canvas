import type { ImageHit } from './search'

/**
 * The bytes of the chosen image, fetched by the browser. A host that refuses
 * a cross-origin read makes the fetch opaque; that is a property of the host,
 * so the message names it and points at the way that always works.
 */
export async function fetchImageBytes(hit: ImageHit, fetch: typeof globalThis.fetch, signal?: AbortSignal): Promise<Uint8Array> {
  const host = new URL(hit.fullUrl).host
  let response: Response
  try {
    response = await fetch(hit.fullUrl, { signal: signal ?? null })
  } catch {
    throw new Error(`${host} does not let this browser fetch it directly. Open the source page, save the image, and add it through Document import instead.`)
  }
  if (!response.ok) throw new Error(`${host} answered HTTP ${response.status} for this image.`)
  return new Uint8Array(await response.arrayBuffer())
}
