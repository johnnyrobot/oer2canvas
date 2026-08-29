import { configure } from '@testing-library/react'

/**
 * Give an async query long enough for work that is genuinely slow.
 *
 * Testing Library's `findBy*` and `waitFor` default to one second, which is
 * generous for a jsdom render and much too tight for what these tests actually
 * do: start a Worker, instantiate a WASM parser, parse a real document, and run
 * an axe audit over the result — in a real browser.
 *
 * Locally that is fast enough to hide the problem. `screen 1c` in
 * `App.a11y.browser.test.tsx` completes in about 160 ms on a developer machine
 * and timed out in CI on 2026-08-29. The workflow already records why: the
 * suite is "77s of it — six seconds locally, so the runner is where the time
 * goes". A shared runner is roughly an order of magnitude slower, and a
 * one-second budget for a WASM document parse does not survive that.
 *
 * Raised rather than removed, and kept well under the per-test timeout set
 * alongside it in `vitest.config.ts`, so a test that genuinely HANGS still
 * fails — and fails with Testing Library's message naming the query it was
 * waiting on, which is far more useful than a bare test timeout.
 */
configure({ asyncUtilTimeout: 5_000 })
