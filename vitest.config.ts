import { defineConfig } from 'vitest/config'
import { playwright } from '@vitest/browser-playwright'

/**
 * Three projects, because exactly one kind of test needs a real browser and one
 * kind needs that browser started differently.
 *
 * `unit` keeps the pure engine, contracts, worker and component tests in jsdom —
 * fast, no browser binary, no layout. `browser` runs `*.browser.test.*` in
 * headless Chromium, where axe-core has real layout and real computed styles.
 *
 * The `.browser.test.{ts,tsx}` glob is deliberately written for BOTH extensions on
 * both sides: the unit project's `include` matches `.tsx`, so a `.ts`-only `exclude`
 * would let a `.tsx` browser test run a second time under jsdom, where axe has no
 * layout and an accessibility assertion means nothing.
 *
 * `browser-forced-colors` exists because forced colors CANNOT BE SWITCHED ON FROM
 * INSIDE THE PAGE. It is a browser context option, so the only way to measure the
 * queue's behaviour under Windows High Contrast is a second context — which means
 * a second project, and a second browser launch. That cost is why the project's
 * `include` is one file rather than the whole geometry suite: only assertions that
 * genuinely need the mode belong there, and the file itself opens by asserting the
 * mode is on, so it can never quietly pass while measuring ordinary rendering.
 */
export default defineConfig({
  // Test the same fail-closed configuration as the public build. Opted-in
  // Canvas presentation is covered through the components' injected props.
  define: {
    __OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__: JSON.stringify(''),
  },
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts', 'scripts/**/*.test.mjs'],
          exclude: ['src/**/*.browser.test.{ts,tsx}'],
        },
      },
      {
        test: {
          name: 'browser',
          globals: true,
          include: ['src/**/*.browser.test.{ts,tsx}'],
          // The forced-colors file matches the glob above and must NOT run here
          // too: this project's context has forced colors off, so every
          // assertion in it would pass against ordinary rendering and report a
          // mode that was never active.
          exclude: ['src/**/*.forced-colors.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            // Vitest 4 takes a provider FACTORY, not the string 'playwright' the
            // task brief was written against. Chromium stays pinned below.
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
      {
        test: {
          name: 'browser-forced-colors',
          globals: true,
          include: ['src/**/*.forced-colors.browser.test.{ts,tsx}'],
          browser: {
            enabled: true,
            provider: playwright({
              // The whole reason this project exists. `forcedColors` is a
              // BrowserContext option, so it can only be set where a context is
              // created — not from a test, and not per file within a project.
              contextOptions: { forcedColors: 'active' },
            }),
            headless: true,
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
})
