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
