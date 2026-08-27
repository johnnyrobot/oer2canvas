import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath, URL as NodeURL } from 'node:url'
import { describe, it, expect } from 'vitest'
import { compileSection } from './index'
import { fixtureContext, type FixtureName } from './fixture-context'

// `fileURLToPath(new URL(...))` rather than `import.meta.dirname`: this module
// goes through Vite's transform, and only `import.meta.url` is guaranteed there.
// The `URL` constructor is imported explicitly from `node:url` rather than
// relying on the global: this project's `unit` suite runs in jsdom, whose
// global `URL` resolves a relative path against `window.location`
// (`http://localhost:3000/`) instead of a `file:` base, silently producing
// the wrong href. Node's own `URL` resolves the `file:` base correctly.
const DIR = fileURLToPath(new NodeURL('./__goldens__/', import.meta.url))
const UPDATE = process.env.UPDATE_GOLDENS === '1'

/**
 * Golden files are committed and reviewed as a DIFF. That is the whole point:
 * a transform regression shows up as a legible change to real chapter html,
 * which is where it is actually recognisable. Regenerate with
 * `UPDATE_GOLDENS=1 npx vitest run --project unit src/engine/compile/golden.test.ts`
 * and READ the diff before committing it.
 *
 * Writing requires the flag, full stop — a missing file is NOT treated as
 * permission to create it. A lost golden (bad rebase, stray `rm`, a
 * `.gitignore` mistake) must fail loudly and name itself, not regenerate
 * silently and report green while pinning nothing.
 */
function golden(file: string, actual: string): void {
  const path = `${DIR}${file}`
  if (UPDATE) {
    writeFileSync(path, actual)
    return
  }
  if (!existsSync(path)) {
    throw new Error(`${file} is missing. Run UPDATE_GOLDENS=1 to create it — do not let this regenerate silently.`)
  }
  expect(actual, `${file} differs — read the diff, then UPDATE_GOLDENS=1 if it is correct`).toBe(
    readFileSync(path, 'utf8'),
  )
}

describe.each<FixtureName>(['page', 'page-section'])('compile %s', (name) => {
  const { section, ctx } = fixtureContext(name)
  const out = compileSection(section, ctx)

  it('compiles without error', () => {
    expect(out.error).toBeUndefined()
  })

  it('matches the html golden', () => {
    golden(`${name}.compiled.html`, `${out.html}\n`)
  })

  it('matches the notes golden', () => {
    golden(`${name}.notes.json`, `${JSON.stringify(out.notes, null, 2)}\n`)
  })

  it('matches the queue golden', () => {
    golden(`${name}.queue.json`, `${JSON.stringify(out.queue, null, 2)}\n`)
  })
})
