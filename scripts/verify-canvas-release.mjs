/**
 * Reversible live release verification against a dedicated Canvas sandbox.
 *
 * Required:
 *   CANVAS_BASE_URL=https://canvas.example.edu
 *   CANVAS_TOKEN=<an administrator token used only for setup and cleanup>
 *   CANVAS_TEST_COURSE_ID=123
 *
 *   SELF_HOSTED_APP_ORIGIN=https://oer2canvas.example.edu
 *
 * Safety properties:
 *   - refuses a course whose name does not contain "test" or "sandbox";
 *   - snapshots the course and removes only pages absent from that snapshot;
 *   - creates a one-hour token, requests the minimum URL scopes, and proves
 *     whether this Canvas instance actually enforces them without printing it;
 *   - removes any temporary enrollment and revokes the token in `finally`.
 *
 * The administrator token never enters the browser or the self-hosted relay.
 */
import { chromium } from 'playwright'

const canvasBase = required('CANVAS_BASE_URL').replace(/\/$/, '')
const adminToken = required('CANVAS_TOKEN')
const courseId = Number(required('CANVAS_TEST_COURSE_ID'))
const appOrigin = required('SELF_HOSTED_APP_ORIGIN').replace(/\/$/, '')

if (!Number.isSafeInteger(courseId) || courseId <= 0) {
  throw new Error('CANVAS_TEST_COURSE_ID must be a positive integer')
}

const SCOPES = [
  'url:GET|/api/v1/users/self',
  'url:GET|/api/v1/courses',
  'url:GET|/api/v1/courses/:course_id/pages',
  'url:GET|/api/v1/courses/:course_id/pages/:url',
  'url:POST|/api/v1/courses/:course_id/pages',
  'url:PUT|/api/v1/courses/:course_id/pages/:url',
]

const SANITIZER_BODY = `
  <h2>Canvas sanitizer accessibility fixture</h2>
  <p>The quadratic relation follows.</p>
  <math xmlns="http://www.w3.org/1998/Math/MathML" aria-label="x squared equals four">
    <semantics>
      <mrow><msup><mi>x</mi><mn>2</mn></msup><mo>=</mo><mn>4</mn></mrow>
      <annotation-xml encoding="application/xhtml+xml"><span>x squared equals four</span></annotation-xml>
    </semantics>
  </math>
  <table>
    <caption>Enrollment by section</caption>
    <thead><tr><th scope="col">Section</th><th scope="col">Students</th></tr></thead>
    <tbody><tr><th scope="row">A</th><td>24</td></tr></tbody>
  </table>
  <figure>
    <img src="https://example.com/oer2canvas-release-figure.png" alt="Test graph: a line rises from left to right">
    <figcaption>A rising linear relationship.</figcaption>
  </figure>
  <p><a href="https://openstax.org/" rel="noreferrer">Open the cited source</a>.</p>
  <aside class="b2c-attribution">Attribution: release fixture, CC BY 4.0.</aside>
`

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function canvas(path, { token = adminToken, method = 'GET', json, form } = {}) {
  const headers = { authorization: `Bearer ${token}` }
  let body
  if (json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(json)
  } else if (form !== undefined) {
    headers['content-type'] = 'application/x-www-form-urlencoded'
    body = form.toString()
  }
  const response = await fetch(`${canvasBase}${path}`, { method, headers, ...(body ? { body } : {}) })
  return response
}

async function expectJson(path, options, label = path) {
  const response = await canvas(path, options)
  const text = await response.text()
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}: ${text.slice(0, 400)}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label}: Canvas returned non-JSON content`)
  }
}

async function listPages(token = adminToken) {
  return expectJson(`/api/v1/courses/${courseId}/pages?per_page=100`, { token }, 'list sandbox pages')
}

async function createScopedToken() {
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString()
  const form = new URLSearchParams({
    'token[purpose]': `oer2canvas release verification ${new Date().toISOString()}`,
    'token[expires_at]': expires,
  })
  for (const scope of SCOPES) form.append('token[scopes][]', scope)
  const created = await expectJson('/api/v1/users/self/tokens', { method: 'POST', form }, 'create scoped token')
  if (!created.id || !created.visible_token) throw new Error('Canvas did not return a visible scoped token')
  return { id: created.id, token: created.visible_token }
}

async function ensureTeacherEnrollment(userId) {
  const enrollments = await expectJson(
    `/api/v1/courses/${courseId}/enrollments?per_page=100`,
    {},
    'list sandbox enrollments',
  )
  const existing = enrollments.find(
    (enrollment) => enrollment.user_id === userId &&
      ['TeacherEnrollment', 'TaEnrollment', 'DesignerEnrollment'].includes(enrollment.type) &&
      enrollment.enrollment_state === 'active',
  )
  if (existing) return undefined

  const form = new URLSearchParams({
    'enrollment[user_id]': String(userId),
    'enrollment[type]': 'TeacherEnrollment',
    'enrollment[enrollment_state]': 'active',
  })
  const created = await expectJson(
    `/api/v1/courses/${courseId}/enrollments`,
    { method: 'POST', form },
    'create temporary teacher enrollment',
  )
  if (!created.id) throw new Error('Canvas did not return the temporary enrollment id')
  return created.id
}

async function verifyScopedAccess(scopedToken, courseName) {
  const self = await expectJson('/api/v1/users/self', { token: scopedToken }, 'verify scoped identity')
  const courses = await expectJson(
    '/api/v1/courses?enrollment_state=active&include[]=term&per_page=100',
    { token: scopedToken },
    'verify scoped course listing',
  )
  if (!courses.some((course) => course.id === courseId)) {
    throw new Error(`scoped token could not see ${courseName}`)
  }

  const forbidden = await canvas('/api/v1/accounts/self/courses?per_page=1', { token: scopedToken })
  // Canvas documents that manually generated scopes are ignored when the
  // instance's default developer key does not have “enable scopes” switched on.
  // Report that configuration as evidence instead of claiming a token is
  // least-privilege merely because its metadata contains a scope list.
  const scopesEnforced = !forbidden.ok

  const relayTarget = encodeURIComponent(`${canvasBase}/api/v1/users/self`)
  const throughRelay = await fetch(`${appOrigin}/relay?url=${relayTarget}`, {
    headers: { authorization: `Bearer ${scopedToken}` },
  })
  if (!throughRelay.ok) throw new Error(`self-hosted relay identity check: HTTP ${throughRelay.status}`)
  const relayedSelf = await throughRelay.json()
  if (relayedSelf.id !== self.id) throw new Error('self-hosted relay returned a different Canvas identity')
  return { scopesEnforced }
}

async function verifySanitizer(scopedToken, createdUrls) {
  const title = `oer2canvas sanitizer fixture ${Date.now()}`
  const created = await expectJson(
    `/api/v1/courses/${courseId}/pages`,
    {
      token: scopedToken,
      method: 'POST',
      json: { wiki_page: { title, body: SANITIZER_BODY, published: true } },
    },
    'create sanitizer fixture',
  )
  if (!created.url) throw new Error('Canvas did not return the sanitizer fixture URL')
  createdUrls.add(created.url)

  const stored = await expectJson(
    `/api/v1/courses/${courseId}/pages/${encodeURIComponent(created.url)}`,
    { token: scopedToken },
    'read sanitized fixture',
  )
  const body = stored.body ?? ''
  const checks = [
    ['MathML', /<math\b/i],
    ['MathML semantics', /<semantics\b/i],
    ['MathML annotation', /<annotation-xml\b/i],
    ['table', /<table\b/i],
    ['column header scope', /<th\b[^>]*scope=(?:"col"|'col')/i],
    ['figure', /<figure\b/i],
    ['figure caption', /<figcaption\b/i],
    ['image alternative', /alt=(?:"Test graph: a line rises from left to right"|'Test graph: a line rises from left to right')/i],
    ['link', /<a\b[^>]*href=(?:"https:\/\/openstax\.org\/?"|'https:\/\/openstax\.org\/?')/i],
    ['attribution', /Attribution: release fixture, CC BY 4\.0\./i],
  ]
  for (const [label, pattern] of checks) {
    if (!pattern.test(body)) throw new Error(`Canvas sanitizer removed or changed the fixture's ${label}`)
  }

  const browser = await chromium.launch()
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const page = await context.newPage()
    await page.route('**/*', (route) => route.abort())
    await page.setContent(`<!doctype html><html lang="en"><title>Sanitized Canvas fixture</title><body>${body}</body></html>`)

    await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      text: document.activeElement?.textContent?.trim(),
    }))
    if (focused.tag !== 'A' || focused.text !== 'Open the cited source') {
      throw new Error(`keyboard check did not reach the sanitized link (focused ${focused.tag ?? 'nothing'})`)
    }

    const cdp = await context.newCDPSession(page)
    const { nodes } = await cdp.send('Accessibility.getFullAXTree')
    const hasRole = (role) => nodes.some((node) => node.role?.value === role)
    const hasName = (name) => nodes.some((node) => node.name?.value === name)
    for (const role of ['table', 'columnheader', 'rowheader', 'figure', 'image', 'link']) {
      if (!hasRole(role)) throw new Error(`accessibility tree is missing the ${role} role after sanitization`)
    }
    for (const name of [
      'x squared equals four',
      'Enrollment by section',
      'Test graph: a line rises from left to right',
      'Open the cited source',
    ]) {
      if (!hasName(name)) throw new Error(`accessibility tree is missing “${name}” after sanitization`)
    }
  } finally {
    await browser.close()
  }
}

async function pushFromSelfHostedApp(scopedToken, courseName) {
  const browser = await chromium.launch()
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) {
      browserErrors.push(message.text())
    }
  })

  try {
    await page.goto(`${appOrigin}/`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.getByRole('button', { name: /A Canvas course/i }).click()
    const address = page.getByLabel('Canvas address')
    if (await address.inputValue() !== canvasBase || await address.isEditable()) {
      throw new Error('self-hosted app did not pin the configured Canvas origin read-only')
    }
    await page.getByLabel('Access token').fill(scopedToken)
    await page.getByRole('button', { name: 'Connect', exact: true }).click()
    await page.getByText(/Connected as /).waitFor({ state: 'visible', timeout: 60_000 })

    const course = page.getByRole('radio', { name: new RegExp(escapeRegex(courseName)) })
    await course.waitFor({ state: 'visible', timeout: 60_000 })
    await course.check()
    await page.getByText(/This course has no pages yet\.|page already exists|pages already exist/i).waitFor({
      state: 'visible',
      timeout: 60_000,
    })

    // The workflow step is called "Content", not "Chapters". This script had
    // never been run end to end (RELEASE-ACCEPTANCE §1 had zero rows), so its
    // selectors rotted silently as the nav was renamed.
    await page.getByRole('button', { name: /^Content(?:\s|$)/ }).click()
    await page.getByRole('tab', { name: 'LibreTexts' }).click()
    const search = page.getByLabel('Search books')
    await search.waitFor({ state: 'visible', timeout: 60_000 })
    await search.fill('A Concise Introduction to Logic')
    await page.getByRole('button', { name: /^A Concise Introduction to Logic/ }).click()

    // The measured book currently exposes one-section Front/Back Matter plus
    // three logical chapters. Front Matter is deliberately the cheapest live
    // write while still exercising the real LibreTexts adapter and compiler.
    const chapter = page.getByRole('checkbox', { name: /Front Matter/i }).first()
    await chapter.waitFor({ state: 'visible', timeout: 60_000 })
    await chapter.check()
    await page.getByRole('button', { name: 'Prepare 1 chapter', exact: true }).click()

    const verdict = page.getByText(/No blocking issues found\./).first()
    await Promise.race([
      verdict.waitFor({ state: 'visible', timeout: 120_000 }),
      page.getByRole('alert').filter({ hasText: /\S/ }).waitFor({ state: 'visible', timeout: 120_000 }),
    ])
    const alert = (await page.getByRole('alert').textContent())?.trim()
    if (alert) throw new Error(`self-hosted app reported an error while preparing: ${alert}`)

    await page.getByRole('button', { name: /^Plan(?:\s|$)/ }).click()
    await page.getByRole('heading', { name: 'Review the plan' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: new RegExp(`^Push \\d+ pages? to ${escapeRegex(courseName)}$`) }).click()
    await page.getByRole('heading', { name: 'Pushed to Canvas' }).waitFor({ state: 'visible', timeout: 120_000 })
    if (!(await page.getByText('Created', { exact: true }).first().isVisible())) {
      throw new Error('first self-hosted push was not reported as a create')
    }

    const afterCreate = await listPages(scopedToken)
    if (afterCreate.length === 0) throw new Error('first self-hosted push created no Canvas pages')

    await page.getByRole('button', { name: /^Plan(?:\s|$)/ }).click()
    await page.getByRole('heading', { name: 'Review the plan' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: new RegExp(`^Push \\d+ pages? to ${escapeRegex(courseName)}$`) }).click()
    await page.getByRole('heading', { name: 'Pushed to Canvas' }).waitFor({ state: 'visible', timeout: 120_000 })
    if (!(await page.getByText('Replaced an existing page', { exact: true }).first().isVisible())) {
      throw new Error('second self-hosted push was not reported as an in-place update')
    }

    const afterUpdate = await listPages(scopedToken)
    if (afterUpdate.length !== afterCreate.length) {
      throw new Error(`second self-hosted push duplicated pages (${afterCreate.length} became ${afterUpdate.length})`)
    }
    if (browserErrors.length) throw new Error(`browser reported: ${browserErrors.join('; ')}`)
    return { pageCount: afterUpdate.length }
  } finally {
    await browser.close()
  }
}

async function removePage(url) {
  const response = await canvas(`/api/v1/courses/${courseId}/pages/${encodeURIComponent(url)}`, {
    method: 'DELETE',
  })
  if (!response.ok && response.status !== 404) {
    throw new Error(`cleanup page ${url}: HTTP ${response.status}`)
  }
}

async function main() {
  const self = await expectJson('/api/v1/users/self', {}, 'administrator identity')
  const course = await expectJson(`/api/v1/courses/${courseId}`, {}, 'sandbox course')
  if (!/(?:test|sandbox)/i.test(course.name ?? '')) {
    throw new Error(`refusing live writes: course ${courseId} is named “${course.name ?? ''}”`)
  }

  const before = await listPages()
  const beforeUrls = new Set(before.map((page) => page.url))
  const createdUrls = new Set()
  let enrollmentId
  let scoped
  const cleanupErrors = []

  try {
    enrollmentId = await ensureTeacherEnrollment(self.id)
    scoped = await createScopedToken()
    const access = await verifyScopedAccess(scoped.token, course.name)
    await verifySanitizer(scoped.token, createdUrls)
    // The sanitizer fixture is not part of the product push and would make the
    // destination page-count message less useful. Remove it before driving UI.
    for (const url of createdUrls) await removePage(url)
    createdUrls.clear()

    const pushed = await pushFromSelfHostedApp(scoped.token, course.name)
    if (access.scopesEnforced) {
      console.log(`PASS scoped token and self-hosted relay (${SCOPES.length} URL scopes; out-of-scope endpoint refused)`)
    } else {
      console.log('OPEN least-privilege token: this Canvas default developer key ignores manual-token URL scopes')
      console.log('PASS short-lived token and self-hosted relay; the token was revoked during cleanup')
    }
    console.log('PASS Canvas sanitizer: MathML, table semantics, figure, link, and attribution survived')
    console.log('PASS keyboard and Chromium accessibility-tree checks on the sanitized Canvas body')
    console.log(`PASS self-hosted create/update: ${pushed.pageCount} page(s), second push created no duplicates`)
  } finally {
    try {
      const after = await listPages()
      for (const page of after) {
        if (!beforeUrls.has(page.url)) await removePage(page.url)
      }
    } catch (error) {
      cleanupErrors.push(error)
    }
    if (scoped?.id) {
      try {
        const response = await canvas(`/api/v1/users/self/tokens/${scoped.id}`, { method: 'DELETE' })
        if (!response.ok && response.status !== 404) throw new Error(`revoke scoped token: HTTP ${response.status}`)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (enrollmentId) {
      try {
        const response = await canvas(
          `/api/v1/courses/${courseId}/enrollments/${enrollmentId}?task=delete`,
          { method: 'DELETE' },
        )
        if (!response.ok && response.status !== 404) throw new Error(`remove temporary enrollment: HTTP ${response.status}`)
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    if (cleanupErrors.length) {
      throw new AggregateError(cleanupErrors, 'live verification cleanup failed')
    }
  }

  const finalPages = await listPages()
  if (finalPages.length !== before.length || finalPages.some((page) => !beforeUrls.has(page.url))) {
    throw new Error('sandbox page snapshot was not restored after verification')
  }
  console.log(`PASS cleanup restored course ${courseId}; short-lived token revoked${enrollmentId ? '; temporary enrollment removed' : ''}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  if (error instanceof AggregateError) {
    for (const cause of error.errors) console.error(`  cleanup: ${cause instanceof Error ? cause.message : String(cause)}`)
  }
  process.exitCode = 1
})
