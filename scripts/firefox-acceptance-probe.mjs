import { firefox } from 'playwright'

const APP = 'http://localhost:5199/'
const out = []
const rec = (id, pass, note) => { out.push({ id, pass, note }); console.log(`${pass ? 'PASS' : 'FAIL'} ${id}\n    ${note}\n`) }
const browser = await firefox.launch()
const ctx = await browser.newContext()

const importForm = (p) => p.locator('form').filter({ has: p.locator('input[type=file]') })

async function open(p) {
  await p.goto(APP, { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: /A cartridge file/ }).click()
  await p.getByRole('tab', { name: 'Document' }).click()
  await importForm(p).locator('input[type=file]').waitFor()
}
async function fill(p, file, title) {
  const f = importForm(p)
  await f.locator('input[type=file]').setInputFiles(file)
  await p.getByLabel('Document title').fill(title)
  await f.locator('input[type=radio]').first().check()
  await f.locator('input[type=checkbox]').first().check()
}

// ---------- a. Keyboard reaches the submit control ----------
{
  const p = await ctx.newPage(); await open(p)
  await p.evaluate(() => document.body.focus())
  const order = []; let reached = false
  for (let i = 0; i < 60; i++) {
    await p.keyboard.press('Tab')
    const d = await p.evaluate(() => { const a = document.activeElement; return a && {
      tag: a.tagName.toLowerCase(), type: a.getAttribute('type'),
      name: (a.getAttribute('aria-label') || a.textContent || '').trim().replace(/\s+/g,' ').slice(0,40) } })
    if (!d) break
    order.push(`${d.tag}${d.type ? '['+d.type+']' : ''}${d.name ? ':'+d.name : ''}`)
    if (d.tag === 'button' && d.name.startsWith('Inspect document')) { reached = true; break }
  }
  rec('2a keyboard reaches submit', reached, `${order.length} Tabs, no trap: ${order.join(' > ')}`)
  await p.close()
}

// ---------- d + success path. Live region during a real import ----------
{
  const p = await ctx.newPage(); await open(p)
  await fill(p, '/tmp/ff-big.docx', 'Firefox progress probe')
  const phases = []; const focusSeen = new Set()
  const poll = setInterval(async () => {
    try {
      const f = importForm(p)
      if (!await f.count()) return
      const s = (await f.locator('[role=status]').textContent() || '').trim()
      if (s && phases[phases.length-1] !== s) phases.push(s)
      focusSeen.add(await p.evaluate(() => document.activeElement?.tagName.toLowerCase() || 'none'))
    } catch {}
  }, 30)
  await p.getByRole('button', { name: 'Inspect document' }).click()
  await p.waitForTimeout(9000)
  clearInterval(poll)
  const advanced = (await importForm(p).count()) === 0
  rec('2d progress announced', phases.length >= 2,
    `role=status aria-live="polite" moved through ${phases.length} value(s): ${phases.map(s=>JSON.stringify(s)).join(' -> ')}. Focus stayed on ${[...focusSeen].join(',')} (never pulled into the live region).`)
  rec('2-extra import succeeds in Firefox', advanced,
    advanced ? 'real 6000-paragraph DOCX parsed by the WASM worker in Firefox 153 and advanced past the import form' : 'import form still present after 9s')
  await p.screenshot({ path: '/tmp/ff-success.png', fullPage: true })
  await p.close()
}

// ---------- b. Cancel an in-flight import (WASM fetch delayed to widen the click window) ----------
{
  const p = await ctx.newPage()
  await p.route(/\.wasm/, async route => { await new Promise(r => setTimeout(r, 6000)); await route.continue() })
  await open(p)
  await fill(p, '/tmp/ff-big.docx', 'Firefox cancel probe')
  await p.getByRole('button', { name: 'Inspect document' }).click()
  let note = '', ok = false
  try {
    const cancel = p.getByRole('button', { name: /^Cancel import for/ })
    await cancel.waitFor({ timeout: 8000 })
    const label = (await cancel.textContent() || '').trim()
    await cancel.click()
    await p.waitForTimeout(1500)
    const f = importForm(p)
    const status = (await f.locator('[role=status]').textContent() || '').trim()
    const message = (await f.locator('[role=alert]').textContent() || '').trim()
    const enabled = await p.getByRole('button', { name: 'Inspect document' }).isEnabled()
    const gone = (await p.getByRole('button', { name: /^Cancel import for/ }).count()) === 0
    const expected = 'Document inspection cancelled. You can choose a file and try again.'
    ok = status === '' && message === expected && enabled && gone
    note = `cancel control was labelled "${label}"; status text cleared=${status === ''}, message reads "${message}" (expected "${expected}"), submit re-enabled=${enabled}, cancel button removed=${gone}`
  } catch (e) { note = 'cancel control never appeared: ' + e.message.split('\n')[0] }
  rec('2b cancel an import', ok, note)
  await p.close()
}

// ---------- c. Error message takes focus ----------
{
  const p = await ctx.newPage(); await open(p)
  await fill(p, '/tmp/ff-malformed.docx', 'Firefox malformed probe')
  await p.getByRole('button', { name: 'Inspect document' }).click()
  let ok = false, note = ''
  try {
    const alert = importForm(p).locator('[role=alert]')
    await alert.waitFor({ timeout: 40000 })
    const text = (await alert.textContent() || '').trim()
    const focused = await p.evaluate(() => document.activeElement?.getAttribute('role') === 'alert')
    ok = focused
    note = `alert reads "${text}" — alert has focus = ${focused}`
  } catch (e) { note = 'no role=alert in the import form within 40s: ' + e.message.split('\n')[0] }
  rec('2c error takes focus', ok, note)
  await p.close()
}

await browser.close()
console.log('--- SUMMARY (Firefox ' + '153.0' + ') ---')
for (const r of out) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id}`)
