# IDEA Review — Slice 3 Implementation Plan (inventories)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two inventories the instructor reads before rating: 7.1 — every image with its alt, caption, reference sentence, and whether its text mentions a person, plus a per-section summary; 7.7 — headings, glossary/defined terms, key-takeaway blocks, and repeated proper nouns. Observation tables only; no inference, no edits.

**Architecture:** Two pure functions over the compiled section HTML (`imageInventory`, `metadataInventory`) return typed rows; two thin finders wrap them as `observation` findings so they render through the existing `FindingRow`/`CategoryPanel` zone with an "Inventory" heading and no Dismiss. The typed rows are exported separately because slice 4 feeds them to the model prompts for 7.1 and 7.7.

**Tech Stack:** TypeScript, `DOMParser`, Vitest (jsdom), React, Testing Library.

**Spec:** `docs/IDEA_REVIEW_SPEC.md` §3.3, §3.4, §3.5, §5.2, §7.2 ("no inference"), §8 slice 3.

## Global Constraints

- **No demographic inference.** `mentionsPeople` is a fixed noun list matched against alt + caption text; it says *the text mentions a person*, never who. Nothing reads pixels.
- **Inventories are observations**: no `edit` findings, no `suggestion` column, no Dismiss control.
- **No network.** Pure functions over strings.
- **Publisher selectors** for key-takeaway/glossary blocks are a fixed list in `metadata.ts`, not a `PublisherProfile` field — finders do not receive a profile.
- Copy in `src/components/idea/copy.ts`. `npm run typecheck` before each commit. Commit trailer: `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/engine/idea/images.ts` | `imageInventory(sectionId, html) → ImageRow[]`, `imageSummary(rows)`, `findImages: Finder`. |
| `src/engine/idea/metadata.ts` | `metadataInventory(sectionId, html) → MetadataRow[]`, `findMetadata: Finder`. |
| `src/engine/idea/findings.ts` | Register both finders; `RuleRef.source` gains `'inventory'`. |
| `src/components/idea/FindingRow.tsx`, `CategoryPanel.tsx`, `copy.ts` | Inventory heading, no Dismiss for inventory rows, header counts. |

---

### Task 1: The image inventory

**Files:**
- Create: `src/engine/idea/images.ts`
- Modify: `src/engine/idea/findings.ts` (add `'inventory'` to `RuleRef.source`; register `findImages`)
- Test: `src/engine/idea/images.test.ts`

**Interfaces:**
```ts
export interface ImageRow {
  sectionId: string
  elementId: string          // the <img>'s id (every queued image has one; others get 'b2c-img-<n>' from resolveAlt only when queued — so this may be minted here, see below)
  src: string
  alt: string | null         // null = no attribute; '' = decorative
  caption?: string
  reference?: string         // the preceding sentence, via referenceFor
  mentionsPeople: boolean
  presentational: boolean
}
export interface ImageSummary { images: number; withPeople: number; decorative: number; noAlt: number }
export function imageInventory(sectionId: string, html: string): ImageRow[]
export function imageSummary(rows: readonly ImageRow[]): ImageSummary
export const findImages: Finder
export const PEOPLE_NOUNS: readonly string[]
```
Element ids: the compiled HTML gives an id to every image that was queued (`ensureId` in `resolveAlt`) and to none that were trusted. The inventory needs to highlight any image, so it reads the id when present and otherwise uses the id of the image's closest ancestor that has one (a `.b2c-figure` or a block from `ensureBlockIds`). It never writes to the document it is given.

- [ ] **Step 1: Write the failing test**

`src/engine/idea/images.test.ts`:
```ts
import { findImages, imageInventory, imageSummary } from './images'

const html = `
<p id="b2c-blk-0">As Figure 1 shows, the nurse checks the chart.</p>
<div class="b2c-figure" id="b2c-fig-0">
  <img id="i1" src="a.png" alt="A nurse reading a patient chart" aria-describedby="b2c-cap-b2c-fig-0">
  <p class="b2c-caption" id="b2c-cap-b2c-fig-0">Figure 1 A nurse at work.</p>
</div>
<p id="b2c-blk-1">Molecules:</p>
<div class="b2c-figure" id="b2c-fig-1"><img src="b.png" alt="Ball-and-stick model of glucose"></div>
<p id="b2c-blk-2"><img src="c.png" alt="" role="presentation"></p>
<p id="b2c-blk-3"><img src="d.png"></p>
`

test('one row per image with alt, caption, reference, and people flag', () => {
  const rows = imageInventory('s1', html)
  expect(rows).toHaveLength(4)
  expect(rows[0]).toMatchObject({
    sectionId: 's1', elementId: 'i1', src: 'a.png', alt: 'A nurse reading a patient chart',
    caption: 'Figure 1 A nurse at work.', reference: 'As Figure 1 shows, the nurse checks the chart.',
    mentionsPeople: true, presentational: false,
  })
  expect(rows[1]).toMatchObject({ elementId: 'b2c-fig-1', alt: 'Ball-and-stick model of glucose', mentionsPeople: false })
  expect(rows[2]).toMatchObject({ elementId: 'b2c-blk-2', alt: '', presentational: true })
  expect(rows[3]).toMatchObject({ elementId: 'b2c-blk-3', alt: null, presentational: false })
})

test('people detection is a word-boundary noun list, not a guess', () => {
  const row = (alt: string) => imageInventory('s', `<p id="p"><img src="x" alt="${alt}"></p>`)[0]!
  expect(row('Two students at a bench').mentionsPeople).toBe(true)
  expect(row('A doctor').mentionsPeople).toBe(true)
  expect(row('The doctorate ceremony hall, empty').mentionsPeople).toBe(false)
  expect(row('Manganese ore').mentionsPeople).toBe(false)
  expect(row('A woman and her child').mentionsPeople).toBe(true)
})

test('the summary counts images, people, decoratives, and missing alt', () => {
  expect(imageSummary(imageInventory('s1', html))).toEqual({ images: 4, withPeople: 1, decorative: 1, noAlt: 1 })
})

test('findImages yields one observation per image plus a summary, category 7.1, source inventory', () => {
  const f = findImages('s1', html)
  expect(f).toHaveLength(5)
  expect(f.every((x) => x.kind === 'observation' && x.category === '7.1' && x.rule?.source === 'inventory')).toBe(true)
  const summary = f.find((x) => x.key === 's1::summary::7.1')!
  expect(summary.kind === 'observation' && summary.columns).toEqual({ images: '4', 'mention people': '1', decorative: '1', 'no alt text': '1' })
  const first = f[0]!
  expect(first.kind === 'observation' && first.columns).toEqual({
    image: 'a.png', description: 'A nurse reading a patient chart', caption: 'Figure 1 A nurse at work.',
    reference: 'As Figure 1 shows, the nurse checks the chart.', 'mentions people': 'yes',
  })
  expect(first.elementId).toBe('i1')
  expect(first.key).toBe('s1::i1::0::image')
})

test('a section with no images yields only a zero summary', () => {
  const f = findImages('s1', '<p id="a">text</p>')
  expect(f).toHaveLength(1)
  expect(f[0]!.kind === 'observation' && f[0]!.columns.images).toBe('0')
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/engine/idea/images.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `images.ts`**

```ts
/**
 * 7.1 Illustrations and Photos — the INVENTORY, not a judgment.
 *
 * What OERI's own Gen-AI crosswalk feeds a model for 7.1 is exactly this:
 * alt text, captions, and descriptions, never pixels. And what Rubric 1 asks
 * the assessor to tally is exactly what this lays out for them to read. The
 * one boolean here, `mentionsPeople`, is a word-boundary match against a
 * fixed noun list over the image's OWN text; it says the text names a person,
 * and nothing about who. Nothing in this file infers race, gender, age, or
 * disability from anything, and nothing here ever will.
 */
import type { Finder, IdeaFinding } from './findings'
import { referenceFor } from '../compile/steps/reference'

export interface ImageRow {
  sectionId: string
  elementId: string
  src: string
  alt: string | null
  caption?: string
  reference?: string
  mentionsPeople: boolean
  presentational: boolean
}

export interface ImageSummary {
  images: number
  withPeople: number
  decorative: number
  noAlt: number
}

export const PEOPLE_NOUNS: readonly string[] = [
  'person', 'people', 'man', 'men', 'woman', 'women', 'boy', 'boys', 'girl', 'girls', 'child', 'children',
  'baby', 'infant', 'toddler', 'teen', 'teenager', 'adult', 'adults', 'student', 'students', 'teacher', 'teachers',
  'instructor', 'professor', 'worker', 'workers', 'nurse', 'nurses', 'doctor', 'doctors', 'physician', 'patient',
  'patients', 'scientist', 'scientists', 'researcher', 'researchers', 'engineer', 'engineers', 'farmer', 'farmers',
  'family', 'families', 'parent', 'parents', 'mother', 'father', 'couple', 'crowd', 'group of', 'team', 'athlete',
  'athletes', 'player', 'players', 'customer', 'customers', 'shopper', 'employee', 'employees', 'soldier', 'soldiers',
  'officer', 'officers', 'portrait', 'face', 'faces', 'hand', 'hands', 'someone', 'anyone', 'everyone',
]

const PEOPLE = new RegExp(`(?<![\\w-])(?:${PEOPLE_NOUNS.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`, 'i')

const text = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** The image's own id, or the nearest ancestor's: something the render can outline. */
function idFor(img: Element, index: number): string {
  const own = img.getAttribute('id')
  if (own) return own
  const ancestor = img.closest('[id]')
  return ancestor?.getAttribute('id') ?? `b2c-img-inv-${index}`
}

export function imageInventory(sectionId: string, html: string): ImageRow[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  return Array.from(doc.body.querySelectorAll('img')).map((img, index) => {
    const alt = img.getAttribute('alt')
    const caption = text(img.closest('.b2c-figure')?.querySelector('.b2c-caption')?.textContent)
    const reference = referenceFor(img)
    const role = img.getAttribute('role') ?? ''
    const presentational = role === 'presentation' || role === 'none' || img.closest('[aria-hidden="true"]') !== null
    return {
      sectionId,
      elementId: idFor(img, index),
      src: img.getAttribute('src') ?? '',
      alt,
      ...(caption ? { caption } : {}),
      ...(reference ? { reference } : {}),
      mentionsPeople: PEOPLE.test(`${alt ?? ''} ${caption}`),
      presentational,
    }
  })
}

export function imageSummary(rows: readonly ImageRow[]): ImageSummary {
  return {
    images: rows.length,
    withPeople: rows.filter((r) => r.mentionsPeople).length,
    decorative: rows.filter((r) => r.presentational || r.alt === '').length,
    noAlt: rows.filter((r) => r.alt === null).length,
  }
}

export const findImages: Finder = (sectionId, html) => {
  const rows = imageInventory(sectionId, html)
  const s = imageSummary(rows)
  const out: IdeaFinding[] = rows.map((r, i) => ({
    kind: 'observation',
    key: `${sectionId}::${r.elementId}::${i}::image`,
    category: '7.1',
    sectionId,
    elementId: r.elementId,
    columns: {
      image: r.src.split('/').pop() ?? r.src,
      description: r.alt === null ? '(no alt text)' : r.alt === '' ? '(decorative)' : r.alt,
      caption: r.caption ?? '—',
      reference: r.reference ?? '—',
      'mentions people': r.mentionsPeople ? 'yes' : 'no',
    },
    rule: { id: 'inventory-image', source: 'inventory' },
    origin: 'rule',
  }))
  out.push({
    kind: 'observation',
    key: `${sectionId}::summary::7.1`,
    category: '7.1',
    sectionId,
    columns: { images: String(s.images), 'mention people': String(s.withPeople), decorative: String(s.decorative), 'no alt text': String(s.noAlt) },
    rule: { id: 'inventory-image-summary', source: 'inventory' },
    origin: 'rule',
  })
  return out
}
```

In `src/engine/idea/findings.ts`: change `source: 'terms' | 'idiom' | 'llm'` to `source: 'terms' | 'idiom' | 'inventory' | 'llm'`, import `findImages`, and set `RULE_FINDERS = [findTerms, findIdioms, findImages]`.

Note on the test's `columns` equality for the first row: the fixture's `img` for `a.png` has an explicit `id="i1"`, so `elementId` is `i1`; the `key` is `s1::i1::0::image` by construction above.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit src/engine/idea/images.test.ts src/engine/idea/findings.test.ts`
Expected: PASS. `findings.test.ts` "runs every finder" now sees a 7.1 summary observation too — update its expected category list to `['7.1', '7.3', '7.6', '7.6']` (the summary row is present even with no images).

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/engine/idea/images.ts src/engine/idea/images.test.ts src/engine/idea/findings.ts src/engine/idea/findings.test.ts
git commit -m "feat: the 7.1 image inventory, text only, no inference

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The metadata inventory

**Files:**
- Create: `src/engine/idea/metadata.ts`
- Modify: `src/engine/idea/findings.ts` (register `findMetadata`)
- Test: `src/engine/idea/metadata.test.ts`

**Interfaces:**
```ts
export type MetadataKind = 'heading' | 'glossary' | 'defined-term' | 'key-block' | 'proper-noun'
export interface MetadataRow { sectionId: string; elementId?: string; kind: MetadataKind; text: string; detail?: string }
export function metadataInventory(sectionId: string, html: string): MetadataRow[]
export const findMetadata: Finder
export const KEY_BLOCK_SELECTOR: string
```

- [ ] **Step 1: Write the failing test**

`src/engine/idea/metadata.test.ts`:
```ts
import { findMetadata, metadataInventory } from './metadata'

const html = `
<h2 id="h1">9.3 Lifespan Theories</h2>
<p id="b2c-blk-0">Sigmund Freud proposed stages. Sigmund Freud is cited again. Erik Erikson too, and Erik Erikson once more. Piaget once.</p>
<h3 id="h2">Key terms</h3>
<dl id="dl"><dt id="dt1">Ego</dt><dd id="dd1">The rational self.</dd><dt id="dt2">Id</dt><dd id="dd2">Drives.</dd></dl>
<p id="b2c-blk-1"><strong>Schema</strong> is a mental framework.</p>
<div class="os-key-takeaways" id="kt"><p id="b2c-blk-2">Freud and Erikson shaped the field.</p></div>
`

test('headings, glossary terms, defined terms, key blocks, and repeated proper nouns are inventoried', () => {
  const rows = metadataInventory('s1', html)
  expect(rows.filter((r) => r.kind === 'heading').map((r) => r.text)).toEqual(['9.3 Lifespan Theories', 'Key terms'])
  expect(rows.filter((r) => r.kind === 'glossary').map((r) => [r.text, r.detail])).toEqual([['Ego', 'The rational self.'], ['Id', 'Drives.']])
  expect(rows.filter((r) => r.kind === 'defined-term').map((r) => r.text)).toEqual(['Schema'])
  expect(rows.filter((r) => r.kind === 'key-block').map((r) => r.text)).toEqual(['Freud and Erikson shaped the field.'])
  const nouns = rows.filter((r) => r.kind === 'proper-noun').map((r) => [r.text, r.detail])
  expect(nouns).toEqual([['Sigmund Freud', '2'], ['Erik Erikson', '2']])
})

test('a heading row carries the element id so it can be outlined', () => {
  const h = metadataInventory('s1', html).find((r) => r.kind === 'heading')!
  expect(h.elementId).toBe('h1')
})

test('sentence-initial words are not proper nouns unless they repeat as capitalised mid-sentence', () => {
  const rows = metadataInventory('s1', '<p id="a">The cell divides. The cell grows. Then Golgi bodies act, and Golgi bodies rest.</p>')
  expect(rows.filter((r) => r.kind === 'proper-noun').map((r) => r.text)).toEqual(['Golgi'])
})

test('findMetadata yields observations, category 7.7, source inventory, keyed uniquely', () => {
  const f = findMetadata('s1', html)
  expect(f.every((x) => x.kind === 'observation' && x.category === '7.7' && x.rule?.source === 'inventory')).toBe(true)
  expect(new Set(f.map((x) => x.key)).size).toBe(f.length)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/engine/idea/metadata.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `metadata.ts`**

```ts
/**
 * 7.7 Keyword, Glossary, and Metadata — what the section SIGNALS as important.
 *
 * The Framework's point is that summaries, key terms, and glossaries tell a
 * student what matters, so whoever is absent from them is absent from what
 * matters. This lists what those sections contain; the instructor judges.
 *
 * Proper nouns are the crudest of these: capitalised runs that appear at least
 * twice and at least once NOT at a sentence start. Textbook prose names the
 * theorists it centres, and a list of them is a list the assessor can read
 * against the Framework's example (a summary naming four white men).
 */
import type { Finder, IdeaFinding } from './findings'

export type MetadataKind = 'heading' | 'glossary' | 'defined-term' | 'key-block' | 'proper-noun'

export interface MetadataRow {
  sectionId: string
  elementId?: string
  kind: MetadataKind
  text: string
  detail?: string
}

export const KEY_BLOCK_SELECTOR = [
  '.os-key-takeaways', '.key-takeaways', '.os-summary', '.summary', '.os-learning-objectives',
  '.learning-objectives', '.chapter-summary', '.key-concepts', '.os-glossary-container', '.glossary',
  '[data-type="key-takeaways"]', '[data-type="summary"]', '[data-type="learning-objectives"]',
].join(', ')

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

/** Capitalised runs of 1–3 words, with where each occurrence sits. */
function properNouns(paragraphText: string): Map<string, { total: number; midSentence: number }> {
  const counts = new Map<string, { total: number; midSentence: number }>()
  const sentences = paragraphText.split(/(?<=[.!?])\s+/)
  for (const sentence of sentences) {
    const run = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/g
    let m: RegExpExecArray | null
    while ((m = run.exec(sentence)) !== null) {
      const name = m[1]!
      const atStart = m.index === 0
      const c = counts.get(name) ?? { total: 0, midSentence: 0 }
      c.total += 1
      if (!atStart) c.midSentence += 1
      counts.set(name, c)
    }
  }
  return counts
}

export function metadataInventory(sectionId: string, html: string): MetadataRow[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const rows: MetadataRow[] = []
  const withId = (el: Element) => (el.getAttribute('id') ? { elementId: el.getAttribute('id')! } : {})

  for (const h of Array.from(doc.body.querySelectorAll('h2, h3, h4'))) {
    rows.push({ sectionId, ...withId(h), kind: 'heading', text: clean(h.textContent) })
  }
  for (const dt of Array.from(doc.body.querySelectorAll('dt'))) {
    const dd = dt.nextElementSibling?.tagName === 'DD' ? clean(dt.nextElementSibling.textContent) : ''
    rows.push({ sectionId, ...withId(dt), kind: 'glossary', text: clean(dt.textContent), ...(dd ? { detail: dd } : {}) })
  }
  for (const p of Array.from(doc.body.querySelectorAll('p, li'))) {
    const lead = p.firstElementChild
    if (lead && (lead.tagName === 'STRONG' || lead.tagName === 'B') && p.firstChild === lead) {
      const term = clean(lead.textContent)
      if (term && term.length <= 60) rows.push({ sectionId, ...withId(p), kind: 'defined-term', text: term })
    }
  }
  for (const block of Array.from(doc.body.querySelectorAll(KEY_BLOCK_SELECTOR))) {
    for (const p of Array.from(block.querySelectorAll('p, li'))) {
      rows.push({ sectionId, ...withId(p), kind: 'key-block', text: clean(p.textContent) })
    }
  }
  const totals = new Map<string, { total: number; midSentence: number }>()
  for (const p of Array.from(doc.body.querySelectorAll('p, li, dd'))) {
    for (const [name, c] of properNouns(clean(p.textContent))) {
      const t = totals.get(name) ?? { total: 0, midSentence: 0 }
      t.total += c.total
      t.midSentence += c.midSentence
      totals.set(name, t)
    }
  }
  // Longest names first, then drop any shorter name that is a suffix or prefix
  // of a kept one ("Freud" inside "Sigmund Freud"), so the list names people
  // once.
  const kept: string[] = []
  for (const [name, c] of [...totals].sort((a, b) => b[0].length - a[0].length)) {
    if (c.total < 2 || c.midSentence < 1) continue
    if (kept.some((k) => k.includes(name))) continue
    kept.push(name)
  }
  for (const name of kept) rows.push({ sectionId, kind: 'proper-noun', text: name, detail: String(totals.get(name)!.total) })
  return rows
}

export const findMetadata: Finder = (sectionId, html) => {
  return metadataInventory(sectionId, html).map<IdeaFinding>((r, i) => ({
    kind: 'observation',
    key: `${sectionId}::${r.elementId ?? 'meta'}::${i}::${r.kind}`,
    category: '7.7',
    sectionId,
    ...(r.elementId ? { elementId: r.elementId } : {}),
    columns: { kind: r.kind.replace('-', ' '), text: r.text, ...(r.detail ? { detail: r.detail } : {}) },
    rule: { id: `inventory-${r.kind}`, source: 'inventory' },
    origin: 'rule',
  }))
}
```

In `findings.ts` register: `RULE_FINDERS = [findTerms, findIdioms, findImages, findMetadata]`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run --project unit src/engine/idea/`
Expected: PASS. In the fixture, "Freud" and "Erikson" alone are dropped by the suffix rule; "Piaget" appears once and is dropped by `total < 2`; "The" is capitalised only at sentence starts and is dropped by `midSentence < 1`. `findings.test.ts`'s category list gains nothing (the fixture there has no headings, dl, strong-led paragraphs, key blocks, or repeated capitalised names) — if it does, adjust the expected list and say why in the test.

- [ ] **Step 5: Commit**

```bash
npm run typecheck
git add src/engine/idea/metadata.ts src/engine/idea/metadata.test.ts src/engine/idea/findings.ts
git commit -m "feat: the 7.7 metadata inventory

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Inventory zones in the panel

**Files:**
- Modify: `src/components/idea/copy.ts`, `src/components/idea/FindingRow.tsx`, `src/components/idea/CategoryPanel.tsx`
- Test: `src/components/idea/CategoryPanel.test.tsx` (append), `src/components/idea/FindingRow.test.tsx` (append)

- [ ] **Step 1: Write the failing tests**

Append to `src/components/idea/FindingRow.test.tsx`:
```tsx
test('an inventory observation has no Dismiss and no suggestion controls', () => {
  const inv: ObservationFinding = {
    kind: 'observation', key: 's1::i1::0::image', category: '7.1', sectionId: 's1', elementId: 'i1',
    columns: { image: 'a.png', description: 'A nurse', 'mentions people': 'yes' },
    rule: { id: 'inventory-image', source: 'inventory' }, origin: 'rule',
  }
  render(<FindingRow finding={inv} sectionTitle="s" onEvent={vi.fn()} onFocus={vi.fn()} />)
  expect(screen.getByText('A nurse')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Use this wording' })).not.toBeInTheDocument()
})
```

Append to `src/components/idea/CategoryPanel.test.tsx`:
```tsx
import type { ObservationFinding } from '../../engine/idea/findings'

const inventoryRows: ObservationFinding[] = [
  { kind: 'observation', key: 's1::i1::0::image', category: '7.1', sectionId: 's1', elementId: 'i1', columns: { image: 'a.png', description: 'A nurse', 'mentions people': 'yes' }, rule: { id: 'inventory-image', source: 'inventory' }, origin: 'rule' },
  { kind: 'observation', key: 's1::summary::7.1', category: '7.1', sectionId: 's1', columns: { images: '1', 'mention people': '1', decorative: '0', 'no alt text': '0' }, rule: { id: 'inventory-image-summary', source: 'inventory' }, origin: 'rule' },
]

test('7.1 shows an Inventory zone whose header line is the summary', () => {
  render(<CategoryPanel category={categoryById('7.1')} review={newReview().categories['7.1']} open onToggle={vi.fn()} onEvent={vi.fn()} findings={inventoryRows} applied={[]} sectionTitleOf={() => 'S'} />)
  expect(screen.getByRole('button', { name: /7\.1 .*1 image · 1 mentions people/ })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Inventory' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: 'What a rule found' })).not.toBeInTheDocument()
})

test('7.7 shows an Inventory zone with a row count', () => {
  const rows: ObservationFinding[] = [
    { kind: 'observation', key: 's1::h1::0::heading', category: '7.7', sectionId: 's1', elementId: 'h1', columns: { kind: 'heading', text: 'Lifespan' }, rule: { id: 'inventory-heading', source: 'inventory' }, origin: 'rule' },
  ]
  render(<CategoryPanel category={categoryById('7.7')} review={newReview().categories['7.7']} open onToggle={vi.fn()} onEvent={vi.fn()} findings={rows} applied={[]} sectionTitleOf={() => 'S'} />)
  expect(screen.getByRole('button', { name: /7\.7 .*1 item/ })).toBeInTheDocument()
  expect(screen.getByRole('group', { name: 'Inventory' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/components/idea/FindingRow.test.tsx src/components/idea/CategoryPanel.test.tsx`
Expected: FAIL — Dismiss is rendered; no Inventory group; header regex mismatch.

- [ ] **Step 3: Copy**

Add to `IDEA_COPY` in `copy.ts`:
```ts
  inventory: {
    heading: 'Inventory',
    none: 'Nothing to list in this section.',
    imagesSummary: (images: number, people: number) =>
      `${images} image${images === 1 ? '' : 's'} · ${people} mention${people === 1 ? 's' : ''} people`,
    items: (n: number) => `${n} item${n === 1 ? '' : 's'}`,
    guidance71: 'Read the descriptions and captions as a set: who is shown, in what role, and where the picture does not relate to identity. Then tally for Rubric 1.',
    guidance77: 'These are the terms and names the section signals as important. Rubric 1 asks whether diverse scholars and perspectives appear among them.',
  },
```

- [ ] **Step 4: `FindingRow.tsx`**

In the observation branch, compute `const inventory = finding.rule?.source === 'inventory'` and:
- label the row `IDEA_COPY.inventory.heading` instead of `c.observation` when `inventory`;
- render the `suggestion` block and the Dismiss button only when `!inventory`.

- [ ] **Step 5: `CategoryPanel.tsx`**

Add `const INVENTORY_CATEGORIES = new Set<CategoryId>(['7.1', '7.7'])`. Header summary: for `7.1`, find the summary finding (`key.endsWith('::summary::7.1')`) and print `IDEA_COPY.inventory.imagesSummary(Number(columns.images), Number(columns['mention people']))`; for `7.7`, print `IDEA_COPY.inventory.items((findings ?? []).length)`. The rule-categories count line stays for 7.3/7.6.

Zone: reuse the existing findings `fieldset` block with a condition — `RULE_CATEGORIES.has(id) || INVENTORY_CATEGORIES.has(id)` — and choose the legend (`findings.heading` vs `inventory.heading`), the empty text (`findings.none` vs `inventory.none`), and, for inventory categories, a guidance paragraph under the legend (`guidance71` / `guidance77`). For 7.1 render the summary finding first (its `key` ends with `::summary::7.1`), then the rows. The `AppliedList` stays inside rule categories only.

- [ ] **Step 6: Run the tests, typecheck, commit**

Run: `npx vitest run --project unit src/components/idea/ && npm run typecheck`
Expected: PASS.

```bash
git add src/components/idea
git commit -m "feat: inventory zones for 7.1 and 7.7

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Docs and acceptance

**Files:**
- Modify: `docs/IDEA.md`, `docs/RELEASE-ACCEPTANCE.md`, `README.md`

- [ ] **Step 1: Docs**

`docs/IDEA.md` — heading becomes "Slices 1–3 (this release)"; add:
```markdown
- **Inventories:** 7.1 lists every image's alt text, caption, and preceding sentence and whether
  that text names a person (a fixed noun list — "nurse", "students", "family" — over the image's
  own text). 7.7 lists headings, glossary and defined terms, key-takeaway blocks, and capitalised
  names that recur. Neither infers anything about anyone; both exist so the assessor can tally for
  Rubric 1 from a list rather than by scrolling.
```
`README.md` — one sentence after the slice-2 paragraph: *"Two more categories — illustrations and photos, and keywords/glossary — get an inventory of what the section contains (image descriptions, captions, headings, key terms, recurring names), listed for the instructor to weigh; the app never infers race, gender, age, or disability from an image or a name."*

`docs/RELEASE-ACCEPTANCE.md` — append:
```markdown
### IDEA review — slice 3

1. Prepare an OpenStax chapter with figures (Biology 2e, any chapter).
2. IDEA → 7.1's header reads "N images · M mention people"; open it. The first row is the summary;
   each image row shows description, caption, reference; focusing a row outlines the image below.
3. 7.7's header reads "N items"; open it: headings, key terms, and recurring names are listed.
4. Neither zone has Replace, Use this wording, or Dismiss.
```

- [ ] **Step 2: Full suite and commit**

Run: `npm run typecheck && npm test`

```bash
git add docs/IDEA.md docs/RELEASE-ACCEPTANCE.md README.md
git commit -m "docs: record the IDEA inventories and their no-inference rule

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (§8.3):** `images.ts` with alt/caption/reference/src and `mentionsPeople` from a fixed list, per-image rows + section summary, no demographic inference (§3.3) → Task 1; `metadata.ts` headings, `<dl>`, bold-led definitions, key-takeaway blocks by selector, repeated proper nouns (§3.4) → Task 2; observation tables in the panel (§5.2) → Task 3; typed rows exported for slice 4's prompts → Tasks 1–2 (`imageInventory`, `metadataInventory`). Deviation from §3.4: key-block selectors are a fixed list rather than a `PublisherProfile` field, because finders receive no profile.

**Placeholder scan:** none.

**Type consistency:** `Finder` and `IdeaFinding` from slice 2's `findings.ts`; `RuleRef.source` widened in Task 1 and used in Tasks 2–3; `IDEA_COPY.inventory` keys used in Task 3 match Step 3's definitions.
