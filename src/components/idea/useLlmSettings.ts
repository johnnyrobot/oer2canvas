/**
 * The model settings as React state over the IndexedDB store. Loaded once on
 * mount; `save` and `forget` write through and update the state, so the
 * panel and the runs hook see the same record without a second read.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createIdbStore } from '../../canvas/idb'
import { createLlmSettingsStore, type LlmSettings, type LlmSettingsStore } from '../../engine/idea/llm/settings'

export function useLlmSettings(store?: LlmSettingsStore) {
  const ref = useRef(store ?? createLlmSettingsStore(createIdbStore()))
  const [settings, setSettings] = useState<LlmSettings | undefined>()
  // No `loaded` flag: nothing writes before the read, because `save` and
  // `forget` are click handlers on a panel that renders after the read
  // resolves or with the field empty — either way a write is the user's.
  useEffect(() => {
    let live = true
    ref.current.load().then((s) => { if (live) setSettings(s) }).catch(() => {})
    return () => { live = false }
  }, [])
  const save = useCallback(async (s: LlmSettings) => { await ref.current.save(s); setSettings(s) }, [])
  const forget = useCallback(async () => { await ref.current.forget(); setSettings(undefined) }, [])
  return { settings, save, forget }
}
