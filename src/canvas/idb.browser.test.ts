import { createIdbStore } from './idb'
import { createCredentialStore, migratePersistedTokens } from './credentials'

/**
 * IndexedDB, in a browser, because there is nowhere else this can be true.
 *
 * jsdom does not implement IndexedDB at all, so a unit test of this file would
 * be a test of whatever fake was injected — which is exactly the seam
 * `credentials.test.ts` already covers. What is worth proving here is the part
 * no fake can stand in for: that a value written through this wrapper survives
 * being read back by a DIFFERENT connection, which is what a reload is.
 */

let n = 0
const freshDb = () => `book2canvas-test-${Date.now()}-${n++}`

test('a value written survives being read back by a new connection', async () => {
  const name = freshDb()
  await createIdbStore(name).set('canvas.token', 'secret-token')
  expect(await createIdbStore(name).get('canvas.token')).toBe('secret-token')
})

test('a key that was never written reads as undefined, not as a throw', async () => {
  expect(await createIdbStore(freshDb()).get('canvas.token')).toBeUndefined()
})

test('removing a key really removes it', async () => {
  const name = freshDb()
  const store = createIdbStore(name)
  await store.set('canvas.token', 'secret-token')
  await store.remove('canvas.token')
  expect(await createIdbStore(name).get('canvas.token')).toBeUndefined()
})

// The push journal is an object, not a string — structured clone is the whole
// reason this is IndexedDB rather than localStorage.
test('stores structured values, which is why this is not localStorage', async () => {
  const name = freshDb()
  const journal = { courseId: 17, landed: [{ slug: 'a', title: 'A' }] }
  await createIdbStore(name).set('canvas.journal', journal)
  expect(await createIdbStore(name).get('canvas.journal')).toEqual(journal)
})

test('the token migration removes current and legacy copies while preserving other state', async () => {
  const migrationDisk = createIdbStore()
  // Browser-project files share an origin. App tests can therefore leave the
  // one-time marker behind before this test runs, so explicitly recreate a
  // pre-migration profile before seeding the old credential copies.
  await migrationDisk.remove('canvas.token-migration.v1')
  await migrationDisk.set('canvas.baseUrl', 'https://school.example')
  await migrationDisk.set('canvas.token', 'current-token')
  // Seed the legacy name after the current write; the compatibility wrapper
  // intentionally removes legacy keys when it writes to the current database.
  await createIdbStore('book2canvas').set('canvas.token', 'legacy-token')
  await migratePersistedTokens(migrationDisk)

  expect(await createIdbStore().get('canvas.token')).toBeUndefined()
  expect(await createIdbStore('book2canvas').get('canvas.token')).toBeUndefined()
  expect(await createIdbStore().get('canvas.baseUrl')).toBe('https://school.example')
})

test('forget removes a session token and both real database copies', async () => {
  const disk = createIdbStore()
  const store = createCredentialStore(disk)
  await store.save({ baseUrl: 'https://school.example', token: 'session-token' })
  expect((await store.load())?.token).toBe('session-token')

  await disk.set('canvas.token', 'current-token')
  await createIdbStore('book2canvas').set('canvas.token', 'legacy-token')
  await store.forget()

  expect((await store.load())?.token).toBeUndefined()
  expect(await disk.get('canvas.token')).toBeUndefined()
  expect(await createIdbStore('book2canvas').get('canvas.token')).toBeUndefined()
})
