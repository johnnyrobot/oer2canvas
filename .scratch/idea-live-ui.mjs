import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
const KEY = process.env.GEMINI_API_KEY
if (!KEY) throw new Error('no key in env')
mkdirSync('/tmp/idea-ui', { recursive: true })
const say = (m) => console.log(m)
const b = await chromium.launch()
const ctx = await b.newContext()
const p = await ctx.newPage()
// Network audit: where did the key go?
const audit = { toRelay: 0, toGoogle: 0, keyInUrl: 0, keyInBody: 0, keyInAuthHeaderOnly: 0, keyElsewhere: 0 }
p.on('pageerror', (e) => say('pageerror: ' + String(e).slice(0, 200)))
p.on('request', (r) => {
  const url = r.url()
  if (url.includes('/relay')) audit.toRelay++
  if (url.includes(KEY)) audit.keyInUrl++
  if ((r.postData() ?? '').includes(KEY)) audit.keyInBody++
  if (url.startsWith('https://generativelanguage.googleapis.com/')) {
    audit.toGoogle++
    const h = r.headers()
    const auth = h['authorization'] === `Bearer ${KEY}`
    const others = Object.entries(h).some(([k, v]) => k !== 'authorization' && v.includes(KEY))
    if (auth && !others) audit.keyInAuthHeaderOnly++
    if (others) audit.keyElsewhere++
  } else if (Object.values(r.headers()).some((v) => v.includes(KEY))) audit.keyElsewhere++
})

async function prepareChapter() {
  await p.getByRole('button', { name: /A cartridge file/i }).click()
  await p.getByRole('button', { name: /^Content/ }).click()
  await p.getByRole('tab', { name: 'Text / Markdown / HTML' }).click()
  await p.getByRole('radio', { name: 'HTML', exact: true }).check()
  await p.getByLabel('Content to import').fill('<h1>Nutrients</h1><h2>Committee</h2><p>The chairman of the committee, John Smith, asked the men to review the data. Bob and Tom compared notes with Mary.</p><p>A study by Watson and Crick (1953) is cited throughout; Rosalind Franklin\'s contribution is not mentioned.</p>')
  await p.getByLabel('Document title').fill('4: Nutrition')
  await p.getByLabel('Author or organization').fill('Test')
  await p.getByRole('radio', { name: 'I created or own this content' }).check()
  await p.getByRole('checkbox', { name: /I am responsible/ }).check()
  await p.getByRole('button', { name: 'Create page plan' }).click()
  const prepare = p.getByRole('button', { name: /^Prepare \d+ page/ })
  await prepare.waitFor({ timeout: 60000 }); await prepare.click()
  const idea = p.getByRole('button', { name: /^IDEA(?![a-z])/ })
  await idea.waitFor({ timeout: 120000 })
  for (let i = 0; i < 60 && !(await idea.isEnabled()); i++) await p.waitForTimeout(2000)
  await idea.click()
}
try {
  await p.goto('http://localhost:5199/', { waitUntil: 'networkidle' })
  await prepareChapter()
  say('1. on IDEA')

  // §7.1 settings, save, reload
  await p.getByRole('combobox', { name: 'Provider' }).selectOption('gemini')
  await p.getByLabel('API key').fill(KEY)
  await p.getByRole('button', { name: 'Save on this device' }).click()
  await p.waitForTimeout(500)
  await p.reload({ waitUntil: 'networkidle' })
  // After reload the app is back at the start; prepared output is not persisted, but the key is.
  await prepareChapter()
  const keyField = p.getByLabel('API key')
  say(`2. after reload: provider=${await p.getByRole('combobox', { name: 'Provider' }).inputValue()} keyType=${await keyField.getAttribute('type')} keyRemembered=${(await keyField.inputValue()) === KEY} forgetKeyOffered=${await p.getByRole('button', { name: 'Forget key' }).isVisible()}`)
  say(`   ollama option disabled=${await p.getByRole('option', { name: /Ollama Cloud/ }).evaluate((o) => o.disabled)} label="${await p.getByRole('option', { name: /Ollama Cloud/ }).textContent()}" measuredLink=${await p.getByRole('link', { name: /measured/ }).getAttribute('href')}`)

  // §7.2 send 7.2
  await p.getByRole('button', { name: /^7\.2 / }).click()
  const send = p.getByRole('button', { name: 'Send this section to Gemini' })
  const disclosure = p.getByText(/What leaves your browser/).first()
  const above = await p.evaluate(([d, s]) => !!(d.compareDocumentPosition(s) & Node.DOCUMENT_POSITION_FOLLOWING), [await disclosure.elementHandle(), await send.elementHandle()])
  say(`3. disclosure above button=${above}; requests to google before click=${audit.toGoogle}`)
  await send.click()
  await p.getByText(/Waiting for Gemini/).first().waitFor({ timeout: 5000 })
  say('   status line: Waiting for Gemini…')
  await p.getByText(/Waiting for Gemini/).first().waitFor({ state: 'detached', timeout: 90000 })
  const draftRows = p.locator('.b2c-idea-draft')
  const draftChips = await p.getByText('draft', { exact: true }).count()
  say(`4. drafts rendered=${await draftRows.count()} draft chips=${draftChips} replaceButtons=${await p.getByRole('button', { name: 'Replace' }).count()} ideaErrors=${await p.getByText(/^The provider /).count()}`)
  await p.screenshot({ path: '/tmp/idea-ui/72-drafts.png', fullPage: true })

  // §7.4 rubric draft
  await p.getByRole('button', { name: 'Draft a Rubric 1 review with Gemini' }).click()
  await p.getByText(/Waiting for Gemini/).first().waitFor({ state: 'detached', timeout: 120000 })
  const draftLines = await p.getByText(/^Model draft:/).count()
  const checked = await p.locator('[role=radiogroup] input[type=radio]:checked').count()
  await p.getByRole('button', { name: /^7\.1 / }).click()
  const lines71 = await p.getByText(/^Model draft:/).count()
  const useNote = p.getByRole('button', { name: 'Use this note' })
  say(`5. rubric: 'Model draft:' lines on 7.2=${draftLines}, on 7.1=${lines71}; radios checked=${checked}; Use this note=${await useNote.count()}; use-this-rating buttons=${await p.getByRole('button', { name: /use this rating/i }).count()}`)
  await useNote.first().click()
  const notes = await p.getByRole('textbox', { name: 'Notes' }).first().inputValue()
  say(`   Use this note filled Notes=${notes.length > 0}; radios checked after=${await p.locator('[role=radiogroup] input[type=radio]:checked').count()}`)
  await p.screenshot({ path: '/tmp/idea-ui/71-rubric-draft.png', fullPage: true })

  // §7.5 wrong key
  await keyField.fill('AIza-wrong-key-000')
  await p.getByRole('button', { name: 'Save on this device' }).click()
  await p.getByRole('button', { name: /^7\.2 / }).click()
  await p.getByRole('button', { name: 'Send this section to Gemini' }).click()
  const err = p.getByText(/^The provider /)
  await err.first().waitFor({ timeout: 30000 })
  say(`6. wrong key message: "${(await err.first().textContent())?.trim()}"`)
  say(`   key text on screen=${(await p.locator('body').textContent()).includes(KEY)}`)

  // §7.6 forget key, reload
  await p.getByRole('button', { name: 'Forget key' }).click()
  await p.waitForTimeout(300)
  const idb = await p.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('oer2canvas'); r.onsuccess = () => { const db = r.result; const names = [...db.objectStoreNames]; const tx = db.transaction(names[0]); const req = tx.objectStore(names[0]).getAllKeys(); req.onsuccess = () => res(req.result.map(String)) }
  }))
  say(`7. after Forget key: IndexedDB keys=${JSON.stringify(idb)}`)
  say(`8. network audit: ${JSON.stringify(audit)}`)
} catch (e) { say('FAILED: ' + String(e).split('\n')[0]); await p.screenshot({ path: '/tmp/idea-ui/failed.png', fullPage: true }) }
await b.close()
