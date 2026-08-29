import { createFirecrawlKeyStore } from './firecrawl-key'

test('a held key can be read back and erased', () => {
  const store = createFirecrawlKeyStore()
  expect(store.peek()).toBeUndefined()
  store.hold('fc-abc123')
  expect(store.peek()).toBe('fc-abc123')
  store.forget()
  expect(store.peek()).toBeUndefined()
})

test('a blank or whitespace-only key is not a key', () => {
  // The UI's Forget button and an empty field must mean the same thing, or a
  // user who cleared the box would send `Bearer ` and get an unexplained 401.
  const store = createFirecrawlKeyStore()
  store.hold('   ')
  expect(store.peek()).toBeUndefined()
  store.hold(' fc-abc123 ')
  expect(store.peek()).toBe('fc-abc123')
})

test('two stores do not share a key', () => {
  // Module-scoped inside the FACTORY, not at module top level: a top-level
  // `let` would be one key for every caller in the tab, which is a wider
  // blast radius than this needs and makes the containment tests lie.
  const a = createFirecrawlKeyStore()
  const b = createFirecrawlKeyStore()
  a.hold('fc-a')
  expect(b.peek()).toBeUndefined()
})

test('the store takes no argument, so no caller can hand it a disk', () => {
  /*
   * Not a style assertion. `createCredentialStore(disk)` exists three
   * directories away and takes a `KeyValueStore`; the ONE structural guarantee
   * that this key can never be persisted is that its constructor has nowhere to
   * put a store. If someone later adds an options bag, this fails and they have
   * to argue for it.
   */
  expect(createFirecrawlKeyStore).toHaveLength(0)
})
