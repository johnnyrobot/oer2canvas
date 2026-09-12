import { render, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { ChapterView } from '../../components/ChapterView'
import { QueueView } from '../../components/queue/QueueView'
import { newSession } from '../../components/queue/session'
import { wrapInCanvasShell } from './canvas-shell'
import type { CompiledChapter, CompiledSection, QueueItem } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
// The preview is styled by whatever the app loads, exactly as the screens under
// audit are in `App.a11y.browser.test.tsx`. Imported explicitly so this measures
// the real styling rather than a bare document.
import '../../App.css'

/**
 * PREVIEW/AUDIT PARITY — the test `canvas-shell.test.ts`'s PORT NOTE asked for.
 *
 * That note says upstream's parity test "should be restored verbatim the moment a
 * preview lands — parity between what is previewed and what is audited is the
 * entire reason this shell is a single exported constant." A preview HAS landed:
 * `ChapterView` and `QueueView` both mount gated html into `.b2c-section-body`.
 * Nothing restored the parity, and nothing was watching, so the two sides drifted.
 *
 * This is the restoration. It compares COMPUTED styles, not css text, because css
 * text agreeing proves nothing about what a browser resolves — and it is what a
 * browser resolves that the audit measured and the instructor is judging.
 *
 * Scoped deliberately to what the shell can control. Line length is NOT asserted:
 * the audit lays the column out in a 1280px frame and the app lays it out inside
 * the review column's 60rem, so the two boxes cannot be equal without the app adopting the
 * audit's viewport. That divergence is real, pre-existing, and out of this test's
 * reach; typography and colour are not.
 */

const FRAGMENT =
  '<h2>Section heading</h2>' +
  '<p id="probe-body">Ordinary body text.</p>' +
  '<p><a id="probe-link" href="https://example.org/">A link</a></p>' +
  '<blockquote id="probe-quote">A quotation.</blockquote>' +
  '<table><caption>A table</caption><tbody><tr><td id="probe-cell">A cell</td></tr></tbody></table>'

/** The properties the shell exists to fix, and that a reader actually perceives. */
const COMPARED = ['fontFamily', 'fontSize', 'lineHeight', 'color', 'backgroundColor'] as const

function readStyles(el: Element, win: Window): Record<string, string> {
  const s = win.getComputedStyle(el)
  return Object.fromEntries(COMPARED.map((p) => [p, s[p]]))
}

/** Render the fragment the way the AUDIT does: the real shell document, in a frame. */
async function measureAudited(): Promise<Record<string, Record<string, string>>> {
  const frame = document.createElement('iframe')
  frame.style.width = '1280px'
  frame.style.height = '900px'
  frame.style.position = 'absolute'
  frame.style.left = '-10000px'
  document.body.appendChild(frame)
  const doc = frame.contentDocument!
  doc.open()
  doc.write(wrapInCanvasShell(FRAGMENT))
  doc.close()
  await new Promise<void>((r) => frame.contentWindow!.requestAnimationFrame(() => r()))
  const win = frame.contentWindow as Window
  const out: Record<string, Record<string, string>> = {}
  for (const id of ['probe-body', 'probe-link', 'probe-quote', 'probe-cell']) {
    out[id] = readStyles(doc.getElementById(id)!, win)
  }
  frame.remove()
  return out
}

function compiledWith(html: string): CompiledChapter {
  const chapter = {
    source: 'openstax',
    bookId: 'b',
    title: 'A chapter',
    sections: [],
    attribution: { bookTitle: 'A book', publisher: 'OpenStax', url: 'https://example.org/', authors: [] },
    xrefs: new Map(),
  } as unknown as Chapter
  const section: CompiledSection = {
    id: 's1',
    title: 'A section',
    html,
    notes: [],
    queue: [],
    gate: { html, conformance: { blockers: [], warnings: [], needsHumanReview: [], passedChecks: true }, badgeWithheld: false } as CompiledSection['gate'],
  }
  return { chapter, sections: [section], queue: [] }
}

function measurePreview(container: HTMLElement): Record<string, Record<string, string>> {
  const body = container.querySelector('.b2c-section-body')
  if (!body) throw new Error('no .b2c-section-body rendered')
  return Object.fromEntries(
    ['probe-body', 'probe-link', 'probe-quote', 'probe-cell'].map((id) => [
      id,
      readStyles(body.querySelector(`#${id}`)!, window),
    ]),
  )
}

function expectPreviewSecurityBoundary(container: HTMLElement): void {
  const body = container.querySelector('.b2c-section-body')
  if (!body) throw new Error('no .b2c-section-body rendered')
  const styles = window.getComputedStyle(body)
  expect(styles.contain).toContain('layout')
  expect(styles.contain).toContain('paint')
  expect(styles.isolation).toBe('isolate')
  expect(styles.position).toBe('relative')
  expect(styles.overflowX).toBe('auto')
  expect(styles.overflowY).toBe('auto')
}

afterEach(cleanup)

/*
  BOTH preview surfaces, because there are exactly two and they styled
  themselves independently of each other — which is to say, neither did.
*/

test('the chapter view renders publisher bytes the way the audit measured them', async () => {
  const audited = await measureAudited()
  const { container } = render(<ChapterView compiled={compiledWith(FRAGMENT)} />)
  // Reported whole rather than property by property: when these diverge it is
  // rarely one declaration, and seeing the whole shape is what tells you whether
  // the preview lost the shell or never had it.
  expect(measurePreview(container)).toEqual(audited)
  expectPreviewSecurityBoundary(container)
})

test('the queue screen renders publisher bytes the way the audit measured them', async () => {
  const audited = await measureAudited()

  const item: QueueItem = {
    kind: 'confirm-decorative',
    elementId: 'probe-body',
    sectionId: 's1',
    context: { reference: 'A sentence.' },
  } as QueueItem
  const section: CompiledSection = {
    ...compiledWith(FRAGMENT).sections[0]!,
    queue: [item],
  }
  const chapter = { ...compiledWith(FRAGMENT), sections: [section], queue: [item] }

  const { container } = render(<QueueView session={newSession(chapter)} />)
  expect(measurePreview(container)).toEqual(audited)
  expectPreviewSecurityBoundary(container)
})
