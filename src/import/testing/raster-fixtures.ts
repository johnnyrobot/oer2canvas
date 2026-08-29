/**
 * The exact 16x16 rasters issue 07 imported into a live Canvas and measured
 * rendering for. Generated from `scripts/canvas-image-probes.mjs`; the adjacent
 * test pins them to that generator so a fixture can never drift from the bytes
 * Canvas actually accepted.
 *
 * 16x16 rather than 1x1: a one-pixel image is indistinguishable from a broken
 * one, and degenerate for the dimension decoder.
 */
const SOURCE = {
  png: { base64: 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQ4jWNo9Nz3nxLMMGrA/9Ew2DcaBp7DIgwAkX+HH2ldhTQAAAAASUVORK5CYII=', mediaType: 'image/png' },
  jpeg: { base64: '/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABADAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAcI/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AiJozUAAA/9k=', mediaType: 'image/jpeg' },
  gif: { base64: 'R0lGODlhEAAQAIAAAExpcfWmIyH5BAUAAAAALAAAAAAQABAAAAIOjI+py+0Po5y02ouzPgUAOw==', mediaType: 'image/gif' },
  webp: { base64: 'UklGRh4AAABXRUJQVlA4TBEAAAAvD8ADAAfQscpUuv+BiOh/AAA=', mediaType: 'image/webp' },
} as const

const decode = (base64: string): Uint8Array =>
  Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))

export const RASTER_FIXTURES = Object.fromEntries(
  Object.entries(SOURCE).map(([key, { base64, mediaType }]) => [
    key,
    { bytes: decode(base64), mediaType, width: 16, height: 16 },
  ]),
) as Record<'png' | 'jpeg' | 'gif' | 'webp', {
  bytes: Uint8Array
  mediaType: string
  width: 16
  height: 16
}>

/**
 * A PNG header declaring `width` x `height`, with no image data behind it.
 * `sniffRaster` reads dimensions from the IHDR alone, which is exactly the
 * property an attacker exploits: a 24-byte file can claim an enormous bitmap.
 *
 * Lives here rather than in one test file because two suites need the same
 * bytes — `assets.test.ts` pins the refusal itself, and `anydoc-html.test.ts`
 * pins that the refusal reaches the user as a counted finding plus a visible
 * placeholder. A second copy would let those two drift apart.
 */
export function pngHeaderDeclaring(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const be = (value: number, at: number) => {
    bytes[at] = (value >>> 24) & 0xff
    bytes[at + 1] = (value >>> 16) & 0xff
    bytes[at + 2] = (value >>> 8) & 0xff
    bytes[at + 3] = value & 0xff
  }
  be(width, 16)
  be(height, 20)
  return bytes
}
