/**
 * Is the document importer releasable, and how would anyone know?
 *
 * This prints one row per acceptance criterion from issue 13 and the check that
 * closes it. Its value is not that it runs commands — anyone can run commands —
 * but that a criterion with NO check shows up as a hole instead of an
 * assumption.
 *
 * It reports exactly two kinds of thing: ENFORCED, which it runs, and MANUAL,
 * which it cannot. There is deliberately no third "reviewed" state: that is the
 * category that quietly stops happening.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const RUN = {
  typecheck: ['npm', ['run', 'typecheck']],
  // Runs every Vitest project (`unit`, `browser`, `browser-forced-colors`) that
  // `vitest.config.ts` declares — a bare `vitest run` with no `--project` filter
  // runs all of them. That is what makes criteria 1, 2, 3, 5 and 6 below true:
  // their tests are split across `.test.ts` (unit) and `.browser.test.ts(x)`
  // (browser) files, and this one command reaches both.
  tests: ['npx', ['vitest', 'run']],
  // Deliberately NOT part of `tests` above. `vitest.config.ts`'s `unit` project
  // excludes `src/import/cartridge-artifact.test.ts` — see the comment on that
  // `exclude` entry — because it reads an artifact that the `browser` project's
  // `cartridge-artifact.browser.test.ts` writes, and Vitest gives no ordering
  // guarantee between projects in a single `vitest run`. `test:artifacts`
  // (`package.json`) is the sequenced substitute: it runs the writer, then the
  // reader, in that order, as two separate Vitest invocations. Skipping this
  // entry would let criterion 4 report PASS on a run that never verified a
  // single cartridge.
  artifacts: ['npm', ['run', 'test:artifacts']],
  build: ['npm', ['run', 'build']],
  dist: ['npm', ['run', 'test:dist']],
}

const CRITERIA = [
  {
    n: 1,
    name: 'Capability table matches corpus-tested support',
    checks: ['typecheck', 'tests'],
  },
  {
    n: 2,
    name: 'Keyboard, focus, progress, cancellation, error recovery',
    checks: ['tests'],
    manual: 'Firefox and screen reader',
  },
  { n: 3, name: 'Hostile documents, URLs, archives, credentials', checks: ['tests'] },
  {
    n: 4,
    name: 'Cartridges unzip; manifests, bytes, assets, determinism',
    // `artifacts` is what actually exercises a cartridge; `tests` alone would
    // report PASS here even on a tree where `test:artifacts` was never run,
    // because that file is excluded from the default `unit` project (see the
    // comment on `RUN.artifacts` above).
    checks: ['tests', 'artifacts'],
  },
  { n: 5, name: 'Documentation states its obligations', checks: ['tests'] },
  { n: 6, name: 'Dependency notices complete', checks: ['tests'] },
  {
    n: 7,
    name: 'Production build and artifact',
    checks: ['build', 'dist'],
    manual: 'Live Canvas acceptance',
  },
]

/** The most recent recorded run, or undefined when nobody has run it. */
function lastRecordedRun() {
  const record = readFileSync(new URL('../docs/RELEASE-ACCEPTANCE.md', import.meta.url), 'utf8')
  // Rows look like `| 2026-08-29 | operator | pass |`. The newest date wins.
  const dates = [...record.matchAll(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|/gm)].map((m) => m[1])
  return dates.sort().at(-1)
}

function main() {
  const results = new Map()
  for (const [name, [command, args]] of Object.entries(RUN)) {
    process.stderr.write(`running ${name}...\n`)
    try {
      execFileSync(command, args, { stdio: 'inherit' })
      results.set(name, true)
    } catch {
      results.set(name, false)
    }
  }

  const recorded = lastRecordedRun()
  let failed = false
  console.log('\nRelease criteria\n')
  for (const criterion of CRITERIA) {
    const enforcedOk = criterion.checks.every((check) => results.get(check))
    if (!enforcedOk) failed = true
    const enforced = enforcedOk ? 'PASS' : 'FAIL'
    const manual = criterion.manual
      ? `  MANUAL: ${criterion.manual} — ${recorded ? `last recorded ${recorded}` : 'NEVER RUN'}`
      : ''
    console.log(`  ${criterion.n}. [${enforced}] ${criterion.name}${manual}`)
  }

  /*
   * Enforced failures fail the gate. A missing MANUAL record does NOT — the gate
   * reports, and the human decides whether an unrecorded manual check blocks
   * this particular release. A gate that blocked on it would be run with
   * `--force` within a week, and then it would be blocking on nothing.
   */
  if (failed) {
    console.log('\nNOT RELEASABLE: an enforced check failed.')
    process.exitCode = 1
  } else {
    console.log(`\nEnforced checks pass.${recorded ? '' : ' Manual acceptance has NEVER been recorded.'}`)
  }
}

main()
