/**
 * Hand a text file to the browser as a download.
 *
 * The same anchor-and-revoke pattern as `engine/export/download.ts`, kept
 * separate because that module is typed to cartridges and this one is not.
 * Revoked on a timeout rather than immediately, because revoking before the
 * browser has started the download cancels it in some engines.
 */
export function downloadTextFile(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
