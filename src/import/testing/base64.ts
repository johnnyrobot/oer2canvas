/**
 * `commands.writeFile` (Vitest's browser-mode bridge back to the real Node
 * `fs` running the test server — see `@vitest/browser/dist/index.js`) only
 * accepts a string body, never bytes. Base64, chunked rather than spread in
 * one `String.fromCharCode(...bytes)` call: a cartridge with any real content
 * is well past the argument-count ceiling that blows the call stack on a
 * naive spread.
 *
 * Extracted out of `packaged-cartridge.browser.test.ts`, which wrote this
 * first, so `cartridge-artifact.browser.test.ts` reuses the exact chunking
 * rather than a second copy that could quietly diverge (e.g. a different
 * `CHUNK` size that turns out to hit the same stack ceiling this one avoids).
 */
export function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK))
  }
  return btoa(binary)
}
