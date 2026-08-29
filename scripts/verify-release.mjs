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
  //
  // This is also why the criterion → check mapping below is COARSE: `tests` is
  // ONE invocation covering the whole suite, not one per criterion. A single
  // failing test anywhere makes every criterion that lists `tests` in its
  // `checks` report FAIL together, even though only one of them actually
  // regressed. That is a deliberate trade, not an oversight — separating it
  // would mean either running vitest once per criterion (missing tests outside
  // the mapped files, since criteria and test files are not 1:1) or running the
  // whole suite once per criterion on top of this run (paying full suite wall
  // time six more times for attribution the printed check name already gives
  // for free). The gate's stated purpose is to reveal a criterion with NO CHECK
  // AT ALL — a coarse but present mapping still does that; only the per-row
  // check name below (and the "Failed checks" summary) makes the coarseness
  // legible instead of silently reading as six independent breakages.
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
  // The set of check NAMES that actually failed, in `RUN` order. Distinct
  // failed checks, not failed criteria — this is what tells a reader "one
  // thing broke" instead of letting six FAIL rows read as six breakages.
  const failedChecks = Object.keys(RUN).filter((name) => results.get(name) === false)
  let failed = false
  console.log('\nRelease criteria\n')
  for (const criterion of CRITERIA) {
    // Which of THIS criterion's checks failed, so a FAIL row names its cause
    // instead of leaving a reader to guess whether it shares a cause with the
    // other FAIL rows below it.
    const failingChecks = criterion.checks.filter((check) => results.get(check) === false)
    const enforcedOk = failingChecks.length === 0
    if (!enforcedOk) failed = true
    const enforced = enforcedOk ? 'PASS' : `FAIL: ${failingChecks.join(', ')}`
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
    // Named once, plainly, so "six FAIL rows" reads as "one broken check shared
    // by six criteria" rather than six independent breakages. `tests` in
    // particular is a single suite-wide run (see the comment on `RUN.tests`),
    // so seeing it listed once here — however many criteria cite it above —
    // is the correct count of things that actually broke.
    console.log(`\nFailed checks: ${failedChecks.join(', ')}`)
    console.log(
      'Several criteria share one test run: a single failing test marks every criterion whose ' +
        'checks include it, not just the one it actually belongs to. The check name on each row ' +
        "and the list above are the count of things that actually broke.",
    )
    console.log('\nNOT RELEASABLE: an enforced check failed.')
    process.exitCode = 1
  } else {
    console.log(`\nEnforced checks pass.${recorded ? '' : ' Manual acceptance has NEVER been recorded.'}`)
  }
}

main()
