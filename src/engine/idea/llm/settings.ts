/**
 * Where the model key lives: in the user's browser, on the user's device,
 * through the same IndexedDB wrapper the Canvas address uses — and nowhere
 * else. This is the one deliberate step past the Firecrawl key's tab-memory
 * contract: this is a PWA, an instructor reviews chapters over weeks, and a
 * key retyped every session is a key pasted into a text file on the desktop.
 * The panel says which device holds it and offers Forget key.
 */
import type { KeyValueStore } from '../../../canvas/credentials'
import { PROVIDERS, type ProviderId } from './providers'

export interface LlmSettings {
  provider: ProviderId
  key: string
  model: string
}

export interface LlmSettingsStore {
  load(): Promise<LlmSettings | undefined>
  save(settings: LlmSettings): Promise<void>
  forget(): Promise<void>
}

export const LLM_SETTINGS_KEY = 'idea.llm.settings'

/**
 * Only an offered provider is a valid setting. The panel's select disables
 * the others, so the only way a stored setting names one is a table that
 * changed after the save; loading it as undefined makes the panel ask again
 * rather than letting a run send the key somewhere no longer offered.
 */
const OFFERED_IDS: readonly string[] = PROVIDERS.filter((p) => p.offered).map((p) => p.id)

function isSettings(v: unknown): v is LlmSettings {
  return typeof v === 'object' && v !== null
    && OFFERED_IDS.includes((v as LlmSettings).provider)
    && typeof (v as LlmSettings).key === 'string'
    && typeof (v as LlmSettings).model === 'string'
}

export function createLlmSettingsStore(disk: KeyValueStore): LlmSettingsStore {
  return {
    async load() {
      const v = await disk.get(LLM_SETTINGS_KEY).catch(() => undefined)
      return isSettings(v) ? { provider: v.provider, key: v.key, model: v.model } : undefined
    },
    async save(settings) {
      await disk.set(LLM_SETTINGS_KEY, { provider: settings.provider, key: settings.key.trim(), model: settings.model.trim() })
    },
    async forget() {
      await disk.remove(LLM_SETTINGS_KEY)
    },
  }
}
