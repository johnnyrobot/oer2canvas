import '@testing-library/jest-dom/vitest'

/**
 * No test in this suite may touch the network.
 *
 * This was true by habit and is now true by construction. The guard throws
 * SYNCHRONOUSLY rather than rejecting, so a caller that forgets to await still
 * fails loudly at the call site instead of producing an unhandled rejection
 * three ticks later. Anything that legitimately needs a fetch injects its own —
 * `createOpenStaxClient({ fetch })` already takes one — so nothing in the app
 * should be reaching for the ambient global anyway.
 */
globalThis.fetch = ((input: RequestInfo | URL): never => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  throw new Error(
    `network access is disabled in tests; something tried to fetch ${url}. ` +
      'Inject a fetch instead of using the global one.',
  )
}) as unknown as typeof globalThis.fetch
