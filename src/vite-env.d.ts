/// <reference types="vite/client" />

/** Empty in the public build; an exact HTTPS origin in an opted-in self-host build. */
declare const __OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__: string

/**
 * Empty in the public build, where a web page is fetched by Firecrawl on the
 * user's own key; an exact HTTPS origin in a build whose operator runs the
 * extraction service themselves, where no key is asked for, sent, or held.
 *
 * HTTPS is not a preference. Measured 2026-08-30 on Chromium 151: an HTTPS page
 * cannot reach `http://localhost` (the loopback address space is permission-
 * gated and denied by default) and cannot reach any other plain-HTTP origin
 * (mixed content, refused before the request exists).
 */
declare const __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__: string

/*
 * Vite's ambient declarations, pulled in by reference rather than by adding
 * "vite/client" to tsconfig's `types` array — that array is deliberately curated
 * for test globals, and a triple-slash reference in an included .d.ts is honoured
 * regardless of it.
 *
 * What we need from it today is `declare module '*.css'`, so that `App.tsx`'s
 * side-effect `import './App.css'` type-checks under `tsc --noEmit`.
 */
