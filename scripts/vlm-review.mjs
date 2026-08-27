/**
 * Generate and validate the blinded human factual-review form for the VLM.
 *
 * Generate:
 *   npm run benchmark:vlm:review -- --report artifacts/vlm-report.json
 * Validate the downloaded form response:
 *   npm run benchmark:vlm:review -- --validate artifacts/vlm-ratings.json \
 *     --key artifacts/vlm-review-key.json --report artifacts/vlm-report.json
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VLM_FIXTURES } from './vlm-fixtures.mjs'
import { fitCanvasAltText } from './fit-canvas-alt-text.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;')

function argument(name, fallback) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? fallback : fallback
}

function shuffle(items, seed = 20260827) {
  const copy = [...items]
  let state = seed >>> 0
  const random = () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0x100000000
  }
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    ;[copy[index], copy[swap]] = [copy[swap], copy[index]]
  }
  return copy
}

function fixtureDataUrl(fixture) {
  return `data:image/svg+xml;base64,${Buffer.from(fixture.svg, 'utf8').toString('base64')}`
}

function reviewCard(item, index) {
  const rawDraft = item.result?.rawDraft ?? item.result?.draft ?? ''
  const draft = fitCanvasAltText(item.result?.draft ?? '')
  const draftLength = draft.length
  const facts = item.fixture.expectedFacts.map((fact) => `<li>${escapeHtml(fact)}</li>`).join('')
  return `<article class="card" data-token="${item.token}">
  <h2>Review item ${String(index + 1).padStart(2, '0')}</h2>
  <img src="${fixtureDataUrl(item.fixture)}" alt="Educational figure for review item ${String(index + 1).padStart(2, '0')}">
  <p><strong>Canvas-bound candidate (${draftLength}/120 characters)</strong></p>
  <pre>${escapeHtml(draft || '[No draft was recorded]')}</pre>
  <label>Factual coverage
    <select name="coverage" required>
      <option value="">Select…</option>
      <option value="0">0% — none of the important facts</option>
      <option value="25">25%</option>
      <option value="50">50%</option>
      <option value="75">75%</option>
      <option value="100">100% — all important facts</option>
    </select>
  </label>
  <label>Unsafe invention
    <select name="unsafeInvention" required>
      <option value="">Select…</option>
      <option value="false">No</option>
      <option value="true">Yes</option>
    </select>
  </label>
  <label>Reviewer notes (optional)<textarea name="notes" rows="3"></textarea></label>
  <details><summary>Reveal reference after rating</summary><p>${escapeHtml(item.fixture.referenceDescription)}</p><ul>${facts}</ul>${rawDraft && rawDraft !== draft ? `<p><small>Raw model output retained in the private report: ${rawDraft.length} characters.</small></p>` : ''}</details>
</article>`
}

function reviewHtml(items, report, keyPath) {
  const cards = items.map(reviewCard).join('\n')
  // Keep candidate identity out of the reviewer-visible document. The private
  // key file retains it for the release owner who validates the ratings.
  const metadata = JSON.stringify({ keyPath }).replaceAll('<', '\\u003c')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Blinded VLM factual review</title>
<style>
body{font:16px system-ui,sans-serif;line-height:1.45;max-width:980px;margin:2rem auto;padding:0 1rem;color:#172033}
.card{border:1px solid #9aa7b8;border-radius:8px;padding:1rem;margin:1.5rem 0}.card img{display:block;max-width:100%;height:auto;background:#fff;border:1px solid #d7dee8;margin:.75rem 0}.card pre{white-space:pre-wrap;background:#f3f6fa;padding:.75rem;border-left:4px solid #1769aa}.card label{display:block;margin:.75rem 0}.card select,.card textarea{display:block;width:100%;max-width:42rem;padding:.5rem;font:inherit}.actions{position:sticky;bottom:0;background:#fff;padding:1rem 0;border-top:1px solid #9aa7b8}.ok{color:#1769aa}.warn{color:#8a2942}
</style></head><body>
<main><h1>Blinded VLM factual review</h1>
<p>Review each draft against the figure before opening its reference. Do not edit the draft. Rate important-fact coverage and mark any unsafe invention. The model identity is intentionally omitted from this form.</p>
<p><strong>${items.length} items</strong>; the release target is at least 90% mean coverage and zero unsafe inventions.</p>
<form id="review">${cards}</form>
<div class="actions"><button type="button" id="download">Download ratings JSON</button> <span id="status" role="status"></span></div>
</main>
<script>
const metadata=${metadata};
const form=document.querySelector('#review');
const key='oer2canvas-vlm-review:'+metadata.keyPath;
for(const card of form.querySelectorAll('.card')){for(const field of card.querySelectorAll('select,textarea')){const saved=JSON.parse(localStorage.getItem(key)||'{}')[card.dataset.token]?.[field.name];if(saved!==undefined)field.value=saved;field.addEventListener('change',()=>document.querySelector('#status').textContent='Unsaved changes are kept in this browser.')}}
document.querySelector('#download').addEventListener('click',()=>{const ratings=[...form.querySelectorAll('.card')].map(card=>({fixtureToken:card.dataset.token,coverage:Number(card.querySelector('[name=coverage]').value),unsafeInvention:card.querySelector('[name=unsafeInvention]').value==='true',notes:card.querySelector('[name=notes]').value}));if(ratings.some(item=>!Number.isFinite(item.coverage))){document.querySelector('#status').textContent='Complete every rating before downloading.';return}const saved=Object.fromEntries([...form.querySelectorAll('.card')].map(card=>[card.dataset.token,Object.fromEntries([...card.querySelectorAll('select,textarea')].map(field=>[field.name,field.value]))]));localStorage.setItem(key,JSON.stringify(saved));const blob=new Blob([JSON.stringify({reviewedAt:new Date().toISOString(),ratings},null,2)],{type:'application/json'});const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download='vlm-ratings.json';link.click();URL.revokeObjectURL(link.href);document.querySelector('#status').textContent='Downloaded ratings JSON.'});
</script></body></html>`
}

async function generate() {
  const reportPath = resolve(argument('--report', 'artifacts/vlm-report.json'))
  const outputPath = resolve(argument('--output', 'artifacts/vlm-review.html'))
  const keyPath = resolve(argument('--key', 'artifacts/vlm-review-key.json'))
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  if (VLM_FIXTURES.length < 30) throw new Error(`fixture set has ${VLM_FIXTURES.length} entries; at least 30 are required`)
  const results = new Map((report.results ?? []).map((result) => [result.id, result]))
  const selected = shuffle(VLM_FIXTURES.slice(0, 30), Number(argument('--seed', '20260827')))
  const items = selected.map((fixture, index) => ({
    fixture,
    result: results.get(fixture.id),
    token: `review-item-${String(index + 1).padStart(2, '0')}`,
  }))
  const key = {
    generatedAt: new Date().toISOString(),
    report: reportPath,
    model: report.model ?? null,
    fixtures: items.map(({ fixture, token }) => ({ token, id: fixture.id, decorative: Boolean(fixture.decorative) })),
  }
  await mkdir(dirname(outputPath), { recursive: true })
  await mkdir(dirname(keyPath), { recursive: true })
  await writeFile(outputPath, reviewHtml(items, report, keyPath))
  await writeFile(keyPath, `${JSON.stringify(key, null, 2)}\n`)
  console.log(JSON.stringify({ status: 'review-form-ready', output: outputPath, key: keyPath, fixtureCount: items.length }, null, 2))
}

async function validate() {
  const ratingsPath = resolve(argument('--validate'))
  const keyPath = resolve(argument('--key', 'artifacts/vlm-review-key.json'))
  const reportPath = argument('--report')
  if (!ratingsPath) throw new Error('--validate requires a ratings JSON path')
  const ratings = JSON.parse(await readFile(ratingsPath, 'utf8'))
  const key = JSON.parse(await readFile(resolve(keyPath), 'utf8'))
  const expected = new Map(key.fixtures.map((fixture) => [fixture.token, fixture]))
  const rows = Array.isArray(ratings.ratings) ? ratings.ratings : []
  const validRows = rows.filter((row) => expected.has(row.fixtureToken))
  const duplicateCount = validRows.length - new Set(validRows.map((row) => row.fixtureToken)).size
  const missingCount = expected.size - new Set(validRows.map((row) => row.fixtureToken)).size
  const invalidCoverage = validRows.filter((row) => !Number.isFinite(row.coverage) || row.coverage < 0 || row.coverage > 100).length
  const unsafeCount = validRows.filter((row) => row.unsafeInvention === true).length
  const meanCoverage = validRows.length === 0 ? 0 : validRows.reduce((sum, row) => sum + Number(row.coverage), 0) / validRows.length
  let generation = null
  if (reportPath) {
    const report = JSON.parse(await readFile(resolve(reportPath), 'utf8'))
    const byId = new Map((report.results ?? []).map((result) => [result.id, result]))
    const nonDecorative = key.fixtures.filter((fixture) => !fixture.decorative)
    const successful = nonDecorative.filter((fixture) => byId.get(fixture.id)?.nonEmpty).length
    generation = { nonDecorative: nonDecorative.length, successful, nonEmptyRate: nonDecorative.length ? successful / nonDecorative.length : 0 }
  }
  const passed = rows.length === expected.size && missingCount === 0 && duplicateCount === 0 && invalidCoverage === 0 && unsafeCount === 0 && meanCoverage >= 90 && (generation === null || generation.nonEmptyRate >= 0.95)
  const result = { status: passed ? 'passed' : 'blocked', reviewed: validRows.length, expected: expected.size, meanCoverage: Math.round(meanCoverage * 10) / 10, unsafeCount, missingCount, duplicateCount, invalidCoverage, generation }
  console.log(JSON.stringify(result, null, 2))
  if (!passed) process.exitCode = 1
}

if (process.argv.includes('--validate')) validate().catch((error) => { console.error(`VLM review validation failed: ${error.message}`); process.exitCode = 1 })
else generate().catch((error) => { console.error(`VLM review generation failed: ${error.message}`); process.exitCode = 1 })
