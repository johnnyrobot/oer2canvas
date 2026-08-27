/// <reference types="vite/client" />

/** Empty in the public build; an exact HTTPS origin in an opted-in self-host build. */
declare const __OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__: string

/*
 * Vite's ambient declarations, pulled in by reference rather than by adding
 * "vite/client" to tsconfig's `types` array — that array is deliberately curated
 * for test globals, and a triple-slash reference in an included .d.ts is honoured
 * regardless of it.
 *
 * What we need from it today is `declare module '*.css'`, so that `App.tsx`'s
 * side-effect `import './App.css'` type-checks under `tsc --noEmit`.
 */
