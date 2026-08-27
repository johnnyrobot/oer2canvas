/**
 * Where the Canvas access token lives, and for how long.
 *
 * The token is session-only. It is held in this module while the document is
 * open and is never written to IndexedDB. The Canvas base URL is not a
 * credential and remains browser-local for convenience.
 */

/** The async key-value shape IndexedDB is wrapped in. Injected, so tests see disk. */
export interface KeyValueStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

export interface Credentials {
  baseUrl: string
  token: string
}

/** What comes back on load: the address may outlive the token, and usually does. */
export interface StoredCredentials {
  baseUrl: string
  token?: string
}

const ADDRESS_KEY = 'canvas.baseUrl'
const TOKEN_KEY = 'canvas.token'
const TOKEN_MIGRATION_KEY = 'canvas.token-migration.v1'

/**
 * One-time cleanup for releases that offered opt-in token persistence.
 *
 * The default IndexedDB store removes a key from both `oer2canvas` and the
 * prototype `book2canvas` database. The marker makes the migration cheap on
 * later loads; the store never reads the token key again, even if a damaged or
 * manually edited profile reintroduces it after the marker is set.
 */
export async function migratePersistedTokens(disk: KeyValueStore): Promise<void> {
  if (await disk.get(TOKEN_MIGRATION_KEY) === true) return
  await disk.remove(TOKEN_KEY)
  await disk.set(TOKEN_MIGRATION_KEY, true)
}

export interface CredentialStore {
  load(): Promise<StoredCredentials | undefined>
  save(credentials: Credentials): Promise<void>
  forget(): Promise<void>
}

export function createCredentialStore(disk: KeyValueStore): CredentialStore {
  /*
   * The session half. Holding it here rather than in `sessionStorage` is
   * deliberate: `sessionStorage` survives a reload and is readable by any script
   * on the origin, which is most of what we were avoiding. A module-scoped
   * variable dies with the document, which is what "session only" should mean.
   */
  let held: string | undefined

  return {
    async load() {
      const baseUrl = (await disk.get(ADDRESS_KEY)) as string | undefined
      // Persisted tokens are deliberately not a fallback. The migration removes
      // old copies, and this guard keeps a stale key from becoming usable even if
      // a profile was edited outside the app.
      const token = held
      if (baseUrl === undefined && token === undefined) return undefined
      return { baseUrl: baseUrl ?? '', ...(token !== undefined ? { token } : {}) }
    },

    async save(credentials) {
      held = credentials.token
      await disk.set(ADDRESS_KEY, credentials.baseUrl)
      // A successful connection also clears any pre-release copy that might
      // still be present in a profile whose migration has not run yet.
      await disk.remove(TOKEN_KEY)
    },

    async forget() {
      held = undefined
      await disk.remove(TOKEN_KEY)
    },
  }
}
