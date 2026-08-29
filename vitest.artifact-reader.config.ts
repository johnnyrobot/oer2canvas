import { defineConfig } from 'vitest/config'

/**
 * A SEPARATE Vitest config — not a fourth project in `vitest.config.ts` — for
 * exactly one file: `src/import/cartridge-artifact.test.ts`.
 *
 * That file shells out to a real `unzip` and reads artifacts a SIBLING Vitest
 * project (`browser`, in `vitest.config.ts`) writes to disk, with no ordering
 * guarantee between projects — running it automatically alongside everything
 * else would risk exactly the race that file's own module comment describes.
 * So it is EXCLUDED from `vitest.config.ts`'s `unit` project (see that
 * project's `exclude` entry, and the comment there) and lives here instead,
 * where a bare `npx vitest run` — which resolves `vitest.config.ts` by
 * Vitest's own default config lookup, never this file — cannot reach it.
 * `npm run test:artifacts` (`package.json`) is the one command that does, and
 * only runs it AFTER the `browser`-project writer has already finished or
 * failed.
 *
 * A second entry in `vitest.config.ts`'s `test.projects` would not have
 * worked: EVERY project there runs for a bare `vitest run`, whether or not a
 * specific file is later named on the command line — passing a file path as a
 * CLI filter narrows WITHIN a project's already-configured `include`, it does
 * not add a file outside it or bypass an `exclude` entry. (Checked directly:
 * `vitest run --project unit src/import/cartridge-artifact.test.ts`, with
 * that file excluded from `unit`, reports "No test files found".) There is no
 * "registered but skipped by default" middle ground in Vitest's project
 * model — only a genuinely separate config file, which a bare `vitest run`
 * never loads, actually achieves it.
 */
export default defineConfig({
  test: {
    name: 'cartridge-artifact-reader',
    include: ['src/import/cartridge-artifact.test.ts'],
    globals: true,
    // Not jsdom: this file makes no DOM assertion, only `node:child_process`
    // and `node:fs` calls against bytes already on disk.
    environment: 'node',
  },
})
