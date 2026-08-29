/**
 * Where the Firecrawl API key lives, and for how long.
 *
 * This mirrors `src/canvas/credentials.ts`, which solved the same problem for
 * the Canvas access token and documented the reasoning: `sessionStorage`
 * survives a reload and is readable by any script on the origin, while a
 * variable scoped to a closure dies with the document — which is what "session
 * only" should mean.
 *
 * The difference from `createCredentialStore` is the argument list, and it is
 * deliberate. That factory takes a `KeyValueStore` because the Canvas base URL
 * is worth remembering across reloads. Nothing about a Firecrawl key is. Taking
 * NO store means there is no persistence path to forget to avoid: the type does
 * not admit one. It also means this feature needs no migration of the kind
 * `migratePersistedTokens` exists to be, because no release of it ever wrote a
 * key anywhere — and it must never acquire one.
 */
export interface FirecrawlKeyStore {
  /** Replace the held key. Blank or whitespace-only clears it. */
  hold(key: string): void
  peek(): string | undefined
  forget(): void
}

export function createFirecrawlKeyStore(): FirecrawlKeyStore {
  let held: string | undefined

  return {
    hold(key) {
      const trimmed = key.trim()
      // A user who clears the field has forgotten the key as surely as one who
      // pressed the button, and `Bearer ` with nothing after it would come back
      // as an unexplained 401.
      held = trimmed === '' ? undefined : trimmed
    },
    peek() {
      return held
    },
    forget() {
      held = undefined
    },
  }
}
