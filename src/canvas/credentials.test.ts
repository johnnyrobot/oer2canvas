import { createCredentialStore, migratePersistedTokens } from './credentials'
import type { KeyValueStore } from './credentials'

/** Stands in for IndexedDB. Real enough to assert what did and did not reach disk. */
function fakeDisk(): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>()
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => { data.set(k, v) },
    remove: async (k) => { data.delete(k) },
  }
}

const CREDS = { baseUrl: 'https://school.instructure.com', token: 'secret-token' }

test('a connected token is usable in the current session and never reaches disk', async () => {
  const disk = fakeDisk()
  const store = createCredentialStore(disk)
  await store.save(CREDS)

  expect(await store.load()).toEqual(CREDS)
  expect([...disk.data.values()].some((v) => JSON.stringify(v).includes('secret-token'))).toBe(false)
})

test('a token is not recovered by a new session after reload', async () => {
  const disk = fakeDisk()
  await createCredentialStore(disk).save(CREDS)

  // A new store over the same disk is what a reload looks like. The address is
  // still useful, but the token is not a persisted credential.
  expect(await createCredentialStore(disk).load()).toEqual({ baseUrl: CREDS.baseUrl })
})

test('the address is remembered while the token remains session-only', async () => {
  const disk = fakeDisk()
  await createCredentialStore(disk).save(CREDS)

  const reloaded = await createCredentialStore(disk).load()
  expect(reloaded?.baseUrl).toBe('https://school.instructure.com')
  expect(reloaded?.token).toBeUndefined()
})

test('saving a new connection removes a token stored by an earlier release', async () => {
  const disk = fakeDisk()
  disk.data.set('canvas.token', 'old-token')
  await createCredentialStore(disk).save(CREDS)
  expect(disk.data.has('canvas.token')).toBe(false)
})

test('forgetting a token leaves nothing to load, on disk or in the session', async () => {
  const disk = fakeDisk()
  const store = createCredentialStore(disk)
  await store.save(CREDS)
  await store.forget()
  expect((await store.load())?.token).toBeUndefined()
  expect(disk.data.has('canvas.token')).toBe(false)
})

test('the one-time migration deletes old tokens without deleting the address', async () => {
  const disk = fakeDisk()
  disk.data.set('canvas.baseUrl', CREDS.baseUrl)
  disk.data.set('canvas.token', 'old-token')

  await migratePersistedTokens(disk)

  expect(disk.data.has('canvas.token')).toBe(false)
  expect(disk.data.get('canvas.baseUrl')).toBe(CREDS.baseUrl)
  expect(disk.data.get('canvas.token-migration.v1')).toBe(true)
})
