import type { CompiledChapter } from '../../contracts/index'
import { buildCartridge, cartridgeFilename } from './cartridge'
import { writeZip } from './zip'

/**
 * Build the cartridge and hand it to the browser as a download.
 *
 * The object URL is revoked, and that is not tidiness: a chapter cartridge is
 * not small, and a long session of re-exports would hold every one of them in
 * memory for as long as the tab lives. Revoked on a timeout rather than
 * immediately, because revoking before the browser has started the download
 * cancels it in some engines.
 */
export async function downloadCartridge(
  chapters: readonly CompiledChapter[],
  now: Date,
): Promise<string> {
  const bytes = await writeZip(buildCartridge(chapters))
  const name = cartridgeFilename(chapters, now)
  // `application/zip` rather than an imscc-specific type: the extension is what
  // Canvas's importer keys on, and a type no browser knows invites a rename.
  const blob = new Blob([bytes as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
  return name
}
