/**
 * One search in flight at a time. A new search aborts the last, and a result
 * that lands after its controller was aborted is dropped, so the grid never
 * shows an answer to a question the instructor has moved on from.
 */
import { useCallback, useRef, useState } from 'react'
import { createCommonsSearch } from '../../engine/idea/images/commons'
import { createOpenverseSearch } from '../../engine/idea/images/openverse'
import type { ImageHit, ImageProvider, ImageSearch, License } from '../../engine/idea/images/search'

export type SearchState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'done'; hits: ImageHit[]; provider: ImageProvider }
  | { status: 'failed'; message: string }

const DEFAULT: readonly ImageSearch[] = [createCommonsSearch(), createOpenverseSearch()]

export function useImageSearch(deps: { providers?: readonly ImageSearch[] } = {}) {
  const providers = deps.providers ?? DEFAULT
  const [state, setState] = useState<SearchState>({ status: 'idle' })
  const inflight = useRef<AbortController | undefined>(undefined)

  const search = useCallback((providerId: ImageProvider, query: string, licenses: readonly License[]) => {
    const provider = providers.find((p) => p.id === providerId)
    if (!provider || !provider.offered || !query.trim()) return
    inflight.current?.abort()
    const controller = new AbortController()
    inflight.current = controller
    setState({ status: 'searching' })
    provider.search(query.trim(), { licenses, signal: controller.signal })
      .then((hits) => { if (!controller.signal.aborted) setState({ status: 'done', hits, provider: providerId }) })
      .catch((e: unknown) => { if (!controller.signal.aborted) setState({ status: 'failed', message: e instanceof Error ? e.message : String(e) }) })
  }, [providers])

  const cancel = useCallback(() => { inflight.current?.abort(); setState({ status: 'idle' }) }, [])

  return { providers, state, search, cancel }
}
