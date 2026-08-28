/**
 * Map packaged cartridge references to blob URLs for display only.
 *
 * The stored HTML is never mutated: what the gate approved is what the cartridge
 * gets, and a preview that rewrote those bytes would make the audit a claim
 * about markup nobody publishes (see `enforceGate` in `../engine/gate.ts`, and
 * the export path that ships `GateResult.html` verbatim). Only the string
 * handed to the DOM for rendering is resolved, via the closure this hook
 * returns — callers apply it at the `dangerouslySetInnerHTML` boundary, never
 * to anything that flows back into chapter or section state.
 *
 * KEYING: the map is keyed on `packagedReference(asset.name)`, NOT on a
 * reference rebuilt from `asset.originPart` via `packagedAssetName`. Assets
 * dedupe by content hash in `prepareAssets` (`../import/assets.ts`), and the
 * first-seen occurrence's origin wins the shared `name` — every later
 * occurrence of that same content keeps its OWN `originPart` pointing at
 * wherever IT was embedded, which is not the name the archive entry (or the
 * `$IMS-CC-FILEBASE$` reference in the html) actually uses. Recomputing from a
 * non-winning occurrence's `originPart` would mint a reference string that
 * never matches what is actually in the page, and the image would silently
 * stay broken with no indication why. `asset.name` is already the winning
 * name, assigned once at import time, so keying on it is the only way this
 * map can agree with the html it is meant to resolve.
 */
import { useEffect, useMemo } from 'react'
import type { ImportedAsset } from '../import/types'
import { packagedReference } from '../import/assets'

/** Matches this app's own packaged reference form; see `isPackagedReference` in `../import/assets.ts`. */
const PACKAGED_REFERENCE_PATTERN = /\$IMS-CC-FILEBASE\$\/oer2canvas\/[^"'\s>]+/g

export function usePackagedAssetUrls(assets: readonly ImportedAsset[] = []): (html: string) => string {
  // Recomputed only when the `assets` array reference itself changes (a new
  // chapter, or the same chapter with a new asset list) — not on every render
  // of the surface that calls the returned resolver, since every one of those
  // renders would otherwise mint a fresh set of object URLs for bytes already
  // sitting in memory under a URL nothing has revoked yet.
  const urls = useMemo(() => {
    const map = new Map<string, string>()
    for (const asset of assets) {
      // `asset.bytes` is typed `Uint8Array<ArrayBufferLike>` (it may be a view
      // over a `SharedArrayBuffer`), which `BlobPart` does not accept; the cast
      // matches the one already made for the same reason in
      // `../engine/export/download.ts`. Blob construction itself copies the
      // bytes rather than aliasing them, so this is not a lifetime hazard.
      const blob = new Blob([asset.bytes as BlobPart], { type: asset.mediaType })
      map.set(packagedReference(asset.name), URL.createObjectURL(blob))
    }
    return map
  }, [assets])

  // React commits the render that already points `<img>` tags at THIS map's
  // urls before running this cleanup (effects run after paint, and a
  // previous effect's cleanup runs before the next one fires) — so by the
  // time these urls are revoked here, either the component has unmounted or
  // a newer `urls` map has already taken their place in the DOM. Revoking on
  // every render instead of only when `assets` changes would race: a URL
  // could be torn down while the very `<img>` it backs is still on screen.
  useEffect(() => () => {
    for (const url of urls.values()) URL.revokeObjectURL(url)
  }, [urls])

  return useMemo(() => (html: string) =>
    html.replace(PACKAGED_REFERENCE_PATTERN, (reference) =>
      // An unmatched reference (no asset packaged for it — a packaging bug,
      // or an asset this app rejected) is left exactly as it is. Substituting
      // a placeholder or a data URI would hide that bug behind a picture; a
      // visibly broken image is the honest failure mode.
      urls.get(reference) ?? reference), [urls])
}
