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
 *
 * LIFECYCLE: the map is built INSIDE the effect, not in a `useMemo` computed
 * during render. That is not stylistic — it is the only construction that is
 * correct under `StrictMode` (which `src/main.tsx` enables unconditionally).
 * `StrictMode` deliberately simulates an extra unmount/remount of every
 * effect on initial mount, in development only, by invoking this effect's
 * cleanup and then its setup a second time with nothing in between. A version
 * that created the urls once in a memo and only ever REVOKED in the effect
 * (no setup work to redo) treated that synthetic cleanup as real: the
 * cleanup unconditionally revoked every url the memo made, the following
 * synthetic setup recreated nothing (there was nothing left for it to do),
 * and the `<img>` already painted from the memoized map was left pointing at
 * a revoked blob url — `naturalWidth` measured 0, not 16, under `StrictMode`
 * (see `packaged-preview.browser.test.tsx`, "an image with a packaged
 * reference decodes even under React StrictMode's double-invoked effects").
 * Building the urls in the effect body makes setup and cleanup symmetric: a
 * synthetic remount revokes exactly the urls its own paired setup just made
 * and immediately creates a fresh, equally valid set from the same
 * `asset.bytes`, so no `<img>` is ever left holding a revoked reference no
 * matter how many times the pair runs. `useMemo` is not an alternative
 * fix here either way — React explicitly reserves the right to discard and
 * recompute a memoized value, so a design that depended on the memo
 * surviving across renders would be fragile beyond `StrictMode` too.
 *
 * TRADE-OFF: because the urls are not ready until after the first commit,
 * the very first paint of a chapter or page carrying packaged images renders
 * the raw `$IMS-CC-FILEBASE$/…` token (visibly broken, exactly like an
 * unmatched reference) for one effect flush, before the state update from
 * this effect swaps in the resolved `blob:` urls. That flash is judged
 * acceptable: it is a single render, self-correcting, browser-local, and no
 * worse than what an unmatched reference already looks like permanently —
 * it is not a new failure mode, only a briefly-delayed correct one.
 */
import { useCallback, useEffect, useState } from 'react'
import type { ImportedAsset } from '../import/types'
import { packagedReference } from '../import/assets'

/** Matches this app's own packaged reference form; see `isPackagedReference` in `../import/assets.ts`. */
const PACKAGED_REFERENCE_PATTERN = /\$IMS-CC-FILEBASE\$\/oer2canvas\/[^"'\s>]+/g

// A literal `= []` default parameter evaluates to a BRAND NEW array on every
// call where the caller passes `undefined` (e.g. `chapter.assets` on a
// catalog-source chapter, which has no packaged assets at all). Since the
// effect below depends on `[assets]` by reference, a fresh array every render
// would make that dependency look different on every render, re-running the
// effect, calling `setUrls` with a new (still-empty) map, causing another
// render, forever — an infinite `setState`-in-effect loop caught only by
// React's own runaway-render guard ("Maximum update depth exceeded"). One
// shared, stable reference for the no-assets case avoids that entirely: it
// is `===` itself across every render, so the effect only ever reruns when a
// caller passes an ACTUAL new asset list, not merely omits the argument.
const NO_ASSETS: readonly ImportedAsset[] = []

// One shared, immutable, empty map — never mutated, only ever handed out —
// so that setting state back to "no urls" is a call to `setUrls` with the
// EXACT SAME reference every time, not a fresh `new Map()`. React skips
// re-rendering entirely when a state update's value is `Object.is`-equal to
// the current value; using one constant instead of allocating a new empty
// map is what makes that bail-out actually fire for the (overwhelmingly
// common) case of a chapter or page with no packaged assets — every catalog
// source, and every document import with no embedded images.
const NO_ASSET_URLS: ReadonlyMap<string, string> = new Map()

export function usePackagedAssetUrls(assets: readonly ImportedAsset[] = NO_ASSETS): (html: string) => string {
  // Starts as the SAME reference the effect below sets it back to whenever
  // there is nothing to resolve, so the no-assets case never needs a second
  // render to arrive at its own already-correct starting state.
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(NO_ASSET_URLS)

  useEffect(() => {
    // Nothing to create. `setUrls(NO_ASSET_URLS)` still runs (rather than an
    // early return with no state update at all) so a chapter that HAD
    // packaged assets and now has none clears its stale, about-to-be-revoked
    // map out of state — but because it is the same shared reference as the
    // initial state above, React's `Object.is` bail-out on state updates
    // makes this a genuine no-op for the ordinary mount-with-no-assets case,
    // rather than the extra render a fresh `new Map()` here would force.
    // That distinction was not academic: an app-level regression test
    // (`src/App.document.test.tsx`) measured a version of this effect that
    // unconditionally called `setUrls(new Map())` perturbing the timing of an
    // unrelated async race elsewhere in the app clearly enough to make it
    // fail intermittently, purely from the extra render it forced on every
    // mount of every asset-free chapter or page — nearly all of them.
    if (assets.length === 0) {
      setUrls(NO_ASSET_URLS)
      return
    }
    // Built fresh on every invocation of this effect — including the second,
    // synthetic one `StrictMode` runs back-to-back with the first — so the
    // pairing below with the cleanup it returns is always exactly balanced.
    const map = new Map<string, string>()
    for (const asset of assets) {
      // `asset.bytes` is typed `Uint8Array<ArrayBufferLike>` (it may be a view
      // over a `SharedArrayBuffer`), which `BlobPart` does not accept; the cast
      // matches the one already made for the same reason in
      // `../engine/export/download.ts`. Blob construction itself copies the
      // bytes rather than aliasing them, so this is not a lifetime hazard, and
      // is why re-running this loop on a synthetic remount is safe and cheap.
      const blob = new Blob([asset.bytes as BlobPart], { type: asset.mediaType })
      map.set(packagedReference(asset.name), URL.createObjectURL(blob))
    }
    setUrls(map)
    // Revokes precisely the urls THIS invocation created (closed over as the
    // local `map`, never the `urls` state, which could already have moved on
    // to a newer map by the time this runs). That is what keeps a `StrictMode`
    // remount, an `assets` change, and a genuine unmount all safe by the same
    // rule: whichever setup made a map, the matching cleanup tears down that
    // exact map, never a different one that might still be on screen.
    return () => {
      for (const url of map.values()) URL.revokeObjectURL(url)
    }
  }, [assets])

  return useCallback((html: string) =>
    html.replace(PACKAGED_REFERENCE_PATTERN, (reference) =>
      // An unmatched reference (no asset packaged for it — a packaging bug,
      // or an asset this app rejected) is left exactly as it is. Substituting
      // a placeholder or a data URI would hide that bug behind a picture; a
      // visibly broken image is the honest failure mode.
      urls.get(reference) ?? reference), [urls])
}
