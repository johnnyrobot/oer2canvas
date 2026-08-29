import { createCredentialStore, migratePersistedTokens, type KeyValueStore } from './credentials'

/**
 * `web-key-containment.test.ts` proves adversarially that the Firecrawl key
 * reaches no persistence surface. This file applies the same method to the
 * other credential this app holds — the Canvas access token — but the shape
 * of the guarantee is different, and that difference is worth writing down.
 *
 * The Firecrawl key never touches a `KeyValueStore` at all; its containment is
 * structural. The Canvas token does: `createCredentialStore(disk)` takes one,
 * because the Canvas base URL (not a credential) is worth remembering across
 * reloads. So the guarantee here is behavioural — `credentials.ts` is handed a
 * disk and must simply never put the token on it — and that is exactly the
 * kind of claim a test, not a type signature, has to make.
 *
 * The persistence paths this module can reach, enumerated 2026-08-29 by
 * `grep -n "localStorage\|sessionStorage\|indexedDB\|document.cookie\|caches" \
 * src/canvas/credentials.ts` before writing any assertion:
 *
 *  1. The injected `disk` (a `KeyValueStore`) — the only hit, and only in the
 *     module's own header comment explaining why `sessionStorage` was
 *     rejected, not in a call. Every other identifier in that grep — direct
 *     `localStorage`, `indexedDB`, `document.cookie`, `caches` — appears
 *     nowhere in `credentials.ts`. Watching what reaches the injected `disk`
 *     therefore watches everything this module can write to. In production
 *     that `disk` is `createIdbStore()` from `idb.ts` (wired in `App.tsx`),
 *     which per its own header is "the one place this app writes to disk" —
 *     so a fake that records every `set`/`remove` call stands in for the real
 *     IndexedDB destination without needing jsdom's absent IndexedDB.
 *  2. The module-scoped `held` closure variable in `createCredentialStore` —
 *     deliberately not `sessionStorage`, per that function's own comment,
 *     because `sessionStorage` survives a reload and is readable by any script
 *     on the origin. A variable that dies with the document is not a
 *     persistence path at all, but the token must still come back from
 *     `load()` while the tab is open, or "session-only" would just mean
 *     "gone" — asserted as the positive control in the first test below.
 *  3. Logs — `grep -rn "console\." src/canvas` (excluding tests) returns
 *     nothing, so nothing on this path can write the token to a console
 *     a devtools session or a log drain could capture.
 */
const SENTINEL = 'canvas-SENTINEL-do-not-leak-0123456789'

/** A disk that records every write, so a token reaching it is visible. */
function recordingDisk(): { disk: KeyValueStore; writes: string[] } {
  const writes: string[] = []
  const values = new Map<string, unknown>()
  return {
    writes,
    disk: {
      async get(key) { return values.get(key) },
      async set(key, value) { writes.push(`${key}=${String(value)}`); values.set(key, value) },
      async remove(key) { writes.push(`remove ${key}`); values.delete(key) },
    },
  }
}

test('saving credentials writes the address to disk and the token nowhere', async () => {
  const { disk, writes } = recordingDisk()
  const store = createCredentialStore(disk)
  await store.save({ baseUrl: 'https://canvas.example.edu', token: SENTINEL })

  expect(writes.filter((write) => write.includes(SENTINEL))).toEqual([])
  // Positive control: the address IS written, so this cannot pass by observing
  // an inert store that writes nothing at all.
  expect(writes).toContain('canvas.baseUrl=https://canvas.example.edu')
  // And the token is still usable in memory for this tab — "session-only" means
  // readable now, not merely absent from disk.
  expect((await store.load())?.token).toBe(SENTINEL)
})

test('forget clears the token from memory as well as from disk', async () => {
  const { disk } = recordingDisk()
  const store = createCredentialStore(disk)
  await store.save({ baseUrl: 'https://canvas.example.edu', token: SENTINEL })
  await store.forget()
  expect((await store.load())?.token).toBeUndefined()
})

test('a token left on disk by an earlier release is never loaded, and is removed', async () => {
  /*
   * The migration exists because earlier releases offered opt-in persistence.
   * The load path must not treat a persisted token as a fallback even before the
   * migration has run, or a hand-edited profile would resurrect one.
   */
  const { disk } = recordingDisk()
  await disk.set('canvas.token', SENTINEL)
  await disk.set('canvas.baseUrl', 'https://canvas.example.edu')

  const store = createCredentialStore(disk)
  expect((await store.load())?.token).toBeUndefined()

  await migratePersistedTokens(disk)
  expect(await disk.get('canvas.token')).toBeUndefined()
})
