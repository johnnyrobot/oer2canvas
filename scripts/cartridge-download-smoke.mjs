/**
 * Smoke: drive the LIVE production site through a two-chapter prepare and
 * download the cartridge, logging each step to /tmp/cart/run.log. Run by
 * hand (`node scripts/cartridge-download-smoke.mjs`); needs `playwright`
 * with Chromium installed and a network path to the public origin.
 */
import { chromium } from 'playwright'
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs'
mkdirSync('/tmp/cart', { recursive: true })
const LOG = '/tmp/cart/run.log'
writeFileSync(LOG, '')
const say = (m) => appendFileSync(LOG, m + '\n')
try {
  const b = await chromium.launch()
  const p = await (await b.newContext({ acceptDownloads: true })).newPage()
  await p.goto('https://oer2canvas.johnnyrobot.dev/', { waitUntil: 'networkidle' })
  await p.getByRole('button', { name: /A cartridge file/i }).click()
  await p.getByRole('button', { name: /^Content/ }).click()
  const book = p.getByRole('button', { name: /^Business Law I Essentials$/ })
  await book.waitFor({ timeout: 60000 }); await book.click()
  say('picked book')
  const boxes = p.getByRole('checkbox')
  await boxes.first().waitFor({ timeout: 120000 })
  say('chapters offered: ' + await boxes.count())
  await boxes.nth(0).check()
  if (await boxes.count() > 1) await boxes.nth(1).check()
  const prepare = p.getByRole('button', { name: /^Prepare \d+ chapter/ })
  await prepare.waitFor({ timeout: 60000 })
  say('clicking: ' + (await prepare.textContent())?.trim())
  await prepare.click()
  // Preparing lands on Review; the cartridge download lives on Plan.
  const plan = p.getByRole('button', { name: /^Plan(?![a-z])/ })
  await plan.waitFor({ timeout: 300000 })
  for (let i = 0; i < 60; i++) {
    if (await plan.isEnabled()) break
    await p.waitForTimeout(5000)
  }
  say('plan enabled, clicking it')
  await plan.click()
  const dl = p.getByRole('button', { name: /Download cartridge/ })
  await dl.waitFor({ timeout: 180000 })
  say('download button: ' + (await dl.textContent())?.trim())
  const [d] = await Promise.all([p.waitForEvent('download', { timeout: 120000 }), dl.click()])
  await d.saveAs('/tmp/cart/cartridge.imscc')
  say('SAVED')
  await b.close()
} catch (e) { say('FAILED: ' + String(e).split('\n')[0]) }
