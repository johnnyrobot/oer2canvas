import { LLM_SETTINGS_KEY, createLlmSettingsStore } from './settings'
import type { KeyValueStore } from '../../../canvas/credentials'

function memoryDisk(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return { data, get: async (k) => data.get(k), set: async (k, v) => { data.set(k, v) }, remove: async (k) => { data.delete(k) } }
}

test('save writes the settings under one key; load reads them back; forget removes them', async () => {
  const disk = memoryDisk()
  const store = createLlmSettingsStore(disk)
  expect(await store.load()).toBeUndefined()
  await store.save({ provider: 'gemini', key: 'k', model: 'gemini-2.5-flash' })
  expect(disk.data.get(LLM_SETTINGS_KEY)).toEqual({ provider: 'gemini', key: 'k', model: 'gemini-2.5-flash' })
  expect(await store.load()).toEqual({ provider: 'gemini', key: 'k', model: 'gemini-2.5-flash' })
  await store.forget()
  expect(disk.data.has(LLM_SETTINGS_KEY)).toBe(false)
})

test('a damaged record loads as undefined rather than throwing', async () => {
  const disk = memoryDisk()
  disk.data.set(LLM_SETTINGS_KEY, { provider: 'nope' })
  expect(await createLlmSettingsStore(disk).load()).toBeUndefined()
})
