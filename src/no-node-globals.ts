/**
 * COMPILE-TIME TRIPWIRE. This file has no runtime behaviour and is imported by
 * nothing — deleting it as dead code removes a guarantee, so don't.
 *
 * oer2canvas is a PWA: everything happens in the user's browser, and there is
 * no server to hold a `process` or a `Buffer`. `tsconfig.json` therefore leaves
 * "node" out of its `types` array, which makes a node global in `src/` or
 * `worker/` a compile error rather than a blank screen in production.
 *
 * That is a property of a config file, and config files get edited by whoever
 * is trying to make one stubborn import typecheck. The two directives below are
 * what stops that edit from passing silently: `@ts-expect-error` is itself an
 * error when the line beneath it does NOT error, so the moment "node" returns to
 * `tsconfig.json` these become `TS2578: Unused '@ts-expect-error' directive` and
 * `npm run build` fails pointing straight at this explanation.
 *
 * If you got here from that failure: the fix is to put the file that needs node
 * into `tsconfig.node.json`'s `include` list, not to widen the app project.
 * `src/engine/compile/golden.test.ts` is the worked example — it reads and
 * writes goldens from disk, so it lives there and is checked with node types
 * while every shipped file is checked without them.
 */

// @ts-expect-error `process` must not be visible to code that ships to a browser.
export type ProcessMustNotBeVisible = typeof process

// @ts-expect-error `Buffer` must not be visible to code that ships to a browser.
export type BufferMustNotBeVisible = typeof Buffer
