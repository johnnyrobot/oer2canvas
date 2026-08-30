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
/**
 * The fail-closed build constants, spelled out PER PROJECT.
 *
 * Measured 2026-08-30: a `define` declared at the root of this file does not
 * reach its projects. A probe test in the `unit` project read
 * `typeof __OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__` as `'undefined'` while the
 * root `define` set it to `''` — so the root entry this replaced had never
 * actually configured anything, and the app's `typeof` guards were doing all
 * the work. Repeating it on each project is what makes the comment below true
 * rather than aspirational; the guards stay, because they are the reason that
 * discrepancy was harmless rather than a bug for a year.
 *
 * Public values here, deliberately: the suite tests the same fail-closed
 * configuration the public build ships. Opted-in Canvas presentation is covered
 * through the components' injected props. The opted-in EXTRACTOR cannot be
 * covered that way — the whole point of it is that the public bundle does not
 * contain the branch, and a prop would keep the branch alive and carry the
 * extractor's endpoint into that bundle, which `scripts/smoke-dist.mjs`
 * refuses. So it gets a project of its own instead.
 */
const PUBLIC_BUILD_DEFINES = {
  __OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__: JSON.stringify(''),
  __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__: JSON.stringify(''),
}

export default defineConfig({
  test: {
    projects: [
      {
        define: PUBLIC_BUILD_DEFINES,
        test: {
          name: 'unit',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: [
            'src/**/*.test.{ts,tsx}',
            'worker/**/*.test.ts',
            'scripts/**/*.test.mjs',
            // The build-mode validator behind the two `define`s. At the root
            // rather than under `src/` because it is build tooling, and named
            // individually here for the same reason `tsconfig.node.json` names
            // its files: this list should be hard to grow by accident.
            'vite.deployment.test.ts',
          ],
          exclude: [
            'src/**/*.browser.test.{ts,tsx}',
            // Matches the `include` glob above and must NOT run here too: this
            // project pins the extractor origin to '' — the public build — so
            // every assertion in a self-hosted file would pass while measuring
            // the configuration it exists to say nothing about. Same failure
            // shape as the forced-colors exclusion in the `browser` project.
            'src/**/*.self-hosted.test.{ts,tsx}',
            // Depends on an artifact `cartridge-artifact.browser.test.ts` (the
            // `browser` project) writes to disk, and nothing in this config
            // orders one project's files ahead of another's — so a plain
            // `npx vitest run` (or `--project unit` alone) must not run it,
            // or it fails on a clean tree with nothing actually broken.
            // `npm run test:artifacts` (`package.json`) runs the writer and
            // then this file, sequentially, via the separate
            // `vitest.artifact-reader.config.ts` — see that file for why a
            // CLI filter on `--project unit` cannot simply un-exclude it here
            // instead. CI runs `npm run test:artifacts` as its own step so
            // this coverage is not lost, just moved out of the default run.
            'src/import/cartridge-artifact.test.ts',
          ],
        },
      },
      {
        /*
         * THE OPTED-IN WEB-EXTRACTION BUILD, WHICH IS A `define` AND SO CANNOT
         * BE SWITCHED ON FROM INSIDE A TEST.
         *
         * Same constraint that made `browser-forced-colors` a project rather
         * than a test option, arriving from the build side instead of the
         * browser side: Vite substitutes `__OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__`
         * before a test ever runs, so the only way to exercise the branch is a
         * second configuration. It is jsdom and its `include` is one glob, so
         * unlike the forced-colors project it costs no browser launch.
         *
         * Deliberately narrow. Everything that does not depend on the switch
         * stays in `unit`: the fetcher itself takes its origin as an injected
         * dependency, exactly as `firecrawl.ts` takes its key, so its whole
         * failure taxonomy is testable with no build switch at all. What lives
         * here is only what the switch decides — which fetcher the panel wires
         * up, and that the key UI is absent rather than hidden.
         */
        define: {
          ...PUBLIC_BUILD_DEFINES,
          __OER2CANVAS_SELF_HOSTED_EXTRACTOR_ORIGIN__: JSON.stringify('https://extract.example.edu'),
          /*
           * The Canvas capability joined this project in issue 22, for the same
           * reason the extractor was here first: it is a `define`, so it cannot
           * be switched on from inside a test, and injecting a prop instead
           * would keep the branch alive and carry the token UI into the public
           * bundle — which `scripts/smoke-dist.mjs` now refuses.
           */
          __OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__: JSON.stringify('https://canvas.example.edu'),
        },
        test: {
          name: 'unit-self-hosted',
          globals: true,
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.self-hosted.test.{ts,tsx}'],
        },
      },
      {
        define: PUBLIC_BUILD_DEFINES,
        test: {
          name: 'browser',
          globals: true,
          setupFiles: ['./src/test/browser-setup.ts'],
          // Comfortably above the async-query budget that file sets, so a real
          // hang is reported by the query that hung rather than by a bare
          // per-test timeout that names nothing.
          testTimeout: 20_000,
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
        define: PUBLIC_BUILD_DEFINES,
        test: {
          name: 'browser-forced-colors',
          globals: true,
          setupFiles: ['./src/test/browser-setup.ts'],
          testTimeout: 20_000,
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
