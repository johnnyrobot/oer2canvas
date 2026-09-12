/**
 * A React shell over `reduceReview` and `reduceHeader`: one review per
 * prepared chapter, one header, and the disk.
 *
 * Plumbing, deliberately: every rule lives in `engine/idea/review.ts`. This
 * owns only what a pure function cannot — creating a review the first time a
 * chapter is touched, reading the saved document once on mount, writing it
 * back after each change, and throwing everything away on request.
 *
 * PERSISTED, because a review is hours of a person's judgment. A reload, a
 * closed tab, or a re-prepare of the same chapter must find it again. The
 * store is the app's IndexedDB (`createIdbStore`), injected so a test can hand
 * in a Map; the key is `IDEA_STORAGE_KEY`. It is NOT cleared by
 * `clearDerivedOutput`: reviews are keyed by chapter identity, so a
 * re-prepared chapter finds its own review and a different book starts blank.
 *
 * Three rules keep the disk honest:
 *  - nothing is written until the read has settled, or a keystroke that lands
 *    before the read returns would overwrite last week's reviews with one note;
 *  - writes are debounced (`SAVE_DELAY_MS`), because notes arrive a keystroke
 *    at a time and each write is a whole document;
 *  - `forgetAll` clears the dirty flag BEFORE it empties state, so a debounce
 *    already scheduled cannot write the old document back after the remove.
 *
 * A write pending at unmount is dropped. The hook lives in `App`, which never
 * unmounts, so this costs nothing in practice; it is noted so nobody moves it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyValueStore } from '../../canvas/credentials'
import type { Chapter } from '../../sources/types'
import {
  newHeader, newReview, reduceHeader, reduceReview,
  type IdeaHeader, type IdeaHeaderEvent, type IdeaReview, type IdeaReviewEvent,
} from '../../engine/idea/review'
import { IDEA_STORAGE_KEY, restore, toPersisted } from '../../engine/idea/store'

export const SAVE_DELAY_MS = 400

/**
 * Source + book + title, because a chapter's identity here must survive a
 * recompile (which replaces the `CompiledChapter` object) and must NOT survive
 * choosing a different book that happens to have a chapter of the same name.
 */
export function reviewKeyOf(chapter: Chapter): string {
  return `${chapter.source}::${chapter.bookId}::${chapter.title}`
}

interface State {
  header: IdeaHeader
  reviews: ReadonlyMap<string, IdeaReview>
}

const empty = (): State => ({ header: newHeader(), reviews: new Map() })

export function useIdeaReviews(store?: KeyValueStore) {
  const [state, setState] = useState<State>(empty)
  const [loaded, setLoaded] = useState(store === undefined)
  const dirty = useRef(false)

  useEffect(() => {
    if (!store) return
    let cancelled = false
    store.get(IDEA_STORAGE_KEY)
      .then((value) => {
        if (cancelled) return
        const found = restore(value)
        // Merge under anything dispatched while the read was in flight: the
        // in-flight edits are newer than the disk by definition. `dirty` is
        // true exactly when something was dispatched before the read settled
        // (nothing is written, so nothing resets it, until `loaded`).
        if (found) {
          setState((s) => (dirty.current
            ? { header: s.header, reviews: new Map([...found.reviews, ...s.reviews]) }
            : found))
        }
      })
      .catch(() => { /* unreadable storage degrades to an unsaved session */ })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [store])

  useEffect(() => {
    if (!store || !loaded || !dirty.current) return
    const timer = setTimeout(() => {
      dirty.current = false
      void store.set(IDEA_STORAGE_KEY, toPersisted(state.header, state.reviews)).catch(() => {})
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [store, loaded, state])

  const reviewFor = useCallback((key: string) => state.reviews.get(key) ?? newReview(), [state.reviews])

  const dispatch = useCallback((key: string, event: IdeaReviewEvent) => {
    dirty.current = true
    setState((s) => {
      const reviews = new Map(s.reviews)
      reviews.set(key, reduceReview(s.reviews.get(key) ?? newReview(), event))
      return { ...s, reviews }
    })
  }, [])

  const dispatchHeader = useCallback((event: IdeaHeaderEvent) => {
    dirty.current = true
    setState((s) => ({ ...s, header: reduceHeader(s.header, event) }))
  }, [])

  const forgetAll = useCallback(() => {
    dirty.current = false
    setState(empty())
    if (store) void store.remove(IDEA_STORAGE_KEY).catch(() => {})
  }, [store])

  return { header: state.header, reviews: state.reviews, loaded, reviewFor, dispatch, dispatchHeader, forgetAll }
}
