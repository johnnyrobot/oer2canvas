/**
 * Prints, in order, everything a screen reader reaches on the document-import
 * path — so `docs/RELEASE-ACCEPTANCE.md` §3 is a CONFIRMATION rather than an
 * exploration.
 *
 * This does NOT run or replace the §3 check, and running it records nothing.
 * §3 asks whether an announcement COMMUNICATES anything, and no tool can
 * answer that: an unlabeled control, a status update with no context, or a
 * heading level that contradicts what is on screen all appear here as
 * perfectly ordinary rows. Only a human listening catches those. What this
 * removes is the part that is not judgement — finding the controls, and
 * knowing what the live regions actually said.
 *
 * Usage, against a running dev server:
 *   node scripts/screen-reader-worksheet.mjs [origin]
 */
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'
import { semanticDocxFixture } from '../src/import/testing/docx-fixture.ts'

const origin = (process.argv[2] || 'http://localhost:5199').replace(/\/$/, '')
const fixture = '/tmp/screen-reader-worksheet.docx'

const out = []
const say = (line = '') => { out.push(line); console.log(line) }
const section = (n, title) => { say(); say(`${'='.repeat(72)}`); say(`STEP ${n} — ${title}`); say('='.repeat(72)) }

/** Every element a screen reader would stop on, in DOM order, with its accessible name. */
async function announce(page, scope) {
  const root = scope ? page.locator(scope) : page.locator('body')
  const rows = await root.evaluate((node) => {
    const interesting = 'h1,h2,h3,h4,h5,h6,[role=heading],button,a[href],input,select,textarea,[role=alert],[role=status],[role=tab],[role=radio],[role=checkbox],table,figure,img,[aria-live]'
    const seen = []
    for (const el of node.querySelectorAll(interesting)) {
      if (el.closest('[aria-hidden="true"]')) continue
      const style = getComputedStyle(el)
      if (style.display === 'none' || style.visibility === 'hidden') continue
      const tag = el.tagName.toLowerCase()
      const role = el.getAttribute('role') || (/^h[1-6]$/.test(tag) ? `heading level ${tag[1]}` : tag)
      let name = el.getAttribute('aria-label') || ''
      if (!name && el.id) {
        const lab = node.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`)
        if (lab) name = lab.textContent || ''
      }
      if (!name && el.closest('label')) name = el.closest('label').textContent || ''
      if (!name) name = el.getAttribute('alt') ?? el.textContent ?? ''
      name = name.trim().replace(/\s+/g, ' ').slice(0, 110)
      const described = el.getAttribute('aria-describedby')
      let desc = ''
      if (described) {
        desc = described.split(/\s+/).map((id) => node.ownerDocument.getElementById(id)?.textContent || '')
          .join(' ').trim().replace(/\s+/g, ' ').slice(0, 110)
      }
      const state = []
      if (el.disabled) state.push('disabled')
      if (el.getAttribute('aria-selected') === 'true') state.push('selected')
      if (el.checked) state.push('checked')
      if (el.getAttribute('aria-live')) state.push(`live=${el.getAttribute('aria-live')}`)
      if (!name && !['input','select','textarea','img'].includes(tag)) continue
      seen.push({ role, name, desc, state: state.join(',') })
    }
    return seen
  })
  for (const r of rows) {
    const bits = [`  ${r.role.padEnd(18)} ${r.name || '*** NO ACCESSIBLE NAME ***'}`]
    if (r.state) bits.push(`      state: ${r.state}`)
    if (r.desc) bits.push(`      described-by: ${r.desc}`)
    say(bits.join('\n'))
  }
}

const bytes = await semanticDocxFixture({ embeddedImage: true, noAltCarrier: true, additionalParagraphs: 40 })
writeFileSync(fixture, bytes)

const browser = await chromium.launch()
const page = await (await browser.newContext({ serviceWorkers: 'block' })).newPage()
await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded' })

section(0, 'Landing — choosing a destination')
await announce(page)

await page.getByRole('button', { name: /A cartridge file/i }).click()
await page.getByRole('tab', { name: 'Document' }).click()
const form = page.locator('form').filter({ has: page.locator('input[type=file]') })
await form.locator('input[type=file]').waitFor()

section(1, 'Document import form (§3 step 2: file, rights question, submit)')
await announce(page, 'form')

await form.locator('input[type=file]').setInputFiles(fixture)
await page.getByLabel('Document title').fill('Screen reader worksheet')
await form.locator('input[type=radio]').first().check()
await form.locator('input[type=checkbox]').first().check()

say()
say('  -- after choosing a file, the limitation text that appears under the input --')
await announce(page, '#document-file-limitations')

// Capture the live region across the whole run, which is what §3 step 2 is about.
const phases = []
const poll = setInterval(async () => {
  try {
    if (!(await form.count())) return
    const t = (await form.locator('[role=status]').textContent() || '').trim()
    if (t && phases[phases.length - 1] !== t) phases.push(t)
  } catch {}
}, 30)
await page.getByRole('button', { name: 'Inspect document' }).click()
await page.waitForTimeout(9000)
clearInterval(poll)

say()
say('  -- what the aria-live="polite" status region announced, in order --')
phases.forEach((p, i) => say(`  ${i + 1}. "${p}"`))
say('  (§3 asks whether these are comprehensible WITHOUT sight of the screen.)')

// §3 steps 3 and 4 are ONE screen: the findings panel and the proposed pages
// render together, so this dumps it once rather than printing it twice under
// two headings and implying a navigation that does not happen.
section(2, 'Findings panel AND page plan — one screen (§3 steps 3-4)')
await announce(page, 'main')

say()
say('='.repeat(72))
say('NOT COVERED HERE, and the reason §3 stays a human check:')
say('  - whether any announcement above actually communicates its meaning')
say('  - whether heading levels match the visual structure')
say('  - RELEASE-ACCEPTANCE §0: a deck refused for an unpackageable image lands')
say('    in the plan editor with a disabled Prepare button, while a deck refused')
say('    by the reconciler throws back to the file picker. Two screens for "this')
say('    file cannot be imported", explained to the user nowhere. Listen for it.')
say('='.repeat(72))

await browser.close()
writeFileSync('/tmp/screen-reader-worksheet.txt', out.join('\n'))
console.log('\nworksheet written to /tmp/screen-reader-worksheet.txt')
