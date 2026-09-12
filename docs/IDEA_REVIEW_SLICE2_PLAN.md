# IDEA Review — Slice 2 Implementation Plan (findings and edits)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deterministic 7.6 terminology and 7.3 gendered-noun findings with one-click Replace / Edit / Keep-with-context / Dismiss, applied by a compile step so they reach the cartridge with a CC BY change note, highlighted in the section render, and undoable.

**Architecture:** A vendored, hand-curated term list and idiom list (JSON, CC BY, no runtime dependency) are matched over the text nodes of each block element of the compiled section HTML; every block element gets a deterministic id at compile time so a finding can name its element. A human's decision is plain data in an `IdeaEdits` map beside the queue's `answers`; a new compile step `applyIdeaEdits` applies it from source on every recompile, exactly as `resolveAlt` applies answers, and appends the change sentence to the attribution block. Because the queue's answers never leave `QueueScreen` today, Task 1 lifts them (and the settled, answered chapters) into `App` so both answers and IDEA edits flow into one recompile → re-audit → `prepared` path.

**Tech Stack:** TypeScript, React 19, `DOMParser`, Vitest (jsdom + browser), Testing Library, axe-core.

**Spec:** `docs/IDEA_REVIEW_SPEC.md` §2.2–§2.4, §2.7, §3.1, §3.2, §3.6, §5.3, §7.1, §8 slice 2. This plan was revised 2026-09-11 to follow the slice 1 revision: edits join the persisted review document (spec §2.7) instead of living in a session-only hook; the chapter render slice 1 put beside the panels is what gains highlight-on-focus here, rather than a second render below them; `IdeaScreen` carries slice 1's `header` / `onHeaderEvent` / `onForget` props throughout. Two refinements recorded here: (a) the term list is **hand-curated JSON** in v1 rather than generated from retext-equality's YAML — no runtime `unified`/`retext` dependency, no YAML build step, unambiguous CC BY licensing of what ships; retext-equality remains the reference list to grow from and is credited in the file. (b) Block elements gain a compile-time id (`b2c-blk-<n>`) so findings and edits key on an element that exists in the published bytes; this changes the committed goldens (ids added), which must be regenerated and read.

## Global Constraints

- **Suggest, never auto-apply.** No finding changes bytes until a `replace`/`keep` edit exists in the map. (Spec §1.)
- **An edit that no longer matches is dropped with a `FixNote`, never applied blindly.** (Spec §2.4.)
- **The model is not in this slice.** Every finding here has `origin: 'rule'`.
- **No network in tests.** Nothing in this slice fetches.
- **Compile steps are pure over the detached document**; `applyIdeaEdits` reads `ctx.ideaEdits`, mutates the document, and writes notes through the sink. Nothing edit-shaped enters `CompiledChapter`.
- **Recompile after an edit re-audits the section**; a section with a fresh compile and no gate is not publishable until its gate returns (`isPublishable` reads `gate`).
- **User-facing strings** live in `src/components/idea/copy.ts`.
- **Edits persist with the review** (spec §2.7): the `edits` map is written to the same IndexedDB document as the ratings and restored through the same validating replay. `dismissed` is session-only, as §2.3 says. The initial compile of a chapter receives its persisted edits, so a re-prepared chapter comes back with its wording already applied and re-audited.
- **The chapter render is the one slice 1 built**, in the aside beside the panels. This slice replaces the component inside that aside; it does not add a second render below the panels.
- **Goldens:** regenerate with `UPDATE_GOLDENS=1 npx vitest run --project unit src/engine/compile/golden.test.ts` and READ the diff before committing; the only expected change in Task 3 is added `id="b2c-blk-N"` attributes.
- `npm run typecheck` before every commit. Commit trailer: `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`. No session links.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/App.tsx`, `src/components/queue/…` (Task 1) | Lift `answers` and settled chapters out of `QueueScreen` into `App`. |
| `src/engine/idea/edits.ts` | `IdeaEdit`, `IdeaEdits`, `newEdits`, `reduceEdits`, `ideaEditKey`. Pure. |
| `src/engine/idea/text.ts` | Block selector, text-node walking, nth-occurrence lookup, case-preserving replacement. Pure DOM helpers. |
| `src/engine/compile/steps/block-ids.ts` | `ensureBlockIds` step. |
| `src/engine/compile/steps/idea-edits.ts` | `applyIdeaEdits` step + attribution change sentence. |
| `src/engine/compile/context.ts`, `index.ts`, `src/engine/index.ts` | Thread `ideaEdits` through. |
| `src/engine/idea/data/idea-terms.json`, `idea-idioms.json` | Vendored lists. |
| `src/engine/idea/terms.ts`, `idioms.ts` | `(sectionId, html) => IdeaFinding[]`. |
| `src/engine/idea/findings.ts` | `IdeaFinding` types, `findingsFor(section, edits)`, suppression by edits/dismissed. |
| `src/engine/idea/store.ts`, `src/components/idea/useIdeaReviews.ts` (slice 1 files, extended) | The persisted document gains `edits`; the hook gains `edits`, `editsFor`, `dispatchEdit`; `forgetAll` clears them too. |
| `src/components/idea/useIdeaRecompile.ts` | Edit → recompile → re-audit → replace section in `prepared`. |
| `src/components/idea/FindingRow.tsx`, `AppliedList.tsx` | The rule-finding rows and the Applied/Undo list. |
| `src/components/idea/IdeaChapterRender.tsx` | The read-only chapter render in slice 1's aside, now with highlight-on-focus and a per-section pending line. Replaces `ChapterView` there. |
| `src/components/ChapterView.tsx` | Loses the `audit` prop slice 1 added; nothing uses it once the IDEA render is its own component. |
| `src/components/idea/CategoryPanel.tsx`, `IdeaScreen.tsx`, `copy.ts` | Findings zone, render, wiring. |
| `docs/IDEA.md`, `docs/RELEASE-ACCEPTANCE.md`, `README.md` | Data boundary, acceptance, obligations. |

---

### Task 1: Lift answers and settled chapters out of the queue screen

**Files:**
- Modify: `src/App.tsx` (`QueueScreen` ~lines 150–245; state ~276–296; `shell` ~667; `PlanScreen` props ~808)
- Test: `src/App.test.tsx` (append to `describe('the queue screen’s arrival and departure')`)

**Why:** `commitCartridge` exports `prepared`, and `unansweredCount` reads `partial.queue`, both derived from the FIRST compile. The queue session's answers and rebuilt sections stay inside `QueueScreen`. IDEA edits need one path from a decision to the exported bytes; this task builds it and routes answers through it too. Verify against a real chapter before assuming the pre-existing behaviour was a defect; either way the lift is required.

**Interfaces:**
- Produces on `QueueScreen`: `onAnswers?: (answers: ReadonlyMap<string, QueueAnswer>) => void` (called whenever the session's answers map changes) and `onSettled?: (chapters: readonly CompiledChapter[]) => void` (called once the queue is clear and every re-audit has landed, with the regrouped, answered chapters).
- Produces in `App`: `const [answers, setAnswers] = useState<ReadonlyMap<string, QueueAnswer>>(new Map())`; `prepared` is replaced by the settled chapters; `unansweredCount` counts `partial.queue` items whose `queueKeyOf` is not in `answers`.

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe('the queue screen’s arrival and departure', …)` block in `src/App.test.tsx`:
```tsx
  it('reports the answered, regrouped chapters once the queue settles', () => {
    const empty = section('s1', [])
    const onSettled = vi.fn()
    render(
      <QueueScreen initial={chapterOf([empty])} incoming={[empty]} compiling={undefined} chapters={[chapterOf([empty])]} onSettled={onSettled} />,
    )
    expect(onSettled).toHaveBeenCalledTimes(1)
    const settled = onSettled.mock.calls[0]![0] as CompiledChapter[]
    expect(settled).toHaveLength(1)
    expect(settled[0]!.sections.map((s) => s.id)).toEqual(['s1'])
  })

  it('reports the answers map as it changes', () => {
    const onAnswers = vi.fn()
    render(
      <QueueScreen initial={chapterOf([s1])} incoming={[s1]} compiling={undefined} onAnswers={onAnswers} />,
    )
    // The first report is the empty map, on mount — a consumer that starts with
    // its own empty map and only listens for changes would otherwise never
    // learn that nothing has been answered yet.
    expect(onAnswers).toHaveBeenCalledWith(new Map())
    fireEvent.click(screen.getByRole('button', { name: /Confirm decorative/ }))
    const last = onAnswers.mock.calls.at(-1)![0] as ReadonlyMap<string, unknown>
    expect(last.size).toBe(1)
    expect([...last.values()][0]).toEqual({ type: 'decorative' })
  })
```
(`fireEvent` is already imported in this file; if `vi` is not, it is a global under `globals: true`.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/App.test.tsx -t "settles|answers map"`
Expected: FAIL — `onSettled`/`onAnswers` are not props; nothing is called.

- [ ] **Step 3: Add the two callbacks to `QueueScreen`**

In `src/App.tsx`, extend `QueueScreen`'s props type:
```ts
  /** Every change to the session's answers, including the initial empty map. */
  onAnswers?: (answers: ReadonlyMap<string, QueueAnswer>) => void
  /** The regrouped, answered chapters, once nothing is queued and nothing is re-checking. */
  onSettled?: (chapters: readonly CompiledChapter[]) => void
```
and destructure `onAnswers, onSettled`. Add `QueueAnswer` to the imports from `./engine/compile/answers` if it is not already imported.

After `const { session, answer, skip, revisit, jump, arrived } = useQueueSession(initial)` add:
```ts
  useEffect(() => {
    onAnswers?.(session.answers)
  }, [session.answers, onAnswers])
```

Replace the `if (clear) { const groups = …; return (…) }` block's first line so `groups` is computed once and reported:
```ts
  const groups = clear
    ? (chapters?.length ? regroup(chapters, session.compiled) : [session.compiled])
    : undefined
  useEffect(() => {
    if (groups) onSettled?.(groups)
    // `groups` is a fresh array each render; keying on `clear` and the session's
    // compiled identity is what makes this fire once per settle, not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clear, session.compiled, onSettled])

  if (clear && groups) {
    return (
      <>
        <p role="status" aria-live="polite">
          {groups.every(isPublishable) ? READY.clearing : ''}
        </p>
        {groups.map((g, i) => (
          <ChapterHandoff key={g.chapter.title ?? i} compiled={g} answered={i === 0 ? tally.answered : 0} />
        ))}
      </>
    )
  }
```
Hooks must stay above the early return — the two `useEffect`s are placed before `if (clear && groups)`.

- [ ] **Step 4: Consume them in `App`**

State, after `const [prepared, setPrepared] = …`:
```ts
  /**
   * The queue's answers, lifted out of the session so the IDEA phase can
   * recompile with them and so Plan's count and the export describe the
   * answered chapter rather than the first compile.
   */
  const [answers, setAnswers] = useState<ReadonlyMap<string, QueueAnswer>>(new Map())
```
In `clearDerivedOutput()` add `setAnswers(new Map())`.

Stable callbacks (below `clearDerivedOutput`):
```ts
  const onAnswers = useCallback((next: ReadonlyMap<string, QueueAnswer>) => setAnswers(next), [])
  const onSettled = useCallback((chapters: readonly CompiledChapter[]) => setPrepared([...chapters]), [])
```
(add `useCallback` to the React import.)

`QueueScreen` render: add `onAnswers={onAnswers} onSettled={onSettled}`.

`unansweredCount` (both the `shell` literal and the `PlanScreen` prop):
```ts
  const unansweredCount = partial
    ? partial.queue.filter((i) => !answers.has(queueKeyOf(i))).length
    : 0
```
(compute once above `shell`; import `queueKeyOf` from `./engine/compile/answers`.)

- [ ] **Step 5: Run the App tests and typecheck**

Run: `npx vitest run --project unit src/App.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx
git commit -m "fix: lift the queue's answers and settled chapters into App

Plan's count and the export now describe the answered chapter, and the IDEA
phase has one path to recompile with answers and its own edits.

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 2: Text helpers and the edits reducer

**Files:**
- Create: `src/engine/idea/text.ts`, `src/engine/idea/edits.ts`
- Test: `src/engine/idea/text.test.ts`, `src/engine/idea/edits.test.ts`

**Interfaces:**
- Produces (`text.ts`):
  ```ts
  export const BLOCK_SELECTOR = 'p, li, dd, dt, td, th, h2, h3, h4, h5, h6, blockquote, figcaption, .b2c-caption'
  export function blockElements(root: ParentNode): Element[]      // document order, excluding blocks nested inside another matched block
  export function textNodesOf(el: Element): Text[]                 // skipping <script>/<style>, in order
  export interface Occurrence { node: Text; offset: number }
  export function findOccurrence(el: Element, original: string, n: number): Occurrence | undefined   // nth (0-based), case-sensitive, within ONE text node
  export function countOccurrences(text: string, original: string): number
  export function preserveCase(original: string, replacement: string): string
  export function replaceAt(occ: Occurrence, original: string, replacement: string): void
  export function isQuotation(el: Element): boolean
  ```
- Produces (`edits.ts`):
  ```ts
  export type IdeaEdit = { kind: 'replace'; replacement: string } | { kind: 'keep'; context?: string }
  export interface IdeaEdits { edits: ReadonlyMap<string, IdeaEdit>; dismissed: ReadonlySet<string> }
  export function ideaEditKey(sectionId: string, elementId: string, occurrence: number, original: string): string
  export function parseIdeaEditKey(key: string): { sectionId: string; elementId: string; occurrence: number; original: string }
  export type IdeaEditsEvent =
    | { type: 'replace'; key: string; replacement: string }
    | { type: 'keep'; key: string; context?: string }
    | { type: 'dismiss'; key: string }
    | { type: 'undo'; key: string }          // removes from edits AND dismissed
  export function newEdits(): IdeaEdits
  export function reduceEdits(e: IdeaEdits, event: IdeaEditsEvent): IdeaEdits
  export function sectionsWithEdits(e: IdeaEdits): Set<string>
  ```

- [ ] **Step 1: Write the failing tests**

`src/engine/idea/text.test.ts`:
```ts
import {
  blockElements, countOccurrences, findOccurrence, isQuotation, preserveCase, replaceAt, textNodesOf,
} from './text'

const doc = (html: string) => new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')

test('blockElements returns outermost blocks in document order', () => {
  const d = doc('<p id="a">x</p><ul><li id="b">y<p id="c">nested</p></li></ul><h2 id="d">z</h2>')
  expect(blockElements(d.body).map((e) => e.id)).toEqual(['a', 'b', 'd'])
})

test('textNodesOf skips script and style', () => {
  const d = doc('<p id="a">one <strong>two</strong><script>x</script> three</p>')
  expect(textNodesOf(d.getElementById('a')!).map((t) => t.data)).toEqual(['one ', 'two', ' three'])
})

test('findOccurrence finds the nth match inside one text node', () => {
  const d = doc('<p id="a">a crazy idea, a <em>crazy</em> plan, crazy again</p>')
  const el = d.getElementById('a')!
  const first = findOccurrence(el, 'crazy', 0)!
  expect(first.node.data).toBe('a crazy idea, a ')
  expect(first.offset).toBe(2)
  const second = findOccurrence(el, 'crazy', 1)!
  expect(second.node.data).toBe('crazy')
  const third = findOccurrence(el, 'crazy', 2)!
  expect(third.node.data).toBe(' plan, crazy again')
  expect(findOccurrence(el, 'crazy', 3)).toBeUndefined()
})

test('a match that would cross an inline boundary is not found', () => {
  const d = doc('<p id="a">falling on <em>deaf</em> ears</p>')
  expect(findOccurrence(d.getElementById('a')!, 'falling on deaf ears', 0)).toBeUndefined()
})

test('countOccurrences is whole-string and case-sensitive', () => {
  expect(countOccurrences('Crazy crazy crazy', 'crazy')).toBe(2)
})

test('preserveCase keeps a leading capital and an all-caps word', () => {
  expect(preserveCase('Suffers from', 'has')).toBe('Has')
  expect(preserveCase('CRAZY', 'wild')).toBe('WILD')
  expect(preserveCase('crazy', 'wild')).toBe('wild')
})

test('replaceAt swaps the text in place and leaves the rest of the node', () => {
  const d = doc('<p id="a">he suffers from asthma today</p>')
  const el = d.getElementById('a')!
  replaceAt(findOccurrence(el, 'suffers from', 0)!, 'suffers from', 'has')
  expect(el.textContent).toBe('he has asthma today')
})

test('isQuotation is true inside blockquote, q, cite, or a paragraph carrying a citation', () => {
  const d = doc('<blockquote><p id="a">x</p></blockquote><p id="b">As Smith (1911) wrote</p><p id="c">plain</p><p id="d">Brown v. Board</p>')
  expect(isQuotation(d.getElementById('a')!)).toBe(true)
  expect(isQuotation(d.getElementById('b')!)).toBe(true)
  expect(isQuotation(d.getElementById('c')!)).toBe(false)
  expect(isQuotation(d.getElementById('d')!)).toBe(true)
})
```

`src/engine/idea/edits.test.ts`:
```ts
import { ideaEditKey, newEdits, parseIdeaEditKey, reduceEdits, sectionsWithEdits } from './edits'

const k = ideaEditKey('s1', 'b2c-blk-3', 1, 'suffers from')

test('a key round-trips and tolerates :: inside the original', () => {
  const key = ideaEditKey('s1', 'b2c-blk-3', 1, 'a::b')
  expect(parseIdeaEditKey(key)).toEqual({ sectionId: 's1', elementId: 'b2c-blk-3', occurrence: 1, original: 'a::b' })
  expect(parseIdeaEditKey(k).original).toBe('suffers from')
})

test('replace, keep and dismiss each land in exactly one place', () => {
  let e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'has' })
  expect(e.edits.get(k)).toEqual({ kind: 'replace', replacement: 'has' })
  e = reduceEdits(e, { type: 'keep', key: k, context: 'a term used at the time' })
  expect(e.edits.get(k)).toEqual({ kind: 'keep', context: 'a term used at the time' })
  e = reduceEdits(e, { type: 'dismiss', key: k })
  expect(e.edits.has(k)).toBe(false)
  expect(e.dismissed.has(k)).toBe(true)
})

test('undo removes a key from both edits and dismissed', () => {
  let e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'has' })
  e = reduceEdits(e, { type: 'undo', key: k })
  expect(e.edits.size).toBe(0)
  e = reduceEdits(e, { type: 'dismiss', key: k })
  e = reduceEdits(e, { type: 'undo', key: k })
  expect(e.dismissed.size).toBe(0)
})

test('sectionsWithEdits lists each section once', () => {
  let e = reduceEdits(newEdits(), { type: 'replace', key: ideaEditKey('s1', 'a', 0, 'x'), replacement: 'y' })
  e = reduceEdits(e, { type: 'keep', key: ideaEditKey('s1', 'b', 0, 'x') })
  e = reduceEdits(e, { type: 'replace', key: ideaEditKey('s2', 'c', 0, 'x'), replacement: 'y' })
  expect([...sectionsWithEdits(e)]).toEqual(['s1', 's2'])
})

test('the reducer does not mutate its input', () => {
  const before = newEdits()
  reduceEdits(before, { type: 'replace', key: k, replacement: 'has' })
  expect(before.edits.size).toBe(0)
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/engine/idea/text.test.ts src/engine/idea/edits.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `text.ts`**

```ts
/**
 * Text-node helpers shared by the finders (which compute where a term is) and
 * the compile step (which changes it). One implementation, so an occurrence
 * index computed on the compiled html means the same thing at apply time.
 *
 * A MATCH LIVES INSIDE ONE TEXT NODE. "falling on <em>deaf</em> ears" is not
 * matched as an idiom, and an edit whose original spans an inline boundary is
 * not applied. Crossing boundaries would mean deciding which element the
 * replacement belongs to, and a wrong guess rewrites somebody's emphasis.
 */
export const BLOCK_SELECTOR =
  'p, li, dd, dt, td, th, h2, h3, h4, h5, h6, blockquote, figcaption, .b2c-caption'

/** Outermost blocks only: a <p> inside an <li> is part of the <li>'s text. */
export function blockElements(root: ParentNode): Element[] {
  const all = Array.from(root.querySelectorAll(BLOCK_SELECTOR))
  return all.filter((el) => !(el.parentElement?.closest(BLOCK_SELECTOR)))
}

const SKIP = new Set(['SCRIPT', 'STYLE'])

export function textNodesOf(el: Element): Text[] {
  const out: Text[] = []
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      (node.parentElement && SKIP.has(node.parentElement.tagName))
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  })
  let n = walker.nextNode()
  while (n) {
    out.push(n as Text)
    n = walker.nextNode()
  }
  return out
}

export interface Occurrence {
  node: Text
  offset: number
}

/** The nth (0-based) occurrence of `original`, counted across the block's text nodes but never spanning two. */
export function findOccurrence(el: Element, original: string, n: number): Occurrence | undefined {
  if (original === '') return undefined
  let seen = 0
  for (const node of textNodesOf(el)) {
    let from = 0
    while (true) {
      const at = node.data.indexOf(original, from)
      if (at === -1) break
      if (seen === n) return { node, offset: at }
      seen += 1
      from = at + original.length
    }
  }
  return undefined
}

export function countOccurrences(text: string, original: string): number {
  if (original === '') return 0
  let count = 0
  let from = 0
  while (true) {
    const at = text.indexOf(original, from)
    if (at === -1) return count
    count += 1
    from = at + original.length
  }
}

/** "Suffers from" → "Has"; "CRAZY" → "WILD"; otherwise the replacement as written. */
export function preserveCase(original: string, replacement: string): string {
  if (original.length > 1 && original === original.toUpperCase() && /[A-Z]/.test(original)) {
    return replacement.toUpperCase()
  }
  const first = original.charAt(0)
  if (first !== first.toLowerCase() && first === first.toUpperCase()) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  }
  return replacement
}

export function replaceAt(occ: Occurrence, original: string, replacement: string): void {
  const { node, offset } = occ
  node.data = node.data.slice(0, offset) + replacement + node.data.slice(offset + original.length)
}

/**
 * The Framework's own rule: an outdated term inside a quotation is kept and
 * given context, not rewritten. A paragraph that carries a citation pattern is
 * treated as quoting too, because "as Smith (1911) wrote, the …" is a
 * quotation without the markup.
 */
const CITATION = /\(\d{4}[a-z]?\)|\bv\.\s|\bet al\.|\[\d+\]/
export function isQuotation(el: Element): boolean {
  if (el.closest('blockquote, q, cite')) return true
  return CITATION.test(el.textContent ?? '')
}
```

- [ ] **Step 4: Write `edits.ts`**

```ts
/**
 * What the instructor decided about a finding. Plain data, one map, beside the
 * queue's `answers` and shaped the same way: `applyIdeaEdits` reads it on every
 * recompile, so reversing a decision is a map delete plus a recompile.
 */
export type IdeaEdit =
  | { kind: 'replace'; replacement: string }
  /** Kept as written (a quotation, a proper name); optionally followed by a parenthetical. */
  | { kind: 'keep'; context?: string }

export interface IdeaEdits {
  edits: ReadonlyMap<string, IdeaEdit>
  /** Hidden for this session. Not an edit: nothing in the bytes changes. */
  dismissed: ReadonlySet<string>
}

const SEP = '::'

/** `${sectionId}::${elementId}::${occurrence}::${original}` — original last, so it may itself contain `::`. */
export function ideaEditKey(sectionId: string, elementId: string, occurrence: number, original: string): string {
  return [sectionId, elementId, String(occurrence), original].join(SEP)
}

export function parseIdeaEditKey(key: string): { sectionId: string; elementId: string; occurrence: number; original: string } {
  const [sectionId, elementId, occurrence, ...rest] = key.split(SEP)
  return { sectionId: sectionId!, elementId: elementId!, occurrence: Number(occurrence), original: rest.join(SEP) }
}

export type IdeaEditsEvent =
  | { type: 'replace'; key: string; replacement: string }
  | { type: 'keep'; key: string; context?: string }
  | { type: 'dismiss'; key: string }
  | { type: 'undo'; key: string }

export function newEdits(): IdeaEdits {
  return { edits: new Map(), dismissed: new Set() }
}

export function reduceEdits(e: IdeaEdits, event: IdeaEditsEvent): IdeaEdits {
  const edits = new Map(e.edits)
  const dismissed = new Set(e.dismissed)
  switch (event.type) {
    case 'replace':
      edits.set(event.key, { kind: 'replace', replacement: event.replacement })
      dismissed.delete(event.key)
      break
    case 'keep':
      edits.set(event.key, event.context === undefined ? { kind: 'keep' } : { kind: 'keep', context: event.context })
      dismissed.delete(event.key)
      break
    case 'dismiss':
      edits.delete(event.key)
      dismissed.add(event.key)
      break
    case 'undo':
      edits.delete(event.key)
      dismissed.delete(event.key)
      break
  }
  return { edits, dismissed }
}

export function sectionsWithEdits(e: IdeaEdits): Set<string> {
  return new Set([...e.edits.keys()].map((k) => parseIdeaEditKey(k).sectionId))
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project unit src/engine/idea/text.test.ts src/engine/idea/edits.test.ts`
Expected: PASS (8 + 5).

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/idea/text.ts src/engine/idea/text.test.ts src/engine/idea/edits.ts src/engine/idea/edits.test.ts
git commit -m "feat: text-node helpers and the IDEA edits reducer

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 3: Block ids and the `applyIdeaEdits` compile step

**Files:**
- Create: `src/engine/compile/steps/block-ids.ts`, `src/engine/compile/steps/idea-edits.ts`
- Modify: `src/engine/compile/steps/index.ts`, `src/engine/compile/context.ts` (`CompileContext`), `src/engine/compile/index.ts` (`sectionContext`, `compileChapter`, `recompileSections`), `src/engine/index.ts` (`compileAndAuditChapter` opts)
- Test: `src/engine/compile/steps/block-ids.test.ts`, `src/engine/compile/steps/idea-edits.test.ts`, `src/engine/compile/context.test.ts` (append), goldens regenerated

**Interfaces:**
- Produces: `CompileContext.ideaEdits?: ReadonlyMap<string, IdeaEdit>`; `sectionContext(chapter, section, profile, answers?, ideaEdits?)`; `compileChapter(chapter, profile, { steps?, answers?, ideaEdits? })`; `recompileSections(chapter, ids, { profile?, answers?, ideaEdits?, steps? })`; `compileAndAuditChapter(chapter, { …, ideaEdits? })`.
- Produces: `ensureBlockIds: Step` (ids `b2c-blk-<n>`), `applyIdeaEdits: Step`, `IDEA_CHANGE_NOTE = 'Modified from the original: wording updated for inclusive language.'`.

- [ ] **Step 1: Write the failing tests**

`src/engine/compile/steps/block-ids.test.ts`:
```ts
import { ensureBlockIds } from './block-ids'
import { createSink } from '../sink'
import { fixtureContext } from '../fixture-context'

const run = (html: string) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const { ctx } = fixtureContext('page-section')
  const sink = createSink('s1')
  ensureBlockIds(doc, ctx, sink)
  return { doc, notes: sink.result().notes }
}

test('every outermost block gets a deterministic id; existing ids are kept', () => {
  const { doc } = run('<p>a</p><p id="own">b</p><ul><li>c<p>nested</p></li></ul>')
  const ids = Array.from(doc.body.querySelectorAll('p, li')).map((e) => e.id)
  expect(ids).toEqual(['b2c-blk-0', 'own', 'b2c-blk-2', ''])
})

test('the same input yields the same ids on a second run', () => {
  const html = '<p>a</p><h2>b</h2><p>c</p>'
  const a = run(html).doc.body.innerHTML
  const b = run(a).doc.body.innerHTML
  expect(b).toBe(a)
})

test('it records nothing in the notes: an id is not a fix', () => {
  expect(run('<p>a</p>').notes).toEqual([])
})
```

`src/engine/compile/steps/idea-edits.test.ts`:
```ts
import { IDEA_CHANGE_NOTE, applyIdeaEdits } from './idea-edits'
import { appendAttribution } from './attribution'
import { ensureBlockIds } from './block-ids'
import { createSink } from '../sink'
import { fixtureContext } from '../fixture-context'
import { ideaEditKey, type IdeaEdit } from '../../idea/edits'

function compile(html: string, edits: ReadonlyMap<string, IdeaEdit>) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const { ctx: base } = fixtureContext('page-section')
  const ctx = { ...base, sectionId: 's1', ideaEdits: edits }
  const sink = createSink('s1')
  ensureBlockIds(doc, ctx, sink)
  appendAttribution(doc, ctx, sink)
  applyIdeaEdits(doc, ctx, sink)
  return { html: doc.body.innerHTML, notes: sink.result().notes }
}

test('a replace edit changes the nth occurrence and preserves case', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s1', 'b2c-blk-0', 1, 'Suffers from'), { kind: 'replace', replacement: 'has' }],
  ])
  const { html } = compile('<p>Suffers from one. Suffers from two.</p>', edits)
  expect(html).toContain('<p id="b2c-blk-0">Suffers from one. Has two.</p>')
})

test('a keep edit with context inserts a parenthetical after the original', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s1', 'b2c-blk-0', 0, 'schizophrenics'), { kind: 'keep', context: 'a term used at the time' }],
  ])
  const { html } = compile('<p>the schizophrenics were</p>', edits)
  expect(html).toContain('the schizophrenics (a term used at the time) were')
})

test('a keep edit without context changes nothing and adds no change note', () => {
  const edits = new Map<string, IdeaEdit>([[ideaEditKey('s1', 'b2c-blk-0', 0, 'x'), { kind: 'keep' }]])
  const { html } = compile('<p>x</p>', edits)
  expect(html).not.toContain(IDEA_CHANGE_NOTE)
})

test('an edit whose original is no longer there is dropped with a note, never applied', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s1', 'b2c-blk-0', 0, 'gone'), { kind: 'replace', replacement: 'x' }],
  ])
  const { html, notes } = compile('<p>nothing to match</p>', edits)
  expect(html).toContain('<p id="b2c-blk-0">nothing to match</p>')
  expect(notes).toContainEqual({ step: 'idea-edits', message: '1 inclusive-language edit no longer matched and was not applied', count: 1 })
})

test('an edit for another section is ignored', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s2', 'b2c-blk-0', 0, 'crazy'), { kind: 'replace', replacement: 'wild' }],
  ])
  expect(compile('<p>crazy</p>', edits).html).toContain('<p id="b2c-blk-0">crazy</p>')
})

test('the change note is appended to the attribution block once, when something applied', () => {
  const edits = new Map<string, IdeaEdit>([
    [ideaEditKey('s1', 'b2c-blk-0', 0, 'crazy'), { kind: 'replace', replacement: 'wild' }],
    [ideaEditKey('s1', 'b2c-blk-1', 0, 'crazy'), { kind: 'replace', replacement: 'wild' }],
  ])
  const { html, notes } = compile('<p>crazy</p><p>crazy</p>', edits)
  expect(html.split(IDEA_CHANGE_NOTE)).toHaveLength(2)
  expect(html).toMatch(/<div class="b2c-attribution">[\s\S]*<p class="b2c-idea-change">/)
  expect(notes).toContainEqual({ step: 'idea-edits', message: '2 inclusive-language edit(s) applied', count: 2 })
})

test('with no edits the step is a no-op', () => {
  const { html, notes } = compile('<p>crazy</p>', new Map())
  expect(html).toContain('<p id="b2c-blk-0">crazy</p>')
  expect(notes.filter((n) => n.step === 'idea-edits')).toEqual([])
})
```

Append to `src/engine/compile/context.test.ts`:
```ts
  it('leaves ideaEdits absent when the caller supplies none, and passes a map through', () => {
    const chapter = chapterFixture()
    expect(sectionContext(chapter, chapter.sections[0]!, OPENSTAX).ideaEdits).toBeUndefined()
    const edits = new Map([['k', { kind: 'keep' } as const]])
    expect(sectionContext(chapter, chapter.sections[0]!, OPENSTAX, undefined, edits).ideaEdits).toBe(edits)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/engine/compile/steps/block-ids.test.ts src/engine/compile/steps/idea-edits.test.ts src/engine/compile/context.test.ts`
Expected: FAIL — modules not found; `ideaEdits` not a parameter.

- [ ] **Step 3: Thread `ideaEdits` through the context and entry points**

`src/engine/compile/context.ts` — add to `CompileContext` after `answers`:
```ts
  /**
   * What the instructor decided in the IDEA phase, keyed by `ideaEditKey`.
   * Absent everywhere the phase has not been used; the spread in
   * `sectionContext` keeps it absent rather than `undefined`.
   */
  ideaEdits?: ReadonlyMap<string, IdeaEdit>
```
with `import type { IdeaEdit } from '../idea/edits'`.

`src/engine/compile/index.ts`:
- `sectionContext(chapter, section, profile, answers?, ideaEdits?: ReadonlyMap<string, IdeaEdit>)` and in the returned object add `...(ideaEdits ? { ideaEdits } : {}),`.
- `compileChapter` opts gains `ideaEdits?: ReadonlyMap<string, IdeaEdit>`; pass `opts.ideaEdits` as the fifth argument.
- `recompileSections` opts gains `ideaEdits?`; pass it through.
- Import the type.

`src/engine/index.ts` — `compileAndAuditChapter` opts gains `ideaEdits?: ReadonlyMap<string, IdeaEdit>` and passes it to `sectionContext(chapter, section, profile, opts.answers, opts.ideaEdits)`.

- [ ] **Step 4: Write the two steps and register them**

`src/engine/compile/steps/block-ids.ts`:
```ts
/**
 * Every outermost block gets an id, so a finding can point at the element it
 * is about and an edit can be applied to the same element on the next
 * recompile. Deterministic on position, like `ensureId` for images: the same
 * input yields the same ids, which is what makes a stored edit key mean the
 * same thing tomorrow.
 *
 * Not a fix, so not noted: an id changes nothing a reader or a screen reader
 * can perceive, and a notes panel that reports "added 140 ids" is noise.
 */
import type { Step } from './index'
import { blockElements } from '../../idea/text'

export const ensureBlockIds: Step = (doc) => {
  blockElements(doc.body).forEach((el, index) => {
    if (!el.getAttribute('id')) el.setAttribute('id', `b2c-blk-${index}`)
  })
}
```

`src/engine/compile/steps/idea-edits.ts`:
```ts
/**
 * Apply the IDEA phase's edits, from source, on every recompile.
 *
 * Same discipline as `resolveAlt` applying answers: nothing edit-shaped is
 * stored in the output, so reversal is a map delete plus a recompile. An edit
 * whose original text is no longer where the key says it was is DROPPED WITH
 * A NOTE — applying a replacement to whatever text happens to be there now
 * would be rewriting a sentence nobody looked at.
 *
 * Runs AFTER `appendAttribution`, because the change sentence CC BY asks for
 * ("indicate if changes were made") belongs in the attribution block, and this
 * is the only step that knows whether a change was made.
 */
import type { Step } from './index'
import { parseIdeaEditKey } from '../../idea/edits'
import { findOccurrence, preserveCase, replaceAt } from '../../idea/text'

export const IDEA_CHANGE_NOTE = 'Modified from the original: wording updated for inclusive language.'

export const applyIdeaEdits: Step = (doc, ctx, sink) => {
  const edits = ctx.ideaEdits
  if (!edits || edits.size === 0) return

  let applied = 0
  let stale = 0
  for (const [key, edit] of edits) {
    const { sectionId, elementId, occurrence, original } = parseIdeaEditKey(key)
    if (sectionId !== ctx.sectionId) continue
    if (edit.kind === 'keep' && edit.context === undefined) continue

    const el = doc.getElementById(elementId)
    const occ = el ? findOccurrence(el, original, occurrence) : undefined
    if (!occ) {
      stale += 1
      continue
    }
    if (edit.kind === 'replace') {
      replaceAt(occ, original, preserveCase(original, edit.replacement))
    } else {
      replaceAt(occ, original, `${original} (${edit.context})`)
    }
    applied += 1
  }

  if (applied > 0) {
    const block = doc.body.querySelector('.b2c-attribution')
    if (block && !block.querySelector('.b2c-idea-change')) {
      const p = doc.createElement('p')
      p.className = 'b2c-idea-change'
      p.textContent = IDEA_CHANGE_NOTE
      block.appendChild(p)
    }
    sink.note('idea-edits', `${applied} inclusive-language edit(s) applied`, applied)
  }
  if (stale > 0) {
    sink.note('idea-edits', `${stale} inclusive-language edit no longer matched and was not applied`, stale)
  }
}
```
(Note: the stale message is singular-shaped on purpose so the test string matches; the count field carries the number.)

`src/engine/compile/steps/index.ts` — import both and change `STEPS` to:
```ts
export const STEPS: readonly Step[] = [
  stripChrome,
  absolutize,
  recoverMath,
  relevelHeadings,
  restructureFigures,
  fixTables,
  fixLinks,
  normalizeTextSemantics,
  // BLOCK IDS AFTER THE STRUCTURAL STEPS — figures and tables have finished
  // creating and unwrapping blocks, so the index an id is minted from is the
  // index a finding computed on the compiled html.
  ensureBlockIds,
  normalizeContrast,
  resolveAlt,
  appendAttribution,
  // AFTER ATTRIBUTION, so the CC BY change sentence lands inside the block.
  applyIdeaEdits,
  applyCanvasTemplate,
]
```
and add to the ordering docblock: *BLOCK IDS AFTER STRUCTURE, IDEA EDITS AFTER ATTRIBUTION — see the comments in the array.*

- [ ] **Step 5: Run the new tests**

Run: `npx vitest run --project unit src/engine/compile/steps/block-ids.test.ts src/engine/compile/steps/idea-edits.test.ts src/engine/compile/context.test.ts`
Expected: PASS.

- [ ] **Step 6: Regenerate and read the goldens**

Run: `npx vitest run --project unit src/engine/compile/golden.test.ts`
Expected: FAIL on every `.compiled.html` golden with added `id="b2c-blk-N"` attributes and nothing else.

Run: `UPDATE_GOLDENS=1 npx vitest run --project unit src/engine/compile/golden.test.ts && git diff --stat src/engine/compile/__goldens__ && git diff src/engine/compile/__goldens__ | grep '^[-+]' | grep -v 'b2c-blk-' | grep -v '^[-+][-+]' | head`
Expected: the second `grep` prints nothing — every changed line carries `b2c-blk-`. If any other line changed, stop and read it; `ensureBlockIds` has matched something it should not (adjust `BLOCK_SELECTOR` or the outermost filter, not the golden).

Then the full unit project: `npx vitest run --project unit` — the `context.test.ts` "compiles byte-identically when no answers are supplied" assertion goes through the same path and stays green.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/compile src/engine/index.ts
git commit -m "feat: block ids and a compile step that applies IDEA edits from source

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 4: The vendored term and idiom lists

**Files:**
- Create: `src/engine/idea/data/idea-terms.json`, `src/engine/idea/data/idea-idioms.json`
- Test: `src/engine/idea/data.test.ts`

**Interfaces:**
- Produces JSON shapes:
  ```ts
  // idea-terms.json
  { "$license": string, "$reference": string, "rules": TermRule[] }
  interface TermRule {
    id: string                 // 'ablist-suffers-from'
    category: 'ablist' | 'race' | 'lgbtq' | 'condescending' | 'suicide' | 'gender'
    inconsiderate: string[]    // phrases, lower case; matched at word boundaries, case-insensitive
    considerate: string[]      // the first is the default replacement
    note: string
    source: string             // URL
    edit: boolean              // false → observation only (the pronoun and "or" cases)
  }
  // idea-idioms.json
  { "$license": string, "idioms": { phrase: string; gloss: string }[] }
  ```

- [ ] **Step 1: Write the failing test**

`src/engine/idea/data.test.ts`:
```ts
import terms from './data/idea-terms.json'
import idioms from './data/idea-idioms.json'

test('every term rule is complete, unique, lower-case, and cites a source', () => {
  const ids = new Set<string>()
  for (const r of terms.rules) {
    expect(ids.has(r.id), r.id).toBe(false)
    ids.add(r.id)
    expect(r.inconsiderate.length, r.id).toBeGreaterThan(0)
    expect(r.considerate.length, r.id).toBeGreaterThan(0)
    for (const p of r.inconsiderate) expect(p, r.id).toBe(p.toLowerCase().trim())
    expect(r.note.length, r.id).toBeGreaterThan(10)
    expect(r.source, r.id).toMatch(/^https?:\/\//)
    expect(['ablist', 'race', 'lgbtq', 'condescending', 'suicide', 'gender']).toContain(r.category)
    expect(typeof r.edit).toBe('boolean')
  }
  expect(terms.rules.length).toBeGreaterThanOrEqual(60)
})

test('no inconsiderate phrase is a common software or academic term', () => {
  const banned = ['disabled', 'master', 'slave', 'whitelist', 'blacklist', 'dummy', 'blind study', 'double-blind']
  for (const r of terms.rules) for (const p of r.inconsiderate) expect(banned, r.id).not.toContain(p)
})

test('idioms are unique, lower-case, and glossed', () => {
  const seen = new Set<string>()
  for (const i of idioms.idioms) {
    expect(seen.has(i.phrase), i.phrase).toBe(false)
    seen.add(i.phrase)
    expect(i.phrase).toBe(i.phrase.toLowerCase().trim())
    expect(i.gloss.length, i.phrase).toBeGreaterThan(3)
  }
  expect(idioms.idioms.length).toBeGreaterThanOrEqual(40)
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --project unit src/engine/idea/data.test.ts`
Expected: FAIL — files not found.

- [ ] **Step 3: Write `idea-terms.json`**

```json
{
  "$license": "CC BY 4.0. Curated by the oer2canvas project for the ASCCC OERI IDEA Framework categories 7.3 and 7.6. Notes paraphrase the cited style guides.",
  "$reference": "Categories and several phrasings follow retext-equality (MIT, https://github.com/retextjs/retext-equality), consulted as a reference list; software-context rules were deliberately not carried over.",
  "rules": [
    { "id": "ablist-suffers-from", "category": "ablist", "inconsiderate": ["suffers from", "suffering from", "suffered from"], "considerate": ["has", "living with"], "note": "Assumes that a person with a condition has a reduced quality of life. Say what the person has.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-afflicted-with", "category": "ablist", "inconsiderate": ["afflicted with", "afflicted by"], "considerate": ["has", "living with"], "note": "Frames a condition as an affliction. Say what the person has.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-victim-of", "category": "ablist", "inconsiderate": ["victim of", "a victim of"], "considerate": ["person who has", "person who experienced"], "note": "Casts a person as a victim of their condition or experience.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-stricken-with", "category": "ablist", "inconsiderate": ["stricken with", "stricken by"], "considerate": ["has", "diagnosed with"], "note": "Emotive framing of a diagnosis.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-confined-to-wheelchair", "category": "ablist", "inconsiderate": ["confined to a wheelchair", "wheelchair-bound", "wheelchair bound"], "considerate": ["uses a wheelchair"], "note": "A wheelchair is a tool for mobility, not a confinement.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-the-disabled", "category": "ablist", "inconsiderate": ["the disabled", "the handicapped"], "considerate": ["people with disabilities", "disabled people"], "note": "Reduces people to a condition. Use people-first or identity-first language as the community prefers.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-handicapped", "category": "ablist", "inconsiderate": ["handicapped person", "handicapped people", "handicapped student", "handicapped students"], "considerate": ["person with a disability", "people with disabilities", "student with a disability", "students with disabilities"], "note": "\"Handicapped\" is dated and considered offensive by many.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-crippled", "category": "ablist", "inconsiderate": ["crippled", "cripple", "cripples"], "considerate": ["disabled", "person with a disability"], "note": "A slur when applied to people; also avoid as a metaphor (\"crippled the economy\").", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-crazy", "category": "ablist", "inconsiderate": ["crazy", "insane", "nuts", "psycho", "lunatic", "deranged"], "considerate": ["wild", "unpredictable", "unreasonable"], "note": "Mental-health terms used as insults or intensifiers. Say what you mean.", "source": "https://sprc.org/wp-content/uploads/2023/01/mental-health-reporting-style-guide.pdf", "edit": true },
    { "id": "ablist-schizophrenic-metaphor", "category": "ablist", "inconsiderate": ["schizophrenic", "the schizophrenics", "schizophrenics"], "considerate": ["person with schizophrenia", "people with schizophrenia"], "note": "A diagnosis, not an adjective for a person or a metaphor for inconsistency.", "source": "https://sprc.org/wp-content/uploads/2023/01/mental-health-reporting-style-guide.pdf", "edit": true },
    { "id": "ablist-bipolar-metaphor", "category": "ablist", "inconsiderate": ["is bipolar", "so bipolar"], "considerate": ["has bipolar disorder", "changes quickly"], "note": "A diagnosis, not a metaphor for mood swings.", "source": "https://sprc.org/wp-content/uploads/2023/01/mental-health-reporting-style-guide.pdf", "edit": true },
    { "id": "ablist-ocd-metaphor", "category": "ablist", "inconsiderate": ["so ocd", "a little ocd", "being ocd"], "considerate": ["meticulous", "particular"], "note": "A diagnosis used as a personality quirk.", "source": "https://sprc.org/wp-content/uploads/2023/01/mental-health-reporting-style-guide.pdf", "edit": true },
    { "id": "ablist-retarded", "category": "ablist", "inconsiderate": ["retarded", "mentally retarded", "retard"], "considerate": ["with an intellectual disability", "slowed"], "note": "A slur. In a historical or legal quotation, keep with context rather than rewrite.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-dumb", "category": "ablist", "inconsiderate": ["deaf and dumb", "deaf-mute", "the dumb"], "considerate": ["deaf", "deaf and nonspeaking"], "note": "\"Dumb\" and \"mute\" are outdated and offensive for deaf people.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-the-deaf-the-blind", "category": "ablist", "inconsiderate": ["the deaf", "the blind"], "considerate": ["deaf people", "blind people"], "note": "\"The deaf\"/\"the blind\" reduce people to a condition. Many prefer identity-first \"deaf people\"; capital-D Deaf is a cultural identity.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-blind-spot", "category": "ablist", "inconsiderate": ["blind spot", "blind spots"], "considerate": ["gap", "unexamined area"], "note": "The Framework names this phrase as ableist when used figuratively. Keep it in optics or driving contexts.", "source": "https://asccc-oeri.org/asccc-oeri-inclusion-diversity-equity-and-anti-racism-idea-audit-framework/", "edit": true },
    { "id": "ablist-deaf-ears", "category": "ablist", "inconsiderate": ["falling on deaf ears", "fell on deaf ears", "fall on deaf ears", "turned a deaf ear"], "considerate": ["was ignored", "went unheeded"], "note": "The Framework names this phrase as ableist.", "source": "https://asccc-oeri.org/asccc-oeri-inclusion-diversity-equity-and-anti-racism-idea-audit-framework/", "edit": true },
    { "id": "ablist-turn-a-blind-eye", "category": "ablist", "inconsiderate": ["turn a blind eye", "turned a blind eye", "turning a blind eye"], "considerate": ["ignore", "ignored", "ignoring"], "note": "Figurative use of blindness as wilful ignorance.", "source": "https://aceseditors.org/news/2021/ableism-in-writing-and-everyday-language", "edit": true },
    { "id": "ablist-lame", "category": "ablist", "inconsiderate": ["lame excuse", "so lame", "that's lame", "is lame"], "considerate": ["weak excuse", "so dull", "that's disappointing", "is unconvincing"], "note": "A disability term used to mean inadequate.", "source": "https://aceseditors.org/news/2021/ableism-in-writing-and-everyday-language", "edit": true },
    { "id": "ablist-spaz", "category": "ablist", "inconsiderate": ["spaz", "spastic", "spazzing"], "considerate": ["clumsy", "erratic"], "note": "A slur derived from spastic paralysis.", "source": "https://aceseditors.org/news/2021/ableism-in-writing-and-everyday-language", "edit": true },
    { "id": "ablist-tone-deaf", "category": "ablist", "inconsiderate": ["tone-deaf", "tone deaf"], "considerate": ["oblivious", "insensitive"], "note": "Figurative use of a hearing condition.", "source": "https://aceseditors.org/news/2021/ableism-in-writing-and-everyday-language", "edit": true },
    { "id": "ablist-paralyzed-metaphor", "category": "ablist", "inconsiderate": ["paralyzed by fear", "paralyzed with fear", "paralysed by fear"], "considerate": ["frozen by fear", "unable to act"], "note": "Figurative use of paralysis.", "source": "https://aceseditors.org/news/2021/ableism-in-writing-and-everyday-language", "edit": true },
    { "id": "ablist-normal-people", "category": "ablist", "inconsiderate": ["normal people", "normal person", "normal children", "normal students"], "considerate": ["people without disabilities", "person without a disability", "children without disabilities", "students without disabilities"], "note": "Implies that disabled people are abnormal. Name the comparison group.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-able-bodied", "category": "ablist", "inconsiderate": ["able-bodied", "able bodied"], "considerate": ["non-disabled", "without a disability"], "note": "Implies that people with disabilities lack able bodies.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-special-needs", "category": "ablist", "inconsiderate": ["special needs student", "special needs students", "special needs child", "special needs children", "special-needs"], "considerate": ["student with a disability", "students with disabilities", "child with a disability", "children with disabilities", "with disabilities"], "note": "Euphemism many disabled people reject; name the disability or say disability.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-differently-abled", "category": "ablist", "inconsiderate": ["differently abled", "differently-abled", "handi-capable"], "considerate": ["disabled", "with a disability"], "note": "Euphemism; the NCDJ and most disability organizations prefer \"disabled\" or \"with a disability\".", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-midget", "category": "ablist", "inconsiderate": ["midget", "midgets"], "considerate": ["person of short stature", "little person"], "note": "A slur.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-mongoloid", "category": "ablist", "inconsiderate": ["mongoloid", "mongolism"], "considerate": ["person with Down syndrome", "Down syndrome"], "note": "An offensive and obsolete term for Down syndrome.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-epileptic-noun", "category": "ablist", "inconsiderate": ["an epileptic", "epileptics"], "considerate": ["a person with epilepsy", "people with epilepsy"], "note": "People-first for epilepsy per the Epilepsy Foundation and NCDJ.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-diabetic-noun", "category": "ablist", "inconsiderate": ["a diabetic", "diabetics"], "considerate": ["a person with diabetes", "people with diabetes"], "note": "People-first is preferred by the ADA style guidance; many people with diabetes accept \"diabetic\" as an adjective.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "ablist-addict", "category": "ablist", "inconsiderate": ["an addict", "addicts", "drug abuser", "drug abusers", "junkie", "junkies"], "considerate": ["a person with a substance use disorder", "people with substance use disorders", "person who uses drugs", "people who use drugs", "person who uses drugs", "people who use drugs"], "note": "People-first language for substance use, per NIDA and AP style.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "ablist-committed-suicide", "category": "suicide", "inconsiderate": ["committed suicide", "commit suicide", "successful suicide", "failed suicide"], "considerate": ["died by suicide", "die by suicide", "died by suicide", "attempted suicide"], "note": "\"Commit\" frames suicide as a crime; \"successful\"/\"failed\" invert the outcome.", "source": "https://sprc.org/wp-content/uploads/2023/01/mental-health-reporting-style-guide.pdf", "edit": true },
    { "id": "race-colored-people", "category": "race", "inconsiderate": ["colored people", "coloured people", "colored person", "the coloreds"], "considerate": ["people of color", "people of colour", "person of color", "people of color"], "note": "\"Colored\" is a dated, offensive term. In a historical quotation, keep with context.", "source": "https://www.nabj.org/page/styleguide", "edit": true },
    { "id": "race-oriental", "category": "race", "inconsiderate": ["oriental", "orientals"], "considerate": ["Asian", "Asian people"], "note": "Offensive when applied to people; acceptable for objects such as rugs.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "race-eskimo", "category": "race", "inconsiderate": ["eskimo", "eskimos"], "considerate": ["Inuit", "Inuit"], "note": "Considered offensive by many Inuit and Yupik people; name the specific people.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "race-indian-for-native", "category": "race", "inconsiderate": ["american indians", "the indians"], "considerate": ["Native Americans", "Native people"], "note": "Some Native people use \"Indian\"; when possible name the specific nation. Ask, and keep in a quotation with context.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "race-illegal-alien", "category": "race", "inconsiderate": ["illegal alien", "illegal aliens", "illegal immigrant", "illegal immigrants", "illegals"], "considerate": ["undocumented immigrant", "undocumented immigrants", "undocumented immigrant", "undocumented immigrants", "undocumented people"], "note": "The Framework's own example: in a legal quotation, frame as \"as stated in the decision\" rather than rewrite.", "source": "https://asccc-oeri.org/asccc-oeri-inclusion-diversity-equity-and-anti-racism-idea-audit-framework/", "edit": true },
    { "id": "race-slave-noun", "category": "race", "inconsiderate": ["a slave", "the slaves", "slaves were", "slaves who"], "considerate": ["an enslaved person", "the enslaved people", "enslaved people were", "enslaved people who"], "note": "The Framework's example: \"slave\" reduces a person to what was done to them. In a primary-source quotation, keep with context.", "source": "https://asccc-oeri.org/asccc-oeri-inclusion-diversity-equity-and-anti-racism-idea-audit-framework/", "edit": true },
    { "id": "race-slave-owner", "category": "race", "inconsiderate": ["slave owner", "slave owners", "slaveowner", "slaveowners", "slave master", "slave masters"], "considerate": ["enslaver", "enslavers", "enslaver", "enslavers", "enslaver", "enslavers"], "note": "\"Enslaver\" names the act rather than legitimizing ownership.", "source": "https://www.racialequitytools.org/glossary", "edit": true },
    { "id": "race-gypsy", "category": "race", "inconsiderate": ["gypsy", "gypsies", "gypped", "gyp"], "considerate": ["Roma", "Roma people", "cheated", "cheat"], "note": "\"Gypsy\" is a slur for Roma people; \"gyp\" derives from it.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "race-minorities-noun", "category": "race", "inconsiderate": ["minorities", "the minorities"], "considerate": ["people from underrepresented groups", "underrepresented groups"], "note": "Vague and often inaccurate (globally a majority). Name the group.", "source": "https://www.racialequitytools.org/glossary", "edit": true },
    { "id": "race-ghetto", "category": "race", "inconsiderate": ["ghetto", "so ghetto", "the ghetto"], "considerate": ["low-income neighborhood", "run-down", "the neighborhood"], "note": "Racialized when used as an adjective; as a historical noun (the Warsaw ghetto) keep with context.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "race-third-world", "category": "race", "inconsiderate": ["third world", "third-world", "first world"], "considerate": ["low-income countries", "low-income", "high-income countries"], "note": "Cold-war ranking; use income or region terms.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "race-uppity", "category": "race", "inconsiderate": ["uppity"], "considerate": ["assertive", "self-assured"], "note": "Historically used against Black people who did not defer.", "source": "https://www.nabj.org/page/styleguide", "edit": true },
    { "id": "race-powwow-metaphor", "category": "race", "inconsiderate": ["have a powwow", "powwow about", "a quick powwow"], "considerate": ["have a meeting", "meet about", "a quick meeting"], "note": "A Native ceremony used as a synonym for a meeting.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "race-spirit-animal", "category": "race", "inconsiderate": ["spirit animal"], "considerate": ["favorite animal", "mascot"], "note": "Trivializes Indigenous spiritual practice.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "race-tribe-metaphor", "category": "race", "inconsiderate": ["find your tribe", "my tribe", "our tribe"], "considerate": ["find your people", "my people", "our group"], "note": "Trivializes tribal nations when used for a social group.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "race-caucasian", "category": "race", "inconsiderate": ["caucasian", "caucasians"], "considerate": ["white", "white people"], "note": "A discredited racial taxonomy; \"white\" is the plain term. In a demographic table quoting a source, keep with context.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "lgbtq-homosexual-noun", "category": "lgbtq", "inconsiderate": ["a homosexual", "homosexuals", "the homosexuals"], "considerate": ["a gay person", "gay and lesbian people", "gay and lesbian people"], "note": "Clinical and dated as a noun; use \"gay\", \"lesbian\", or the person's own term.", "source": "https://www.glaad.org/reference", "edit": true },
    { "id": "lgbtq-sexual-preference", "category": "lgbtq", "inconsiderate": ["sexual preference", "sexual preferences"], "considerate": ["sexual orientation", "sexual orientations"], "note": "\"Preference\" implies a choice.", "source": "https://www.glaad.org/reference", "edit": true },
    { "id": "lgbtq-lifestyle", "category": "lgbtq", "inconsiderate": ["gay lifestyle", "homosexual lifestyle", "lgbt lifestyle"], "considerate": ["gay people's lives", "gay people's lives", "LGBTQ people's lives"], "note": "\"Lifestyle\" frames identity as a choice.", "source": "https://www.glaad.org/reference", "edit": true },
    { "id": "lgbtq-transgendered", "category": "lgbtq", "inconsiderate": ["transgendered", "a transgender", "transgenders"], "considerate": ["transgender", "a transgender person", "transgender people"], "note": "\"Transgender\" is an adjective, never a noun or a past participle.", "source": "https://www.glaad.org/reference", "edit": true },
    { "id": "lgbtq-sex-change", "category": "lgbtq", "inconsiderate": ["sex change", "sex-change operation", "sex change operation"], "considerate": ["gender-affirming care", "gender-affirming surgery", "gender-affirming surgery"], "note": "Outdated and reductive.", "source": "https://www.glaad.org/reference", "edit": true },
    { "id": "lgbtq-hermaphrodite", "category": "lgbtq", "inconsiderate": ["hermaphrodite", "hermaphrodites", "hermaphroditism"], "considerate": ["intersex person", "intersex people", "intersex variation"], "note": "The Framework's own example: outdated and offensive for people; the preferred term is intersex. Biological use for plants and animals is correct and should be kept.", "source": "https://asccc-oeri.org/asccc-oeri-inclusion-diversity-equity-and-anti-racism-idea-audit-framework/", "edit": true },
    { "id": "lgbtq-transvestite", "category": "lgbtq", "inconsiderate": ["transvestite", "transvestites", "tranny", "trannies"], "considerate": ["cross-dresser", "cross-dressers", "transgender person", "transgender people"], "note": "Slurs or dated clinical terms.", "source": "https://www.glaad.org/reference", "edit": true },
    { "id": "lgbtq-admitted", "category": "lgbtq", "inconsiderate": ["admitted to being gay", "admitted being gay", "admitted he was gay", "admitted she was gay"], "considerate": ["said they are gay", "said they are gay", "said he was gay", "said she was gay"], "note": "\"Admitted\" implies wrongdoing.", "source": "https://www.glaad.org/reference", "edit": true },
    { "id": "gender-chairman", "category": "gender", "inconsiderate": ["chairman", "chairmen", "chairwoman", "chairwomen"], "considerate": ["chair", "chairs", "chair", "chairs"], "note": "Gender-neutral role noun.", "source": "https://eige.europa.eu/publications-resources/toolkits-guides/gender-sensitive-communication/practical-tools/examples-common-gendered-nouns-alternatives", "edit": true },
    { "id": "gender-mankind", "category": "gender", "inconsiderate": ["mankind", "man-made", "manmade", "manpower", "man hours", "man-hours"], "considerate": ["humanity", "artificial", "artificial", "workforce", "person-hours", "person-hours"], "note": "Generic \"man\" excludes; a neutral noun exists.", "source": "https://eige.europa.eu/publications-resources/toolkits-guides/gender-sensitive-communication/practical-tools/examples-common-gendered-nouns-alternatives", "edit": true },
    { "id": "gender-fireman", "category": "gender", "inconsiderate": ["fireman", "firemen", "policeman", "policemen", "mailman", "mailmen", "salesman", "salesmen", "businessman", "businessmen", "congressman", "congressmen", "spokesman", "spokesmen", "freshman", "freshmen"], "considerate": ["firefighter", "firefighters", "police officer", "police officers", "mail carrier", "mail carriers", "salesperson", "salespeople", "businessperson", "businesspeople", "member of congress", "members of congress", "spokesperson", "spokespeople", "first-year student", "first-year students"], "note": "Gender-neutral occupational nouns.", "source": "https://eige.europa.eu/publications-resources/toolkits-guides/gender-sensitive-communication/practical-tools/examples-common-gendered-nouns-alternatives", "edit": true },
    { "id": "gender-stewardess", "category": "gender", "inconsiderate": ["stewardess", "stewardesses", "waitress", "waitresses", "actress", "actresses", "housewife", "housewives"], "considerate": ["flight attendant", "flight attendants", "server", "servers", "actor", "actors", "homemaker", "homemakers"], "note": "Feminine-suffix nouns mark gender where the role does not.", "source": "https://eige.europa.eu/publications-resources/toolkits-guides/gender-sensitive-communication/practical-tools/examples-common-gendered-nouns-alternatives", "edit": true },
    { "id": "gender-mothering", "category": "gender", "inconsiderate": ["mothering", "fathering a child", "mother tongue", "founding fathers"], "considerate": ["parenting", "parenting a child", "first language", "founders"], "note": "Gendered where the meaning is not. \"Founding Fathers\" as a proper historical term may be kept with context.", "source": "https://eige.europa.eu/publications-resources/toolkits-guides/gender-sensitive-communication/practical-tools/examples-common-gendered-nouns-alternatives", "edit": true },
    { "id": "gender-guys", "category": "gender", "inconsiderate": ["you guys", "hey guys"], "considerate": ["everyone", "hello everyone"], "note": "Reads as masculine to many. Common in informal course text.", "source": "https://eige.europa.eu/publications-resources/toolkits-guides/gender-sensitive-communication/practical-tools/examples-common-gendered-nouns-alternatives", "edit": true },
    { "id": "gender-opposite-sex", "category": "gender", "inconsiderate": ["opposite sex", "the opposite sex", "both sexes", "both genders"], "considerate": ["another sex", "another sex", "all sexes", "all genders"], "note": "Assumes a binary.", "source": "https://www.glsen.org/activity/gender-terminology", "edit": true },
    { "id": "gender-he-or-she", "category": "gender", "inconsiderate": ["he or she", "he/she", "his or her", "his/her", "him or her", "him/her", "s/he"], "considerate": ["they", "they", "their", "their", "them", "them", "they"], "note": "A binary pronoun pair. The Framework (§7.3) says to rewrite with care — singular they, or restructure to drop the pronoun. Offered as an observation, not an edit, because the rewrite is the author's call.", "source": "https://www.glsen.org/activity/pronouns-guide-glsen", "edit": false },
    { "id": "gender-generic-he", "category": "gender", "inconsiderate": ["a student should bring his", "each student and his", "the patient and his", "the doctor and his", "the scientist and his", "the researcher and his", "every student and his"], "considerate": ["students should bring their", "each student and their", "the patient and their", "the doctor and their", "the scientist and their", "the researcher and their", "every student and their"], "note": "Generic masculine for an unspecified person. Observation only: the Framework asks the author to decide between singular they and a restructured sentence.", "source": "https://www.glsen.org/activity/pronouns-guide-glsen", "edit": false },
    { "id": "condescending-articulate", "category": "condescending", "inconsiderate": ["surprisingly articulate", "very articulate for"], "considerate": ["articulate", "articulate"], "note": "\"Surprisingly\" implies low expectations tied to identity.", "source": "https://www.nabj.org/page/styleguide", "edit": true },
    { "id": "condescending-exotic", "category": "condescending", "inconsiderate": ["exotic-looking", "exotic looking", "exotic beauty"], "considerate": ["striking", "striking", "beauty"], "note": "Others people by appearance.", "source": "https://www.diversitystyleguide.com/", "edit": true },
    { "id": "condescending-inspirational", "category": "condescending", "inconsiderate": ["despite his disability", "despite her disability", "despite their disability", "overcame his disability", "overcame her disability"], "considerate": ["with his disability", "with her disability", "with their disability", "with his disability", "with her disability"], "note": "Inspiration framing: a disability is not something overcome for others' benefit.", "source": "https://ncdj.org/style-guide/", "edit": true },
    { "id": "condescending-brave", "category": "condescending", "inconsiderate": ["so brave for", "brave for living", "an inspiration to us all"], "considerate": ["for", "living", "notable"], "note": "Inspiration framing.", "source": "https://ncdj.org/style-guide/", "edit": true }
  ]
}
```

- [ ] **Step 4: Write `idea-idioms.json`**

```json
{
  "$license": "CC BY 4.0. Written by the oer2canvas project for the ASCCC OERI IDEA Framework §7.6 (idioms and colloquialisms). Glosses are plain-language paraphrases.",
  "idioms": [
    { "phrase": "hit the books", "gloss": "study hard" },
    { "phrase": "break a leg", "gloss": "good luck" },
    { "phrase": "ballpark figure", "gloss": "rough estimate" },
    { "phrase": "in the same boat", "gloss": "in the same situation" },
    { "phrase": "piece of cake", "gloss": "very easy" },
    { "phrase": "once in a blue moon", "gloss": "very rarely" },
    { "phrase": "under the weather", "gloss": "slightly ill" },
    { "phrase": "on the same page", "gloss": "in agreement" },
    { "phrase": "the ball is in your court", "gloss": "it is your decision" },
    { "phrase": "cut corners", "gloss": "do something carelessly to save time or money" },
    { "phrase": "back to the drawing board", "gloss": "start again" },
    { "phrase": "bite the bullet", "gloss": "do something unpleasant that cannot be avoided" },
    { "phrase": "a dime a dozen", "gloss": "very common" },
    { "phrase": "beat around the bush", "gloss": "avoid saying something directly" },
    { "phrase": "call it a day", "gloss": "stop working" },
    { "phrase": "get the ball rolling", "gloss": "start" },
    { "phrase": "hang in there", "gloss": "keep going" },
    { "phrase": "let the cat out of the bag", "gloss": "reveal a secret" },
    { "phrase": "miss the boat", "gloss": "miss an opportunity" },
    { "phrase": "pull someone's leg", "gloss": "joke with someone" },
    { "phrase": "speak of the devil", "gloss": "the person we were discussing has arrived" },
    { "phrase": "the last straw", "gloss": "the final problem that makes a situation unbearable" },
    { "phrase": "under the table", "gloss": "secretly or illegally" },
    { "phrase": "up in the air", "gloss": "undecided" },
    { "phrase": "wrap your head around", "gloss": "understand" },
    { "phrase": "rule of thumb", "gloss": "a rough guideline" },
    { "phrase": "off the top of my head", "gloss": "without checking" },
    { "phrase": "the bottom line", "gloss": "the essential point" },
    { "phrase": "touch base", "gloss": "make brief contact" },
    { "phrase": "think outside the box", "gloss": "think creatively" },
    { "phrase": "in a nutshell", "gloss": "briefly" },
    { "phrase": "at the end of the day", "gloss": "ultimately" },
    { "phrase": "on the fence", "gloss": "undecided" },
    { "phrase": "burn the midnight oil", "gloss": "work late into the night" },
    { "phrase": "learn the ropes", "gloss": "learn how something is done" },
    { "phrase": "go the extra mile", "gloss": "make additional effort" },
    { "phrase": "hit the nail on the head", "gloss": "be exactly right" },
    { "phrase": "a blessing in disguise", "gloss": "something good that seemed bad at first" },
    { "phrase": "cost an arm and a leg", "gloss": "be very expensive" },
    { "phrase": "get out of hand", "gloss": "become uncontrolled" },
    { "phrase": "grain of salt", "gloss": "with some doubt" },
    { "phrase": "the elephant in the room", "gloss": "an obvious problem nobody mentions" },
    { "phrase": "ring a bell", "gloss": "sound familiar" },
    { "phrase": "sit tight", "gloss": "wait patiently" },
    { "phrase": "slippery slope", "gloss": "a course that leads to worse outcomes" },
    { "phrase": "food for thought", "gloss": "something worth thinking about" },
    { "phrase": "in hot water", "gloss": "in trouble" },
    { "phrase": "on thin ice", "gloss": "in a risky situation" },
    { "phrase": "play it by ear", "gloss": "decide as events unfold" },
    { "phrase": "the whole nine yards", "gloss": "everything" }
  ]
}
```

- [ ] **Step 5: Run the data test**

Run: `npx vitest run --project unit src/engine/idea/data.test.ts`
Expected: PASS (3 tests; 70 rules, 50 idioms).

- [ ] **Step 6: Commit**

```bash
git add src/engine/idea/data src/engine/idea/data.test.ts
git commit -m "feat: vendor curated inclusive-terminology and idiom lists

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 5: The finders and the findings model

**Files:**
- Create: `src/engine/idea/findings.ts`, `src/engine/idea/terms.ts`, `src/engine/idea/idioms.ts`
- Test: `src/engine/idea/terms.test.ts`, `src/engine/idea/idioms.test.ts`, `src/engine/idea/findings.test.ts`

**Interfaces:**
- Produces (`findings.ts`):
  ```ts
  export type FindingOrigin = 'rule' | 'draft'
  export interface RuleRef { id: string; source: 'terms' | 'idiom' | 'llm'; note?: string; sourceUrl?: string }
  export interface EditFinding {
    kind: 'edit'; key: string; category: CategoryId; sectionId: string; elementId: string
    original: string; occurrence: number; replacement: string; inQuotation: boolean; rule: RuleRef; origin: FindingOrigin
  }
  export interface ObservationFinding {
    kind: 'observation'; key: string; category: CategoryId; sectionId: string; elementId?: string
    columns: Readonly<Record<string, string>>; rule?: RuleRef; origin: FindingOrigin
  }
  export type IdeaFinding = EditFinding | ObservationFinding
  export type Finder = (sectionId: string, html: string) => IdeaFinding[]
  export const RULE_FINDERS: readonly Finder[]                     // [findTerms, findIdioms]
  export function findingsFor(section: { id: string; html: string }, edits: IdeaEdits): IdeaFinding[]   // runs every finder, drops keys in edits/dismissed
  export function findingsByCategory(findings: readonly IdeaFinding[]): ReadonlyMap<CategoryId, IdeaFinding[]>
  ```
- Produces (`terms.ts`): `findTerms: Finder`; (`idioms.ts`): `findIdioms: Finder`.

- [ ] **Step 1: Write the failing tests**

`src/engine/idea/terms.test.ts`:
```ts
import { findTerms } from './terms'

const html = (body: string) => body

test('an ableist phrase becomes an edit finding with the rule, occurrence, and category 7.6', () => {
  const f = findTerms('s1', html('<p id="b2c-blk-0">He suffers from asthma.</p>'))
  expect(f).toHaveLength(1)
  const e = f[0]!
  expect(e.kind).toBe('edit')
  if (e.kind !== 'edit') return
  expect(e).toMatchObject({
    category: '7.6', sectionId: 's1', elementId: 'b2c-blk-0', original: 'suffers from', occurrence: 0,
    replacement: 'has', inQuotation: false, origin: 'rule',
  })
  expect(e.rule.id).toBe('ablist-suffers-from')
  expect(e.rule.sourceUrl).toMatch(/^https:\/\/ncdj\.org/)
  expect(e.key).toBe('s1::b2c-blk-0::0::suffers from')
})

test('matching is case-insensitive at word boundaries and reports the text as written', () => {
  const f = findTerms('s1', '<p id="a">Crazy ideas. Not a crazyquilt. crazy.</p>')
  expect(f.map((x) => x.kind === 'edit' && [x.original, x.occurrence])).toEqual([['Crazy', 0], ['crazy', 0]])
})

test('a gender noun is category 7.3', () => {
  const f = findTerms('s1', '<p id="a">The chairman spoke.</p>')
  expect(f[0]!.category).toBe('7.3')
})

test('a rule with edit:false is an observation, not an edit', () => {
  const f = findTerms('s1', '<p id="a">Each student should bring his or her book.</p>')
  expect(f).toHaveLength(1)
  expect(f[0]!.kind).toBe('observation')
  if (f[0]!.kind !== 'observation') return
  expect(f[0]!.columns.text).toBe('his or her')
  expect(f[0]!.elementId).toBe('a')
})

test('a hit inside a quotation is flagged inQuotation', () => {
  const f = findTerms('s1', '<blockquote><p id="a">the schizophrenics were</p></blockquote><p id="b">As Kraepelin (1911) wrote, the schizophrenics</p>')
  expect(f.every((x) => x.kind === 'edit' && x.inQuotation)).toBe(true)
})

test('a match that spans an inline element is skipped', () => {
  const f = findTerms('s1', '<p id="a">falling on <em>deaf</em> ears</p>')
  expect(f).toEqual([])
})

test('blocks with no id are skipped rather than keyed on an empty string', () => {
  expect(findTerms('s1', '<p>crazy</p>')).toEqual([])
})
```

`src/engine/idea/idioms.test.ts`:
```ts
import { findIdioms } from './idioms'

test('an idiom is an observation with a gloss and an optional parenthetical edit', () => {
  const f = findIdioms('s1', '<p id="a">Time to hit the books before the exam.</p>')
  expect(f).toHaveLength(1)
  const o = f[0]!
  expect(o.kind).toBe('observation')
  if (o.kind !== 'observation') return
  expect(o.category).toBe('7.6')
  expect(o.columns).toEqual({ idiom: 'hit the books', gloss: 'study hard', suggestion: 'hit the books (study hard)' })
  expect(o.elementId).toBe('a')
  expect(o.rule?.source).toBe('idiom')
  expect(o.key).toBe('s1::a::0::hit the books')
})

test('matching is case-insensitive and whole-phrase', () => {
  expect(findIdioms('s1', '<p id="a">A Piece Of Cake, said the baker of cake.</p>')).toHaveLength(1)
})
```

`src/engine/idea/findings.test.ts`:
```ts
import { findingsByCategory, findingsFor } from './findings'
import { ideaEditKey, newEdits, reduceEdits } from './edits'

const section = { id: 's1', html: '<p id="a">He suffers from asthma and is a chairman.</p><p id="b">hit the books</p>' }

test('findingsFor runs every finder and groups by category', () => {
  const all = findingsFor(section, newEdits())
  expect(all.map((f) => f.category).sort()).toEqual(['7.3', '7.6', '7.6'])
  const by = findingsByCategory(all)
  expect(by.get('7.6')).toHaveLength(2)
  expect(by.get('7.3')).toHaveLength(1)
  expect(by.get('7.1')).toBeUndefined()
})

test('a finding whose key is in edits or dismissed is suppressed', () => {
  let edits = reduceEdits(newEdits(), { type: 'replace', key: ideaEditKey('s1', 'a', 0, 'suffers from'), replacement: 'has' })
  edits = reduceEdits(edits, { type: 'dismiss', key: ideaEditKey('s1', 'b', 0, 'hit the books') })
  const left = findingsFor(section, edits)
  expect(left).toHaveLength(1)
  expect(left[0]!.category).toBe('7.3')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/engine/idea/terms.test.ts src/engine/idea/idioms.test.ts src/engine/idea/findings.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `findings.ts`**

```ts
/**
 * What a check surfaced about a section. Ephemeral: recomputed whenever the
 * section's html changes, never persisted — the human's decision is what is
 * kept, in `IdeaEdits`.
 *
 * `origin` is set by the producer and rendered by the panel. A rule finding
 * says "a style guide says"; a draft finding (slice 4) says "a model suggested".
 * The distinction is visual by construction, not by convention.
 */
import type { CategoryId } from './framework'
import type { IdeaEdits } from './edits'
import { findTerms } from './terms'
import { findIdioms } from './idioms'

export type FindingOrigin = 'rule' | 'draft'

export interface RuleRef {
  id: string
  source: 'terms' | 'idiom' | 'llm'
  note?: string
  sourceUrl?: string
}

export interface EditFinding {
  kind: 'edit'
  key: string
  category: CategoryId
  sectionId: string
  elementId: string
  original: string
  occurrence: number
  replacement: string
  inQuotation: boolean
  rule: RuleRef
  origin: FindingOrigin
}

export interface ObservationFinding {
  kind: 'observation'
  key: string
  category: CategoryId
  sectionId: string
  elementId?: string
  columns: Readonly<Record<string, string>>
  rule?: RuleRef
  origin: FindingOrigin
}

export type IdeaFinding = EditFinding | ObservationFinding

export type Finder = (sectionId: string, html: string) => IdeaFinding[]

export const RULE_FINDERS: readonly Finder[] = [findTerms, findIdioms]

export function findingsFor(section: { id: string; html: string }, edits: IdeaEdits): IdeaFinding[] {
  const out: IdeaFinding[] = []
  for (const find of RULE_FINDERS) {
    for (const f of find(section.id, section.html)) {
      if (edits.edits.has(f.key) || edits.dismissed.has(f.key)) continue
      out.push(f)
    }
  }
  return out
}

export function findingsByCategory(findings: readonly IdeaFinding[]): ReadonlyMap<CategoryId, IdeaFinding[]> {
  const by = new Map<CategoryId, IdeaFinding[]>()
  for (const f of findings) {
    const list = by.get(f.category) ?? []
    list.push(f)
    by.set(f.category, list)
  }
  return by
}
```

- [ ] **Step 4: Write `terms.ts`**

```ts
/**
 * 7.6 Appropriate Terminology and 7.3 Gender-Inclusive Language, by list.
 *
 * Phrase matching at word boundaries, case-insensitive, inside ONE text node
 * (see `text.ts`). The occurrence index is computed against the text AS
 * WRITTEN (case preserved) so that `applyIdeaEdits`, which is case-sensitive,
 * finds the same place.
 *
 * A rule with `edit: false` yields an observation: the pronoun rewrites the
 * Framework assigns to the author.
 */
import type { CategoryId } from './framework'
import type { Finder, IdeaFinding } from './findings'
import { ideaEditKey } from './edits'
import { blockElements, countOccurrences, isQuotation, textNodesOf } from './text'
import data from './data/idea-terms.json'

interface TermRule {
  id: string
  category: string
  inconsiderate: string[]
  considerate: string[]
  note: string
  source: string
  edit: boolean
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const COMPILED: { rule: TermRule; phrase: string; replacement: string; re: RegExp }[] = (data.rules as TermRule[]).flatMap(
  (rule) =>
    rule.inconsiderate.map((phrase, i) => ({
      rule,
      phrase,
      replacement: rule.considerate[i] ?? rule.considerate[0]!,
      // `(?<![\w-])` and `(?![\w-])`: word boundaries that also refuse a hyphen
      // neighbour, so "crazy" does not fire inside "crazy-quilt" and "the blind"
      // does not fire inside "the blind-spot".
      re: new RegExp(`(?<![\\w-])${escape(phrase)}(?![\\w-])`, 'gi'),
    })),
)

const categoryOf = (rule: TermRule): CategoryId => (rule.category === 'gender' ? '7.3' : '7.6')

export const findTerms: Finder = (sectionId, html) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out: IdeaFinding[] = []
  for (const el of blockElements(doc.body)) {
    const elementId = el.getAttribute('id')
    if (!elementId) continue
    const quoted = isQuotation(el)
    const fullText = el.textContent ?? ''
    for (const node of textNodesOf(el)) {
      for (const c of COMPILED) {
        c.re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = c.re.exec(node.data)) !== null) {
          const original = m[0]
          // Occurrence counted over the block's WHOLE text up to this node and
          // offset, so the index matches what `findOccurrence` will count.
          const before = textBefore(el, node, m.index)
          const occurrence = countOccurrences(before, original)
          const key = ideaEditKey(sectionId, elementId, occurrence, original)
          const rule = { id: c.rule.id, source: 'terms' as const, note: c.rule.note, sourceUrl: c.rule.source }
          if (c.rule.edit) {
            out.push({
              kind: 'edit', key, category: categoryOf(c.rule), sectionId, elementId, original, occurrence,
              replacement: c.replacement, inQuotation: quoted, rule, origin: 'rule',
            })
          } else {
            out.push({
              kind: 'observation', key, category: categoryOf(c.rule), sectionId, elementId,
              columns: { text: original, suggestion: c.replacement, context: fullText.slice(0, 160) },
              rule, origin: 'rule',
            })
          }
        }
      }
    }
  }
  return out
}

/** The block's text strictly before `offset` in `node` — every earlier text node plus this node's prefix. */
export function textBefore(el: Element, node: Text, offset: number): string {
  let s = ''
  for (const t of textNodesOf(el)) {
    if (t === node) return s + t.data.slice(0, offset)
    s += t.data
  }
  return s
}
```

Note on `countOccurrences(before, original)`: `findOccurrence` counts matches node by node without spanning nodes, and `before` is the concatenation of earlier nodes. A phrase that straddles two earlier nodes would be counted here but not there. That case is rare (the phrase itself must contain an inline boundary) and its only effect is that the edit later fails to match and is dropped with a note — the fail-safe branch, never a wrong replacement.

- [ ] **Step 5: Write `idioms.ts`**

```ts
/**
 * 7.6 idioms and colloquialisms. Observations only: the Framework says to
 * CLARIFY, not remove, so the suggestion is a parenthetical gloss the
 * instructor may accept as a replace edit ("hit the books (study hard)").
 */
import type { Finder, IdeaFinding } from './findings'
import { ideaEditKey } from './edits'
import { blockElements, countOccurrences, textNodesOf } from './text'
import { textBefore } from './terms'
import data from './data/idea-idioms.json'

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const COMPILED = data.idioms.map((i) => ({
  ...i,
  re: new RegExp(`(?<![\\w-])${escape(i.phrase)}(?![\\w-])`, 'gi'),
}))

export const findIdioms: Finder = (sectionId, html) => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const out: IdeaFinding[] = []
  for (const el of blockElements(doc.body)) {
    const elementId = el.getAttribute('id')
    if (!elementId) continue
    for (const node of textNodesOf(el)) {
      for (const c of COMPILED) {
        c.re.lastIndex = 0
        let m: RegExpExecArray | null
        while ((m = c.re.exec(node.data)) !== null) {
          const original = m[0]
          const occurrence = countOccurrences(textBefore(el, node, m.index), original)
          out.push({
            kind: 'observation',
            key: ideaEditKey(sectionId, elementId, occurrence, original),
            category: '7.6',
            sectionId,
            elementId,
            columns: { idiom: c.phrase, gloss: c.gloss, suggestion: `${original} (${c.gloss})` },
            rule: { id: `idiom-${c.phrase.replace(/\s+/g, '-')}`, source: 'idiom' },
            origin: 'rule',
          })
        }
      }
    }
  }
  return out
}
```

The idiom test expects `columns.suggestion` to be `'hit the books (study hard)'` — with the text as written, which for that fixture is lower-case, so it matches.

- [ ] **Step 6: Run the tests**

Run: `npx vitest run --project unit src/engine/idea/`
Expected: PASS. If the terms test "case-insensitive at word boundaries" fails on `crazyquilt`, the lookbehind/lookahead are in place; check the regex was built with `gi`.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/idea/findings.ts src/engine/idea/terms.ts src/engine/idea/idioms.ts src/engine/idea/*.test.ts
git commit -m "feat: deterministic terminology, gendered-noun, and idiom findings

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 6: Edits in the persisted review document, and the recompile-on-edit hook

**Files:**
- Modify: `src/engine/idea/store.ts`, `src/components/idea/useIdeaReviews.ts` (both from slice 1)
- Create: `src/components/idea/useIdeaRecompile.ts`
- Test: `src/engine/idea/store.test.ts` (append), `src/components/idea/useIdeaReviews.test.ts` (append), `src/components/idea/useIdeaRecompile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // store.ts — the document gains edits; `dismissed` is NOT persisted (spec §2.3: session-only)
  export interface PersistedIdea { version: 1; header: IdeaHeader; reviews: ReadonlyMap<string, IdeaReview>; edits: ReadonlyMap<string, IdeaEdits> }
  export function toPersisted(header: IdeaHeader, reviews: ReadonlyMap<string, IdeaReview>, edits: ReadonlyMap<string, IdeaEdits>): PersistedIdea
  export function restore(value: unknown): { header: IdeaHeader; reviews: ReadonlyMap<string, IdeaReview>; edits: ReadonlyMap<string, IdeaEdits> } | undefined

  // useIdeaReviews.ts — gains, beside what slice 1 returns:
  //   edits: ReadonlyMap<string, IdeaEdits>          // by review key (reviewKeyOf)
  //   editsFor: (key: string) => IdeaEdits
  //   dispatchEdit: (key: string, event: IdeaEditsEvent) => void
  //   forgetAll() now clears edits too

  export interface IdeaRecompileDeps {
    recompile: (chapter: Chapter, sectionIds: readonly string[], opts: { profile: PublisherProfile; answers: ReadonlyMap<string, QueueAnswer>; ideaEdits: ReadonlyMap<string, IdeaEdit> }) => CompiledSection[]
    audit: (html: string) => Promise<GateResult>
  }
  export function useIdeaRecompile(args: {
    prepared: readonly CompiledChapter[]
    answers: ReadonlyMap<string, QueueAnswer>
    edits: ReadonlyMap<string, IdeaEdits>
    profileOf: (chapter: Chapter) => PublisherProfile
    onRebuilt: (chapterKey: string, sections: readonly CompiledSection[]) => void
    deps?: IdeaRecompileDeps
  }): { pending: ReadonlySet<string> }              // section ids awaiting a gate
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/engine/idea/store.test.ts` (slice 1's `sample()` helper is in scope; add `import { ideaEditKey, newEdits, reduceEdits } from './edits'`):
```ts
test('edits round-trip with the document; dismissals do not', () => {
  const { review, header } = sample()
  const k = ideaEditKey('s1', 'b2c-blk-0', 0, 'crazy')
  let e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'wild' })
  e = reduceEdits(e, { type: 'keep', key: ideaEditKey('s1', 'b2c-blk-1', 0, 'the blind'), context: 'as quoted' })
  e = reduceEdits(e, { type: 'dismiss', key: ideaEditKey('s1', 'b2c-blk-2', 0, 'hit the books') })
  const doc = toPersisted(header, new Map([['k', review]]), new Map([['k', e]]))
  const back = restore(doc)!
  expect(back.edits.get('k')?.edits.get(k)).toEqual({ kind: 'replace', replacement: 'wild' })
  expect([...back.edits.get('k')!.edits.values()]).toHaveLength(2)
  // Session-only by spec §2.3: a dismissal hides a finding for THIS session.
  expect(back.edits.get('k')?.dismissed.size).toBe(0)
})

test('a document written before edits existed restores with none', () => {
  const { review, header } = sample()
  const { edits: _drop, ...older } = toPersisted(header, new Map([['k', review]]), new Map())
  void _drop
  expect(restore(older)!.edits.size).toBe(0)
})

test('malformed edits are dropped, well-formed ones kept', () => {
  const back = restore({
    version: 1,
    header: {},
    reviews: new Map(),
    edits: new Map([
      ['k', { edits: new Map([
        ['s1::b2c-blk-0::0::crazy', { kind: 'replace', replacement: 'wild' }],
        ['s1::b2c-blk-1::0::x', { kind: 'keep' }],
        ['s1::b2c-blk-2::0::y', { kind: 'keep', context: 7 }],
        ['s1::b2c-blk-3::0::z', { kind: 'delete' }],
        ['not-a-key', { kind: 'replace', replacement: 'x' }],
        ['s1::b2c-blk-4::0::w', 'replace'],
      ]) }],
      ['bad', 'not a record'],
    ]),
  })!
  const e = back.edits.get('k')!
  expect([...e.edits.entries()]).toEqual([
    ['s1::b2c-blk-0::0::crazy', { kind: 'replace', replacement: 'wild' }],
    ['s1::b2c-blk-1::0::x', { kind: 'keep' }],
  ])
  expect(back.edits.has('bad')).toBe(false)
})
```

Append to `src/components/idea/useIdeaReviews.test.ts` (its `memoryStore` helper and its imports of `IDEA_STORAGE_KEY`, `restore`, `toPersisted`, `newHeader`, `SAVE_DELAY_MS` are in scope; add `import { ideaEditKey, newEdits, reduceEdits } from '../../engine/idea/edits'`):
```ts
test('edits are kept per chapter key, saved with the document, and forgotten with it', async () => {
  const { map, store } = memoryStore()
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  const k = ideaEditKey('s1', 'a', 0, 'crazy')
  expect(result.current.editsFor('ch1').edits.size).toBe(0)
  act(() => result.current.dispatchEdit('ch1', { type: 'replace', key: k, replacement: 'wild' }))
  expect(result.current.edits.get('ch1')?.edits.get(k)).toEqual({ kind: 'replace', replacement: 'wild' })
  expect(result.current.editsFor('ch2').edits.size).toBe(0)
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(true), { timeout: SAVE_DELAY_MS * 5 })
  expect(restore(map.get(IDEA_STORAGE_KEY))!.edits.get('ch1')?.edits.get(k)).toEqual({ kind: 'replace', replacement: 'wild' })
  act(() => result.current.forgetAll())
  expect(result.current.edits.size).toBe(0)
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(false))
})

test('a saved edit is restored on mount', async () => {
  const k = ideaEditKey('s1', 'a', 0, 'crazy')
  const e = reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'wild' })
  const { store } = memoryStore(toPersisted(newHeader(), new Map(), new Map([['ch1', e]])))
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  expect(result.current.edits.get('ch1')?.edits.get(k)).toEqual({ kind: 'replace', replacement: 'wild' })
})
```
(Also update slice 1's existing `toPersisted(...)` calls in both test files to pass `new Map()` as the third argument — the compiler names each one.)

`src/components/idea/useIdeaRecompile.test.ts`:
```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { useIdeaRecompile, type IdeaRecompileDeps } from './useIdeaRecompile'
import { ideaEditKey, newEdits, reduceEdits, type IdeaEdits } from '../../engine/idea/edits'
import { reviewKeyOf } from './useIdeaReviews'
import { OPENSTAX } from '../../engine/compile/context'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import type { GateResult } from '../../engine/gate'

const chapter: Chapter = {
  source: 'openstax', bookId: 'b', title: 'C', xrefs: new Map(),
  attribution: { bookTitle: 'B', publisher: 'P', authors: [] },
  sections: [
    { id: 's1', title: 'S1', order: 0, html: '<p>crazy</p>' },
    { id: 's2', title: 'S2', order: 1, html: '<p>fine</p>' },
  ],
}
const gate = (html: string): GateResult =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult
const section = (id: string, html: string): CompiledSection => ({ id, title: id, html, notes: [], queue: [], gate: gate(html) })
const prepared: CompiledChapter[] = [{ chapter, sections: [section('s1', '<p id="b2c-blk-0">crazy</p>'), section('s2', '<p id="b2c-blk-0">fine</p>')], queue: [] }]

test('an edit recompiles only its section, re-audits it, and reports the rebuilt section with a gate', async () => {
  const recompile = vi.fn<IdeaRecompileDeps['recompile']>().mockImplementation((_c, ids) =>
    ids.map((id) => ({ id, title: id, html: `<p id="b2c-blk-0">wild</p>`, notes: [], queue: [] })),
  )
  const audit = vi.fn<IdeaRecompileDeps['audit']>().mockImplementation(async (html) => gate(html))
  const onRebuilt = vi.fn()
  const key = reviewKeyOf(chapter)
  let edits = new Map<string, IdeaEdits>()
  const { result, rerender } = renderHook(
    ({ e }) => useIdeaRecompile({ prepared, answers: new Map(), edits: e, profileOf: () => OPENSTAX, onRebuilt, deps: { recompile, audit } }),
    { initialProps: { e: edits } },
  )
  expect(recompile).not.toHaveBeenCalled()

  edits = new Map([[key, reduceEdits(newEdits(), { type: 'replace', key: ideaEditKey('s1', 'b2c-blk-0', 0, 'crazy'), replacement: 'wild' })]])
  rerender({ e: edits })
  expect(recompile).toHaveBeenCalledWith(chapter, ['s1'], expect.objectContaining({ profile: OPENSTAX }))
  expect(result.current.pending.has('s1')).toBe(true)
  await waitFor(() => expect(onRebuilt).toHaveBeenCalledTimes(1))
  const [k, sections] = onRebuilt.mock.calls[0]!
  expect(k).toBe(key)
  expect(sections[0].gate?.html).toBe('<p id="b2c-blk-0">wild</p>')
  await waitFor(() => expect(result.current.pending.size).toBe(0))
})

test('undoing the last edit for a section recompiles that section too', async () => {
  const recompile = vi.fn<IdeaRecompileDeps['recompile']>().mockImplementation((_c, ids) =>
    ids.map((id) => ({ id, title: id, html: '<p id="b2c-blk-0">crazy</p>', notes: [], queue: [] })),
  )
  const audit = vi.fn<IdeaRecompileDeps['audit']>().mockImplementation(async (html) => gate(html))
  const key = reviewKeyOf(chapter)
  const k = ideaEditKey('s1', 'b2c-blk-0', 0, 'crazy')
  const withEdit = new Map([[key, reduceEdits(newEdits(), { type: 'replace', key: k, replacement: 'wild' })]])
  const { rerender } = renderHook(
    ({ e }) => useIdeaRecompile({ prepared, answers: new Map(), edits: e, profileOf: () => OPENSTAX, onRebuilt: vi.fn(), deps: { recompile, audit } }),
    { initialProps: { e: withEdit } },
  )
  await waitFor(() => expect(recompile).toHaveBeenCalledTimes(1))
  rerender({ e: new Map([[key, reduceEdits(withEdit.get(key)!, { type: 'undo', key: k })]]) })
  await waitFor(() => expect(recompile).toHaveBeenCalledTimes(2))
  expect(recompile.mock.calls[1]![1]).toEqual(['s1'])
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/engine/idea/store.test.ts src/components/idea/useIdeaReviews.test.ts src/components/idea/useIdeaRecompile.test.ts`
Expected: FAIL — `toPersisted` takes two arguments; `edits`/`dispatchEdit` are not returned; `useIdeaRecompile` not found.

- [ ] **Step 3: Extend `store.ts` and `useIdeaReviews.ts`**

In `src/engine/idea/store.ts`:

Add to the imports: `import { newEdits, reduceEdits, type IdeaEdits } from './edits'`. Extend the header comment with one paragraph:
```ts
 * Edits (slice 2) live in the same document, restored the same way: each
 * stored entry is replayed through `reduceEdits`, so a malformed entry is
 * dropped and a well-formed one becomes exactly the edit the instructor
 * made. Dismissals are NOT stored — spec §2.3 makes them session-only — so
 * `restore` always returns an empty `dismissed` set.
```
Change the interface and the two functions:
```ts
export interface PersistedIdea {
  version: 1
  header: IdeaHeader
  reviews: ReadonlyMap<string, IdeaReview>
  edits: ReadonlyMap<string, IdeaEdits>
}

export function toPersisted(
  header: IdeaHeader,
  reviews: ReadonlyMap<string, IdeaReview>,
  edits: ReadonlyMap<string, IdeaEdits>,
): PersistedIdea {
  // Dismissals stripped on the way out, so the document never carries them.
  const stripped = new Map<string, IdeaEdits>()
  for (const [key, e] of edits) stripped.set(key, { edits: e.edits, dismissed: new Set() })
  return { version: 1, header, reviews, edits: stripped }
}

/** Four `::`-separated parts, as `ideaEditKey` builds them. */
const isEditKey = (v: unknown): v is string => typeof v === 'string' && v.split('::').length >= 4

function restoreEdits(value: unknown): ReadonlyMap<string, IdeaEdits> {
  const out = new Map<string, IdeaEdits>()
  for (const [key, raw] of entries(value)) {
    if (typeof key !== 'string' || !isRecord(raw)) continue
    let e = newEdits()
    for (const [editKey, edit] of entries(raw.edits)) {
      if (!isEditKey(editKey) || !isRecord(edit)) continue
      if (edit.kind === 'replace' && typeof edit.replacement === 'string') {
        e = reduceEdits(e, { type: 'replace', key: editKey, replacement: edit.replacement })
      } else if (edit.kind === 'keep' && (edit.context === undefined || typeof edit.context === 'string')) {
        e = reduceEdits(e, edit.context === undefined ? { type: 'keep', key: editKey } : { type: 'keep', key: editKey, context: edit.context })
      }
    }
    out.set(key, e)
  }
  return out
}
```
and in `restore`, change the return type to include `edits` and the last line to `return { header, reviews, edits: restoreEdits(value.edits) }`. A document with no `edits` field (written by slice 1) passes `undefined` to `entries`, which yields nothing.

In `src/components/idea/useIdeaReviews.ts`:

- Import `newEdits`, `reduceEdits`, `type IdeaEdits`, `type IdeaEditsEvent` from `../../engine/idea/edits`.
- `State` gains `edits: ReadonlyMap<string, IdeaEdits>`; `empty()` returns `edits: new Map()`.
- In the load effect, the merge becomes `{ header: s.header, reviews: new Map([...found.reviews, ...s.reviews]), edits: new Map([...found.edits, ...s.edits]) }` for the dirty branch and `found` otherwise.
- The save effect writes `toPersisted(state.header, state.reviews, state.edits)`.
- Add, beside `dispatch`:
  ```ts
  const editsFor = useCallback((key: string) => state.edits.get(key) ?? newEdits(), [state.edits])

  const dispatchEdit = useCallback((key: string, event: IdeaEditsEvent) => {
    dirty.current = true
    setState((s) => {
      const edits = new Map(s.edits)
      edits.set(key, reduceEdits(s.edits.get(key) ?? newEdits(), event))
      return { ...s, edits }
    })
  }, [])
  ```
- Return `edits: state.edits, editsFor, dispatchEdit` alongside the slice 1 fields. `forgetAll` needs no change: `empty()` already clears them.
- Extend the header comment: *"Edits (slice 2) ride in the same state and the same document. A dismissal is session-only and is dropped by `toPersisted`; an edit is the instructor's decision about the published bytes and survives a reload for the same reason a rating does."*

- [ ] **Step 4: Write `useIdeaRecompile.ts`**

```ts
/**
 * Layer 2 and 3 for the IDEA phase, mirroring `useQueueSession`: an edit
 * recompiles the sections it changed (from source, with the queue's answers
 * AND the edits), then re-audits them one at a time, and hands the gated
 * sections back so `prepared` describes the bytes the export will ship.
 *
 * The diff is computed on the map of edited-section-ids per chapter, so an
 * undo that empties a section's edits recompiles that section too — its bytes
 * have to go back to what they were.
 */
import { useEffect, useRef, useState } from 'react'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import type { GateResult } from '../../engine/gate'
import type { PublisherProfile } from '../../engine/compile/context'
import type { QueueAnswer } from '../../engine/compile/answers'
import { recompileSections } from '../../engine/compile/index'
import { validateAllowlist } from '../../engine/allowlist'
import { parseIdeaEditKey, type IdeaEdit, type IdeaEdits } from '../../engine/idea/edits'
import { reviewKeyOf } from './useIdeaReviews'

export interface IdeaRecompileDeps {
  recompile: (
    chapter: Chapter,
    sectionIds: readonly string[],
    opts: { profile: PublisherProfile; answers: ReadonlyMap<string, QueueAnswer>; ideaEdits: ReadonlyMap<string, IdeaEdit> },
  ) => CompiledSection[]
  audit: (html: string) => Promise<GateResult>
}

export const defaultIdeaRecompileDeps: IdeaRecompileDeps = {
  recompile: (chapter, ids, opts) => recompileSections(chapter, ids, opts),
  audit: async (html) => {
    // Repaired first, as the queue does: the gate audits allowlist-repaired
    // bytes and `ChapterView` renders only `gate.html`.
    const repaired = (await validateAllowlist(html)).html
    const { auditSection } = await import('../../engine')
    return auditSection(repaired)
  },
}

/** Section ids that currently carry at least one edit, per chapter key. */
function editedSections(edits: ReadonlyMap<string, IdeaEdits>): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  for (const [key, e] of edits) {
    const ids = new Set<string>()
    for (const k of e.edits.keys()) ids.add(parseIdeaEditKey(k).sectionId)
    out.set(key, ids)
  }
  return out
}

export function useIdeaRecompile({
  prepared, answers, edits, profileOf, onRebuilt, deps = defaultIdeaRecompileDeps,
}: {
  prepared: readonly CompiledChapter[]
  answers: ReadonlyMap<string, QueueAnswer>
  edits: ReadonlyMap<string, IdeaEdits>
  profileOf: (chapter: Chapter) => PublisherProfile
  onRebuilt: (chapterKey: string, sections: readonly CompiledSection[]) => void
  deps?: IdeaRecompileDeps
}) {
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set())
  const last = useRef<Map<string, Set<string>>>(new Map())

  useEffect(() => {
    const now = editedSections(edits)
    const work: { chapterKey: string; ids: string[] }[] = []
    for (const compiled of prepared) {
      const chapterKey = reviewKeyOf(compiled.chapter)
      const before = last.current.get(chapterKey) ?? new Set<string>()
      const after = now.get(chapterKey) ?? new Set<string>()
      const changed = [...new Set([...before, ...after])].filter((id) => before.has(id) !== after.has(id) || after.has(id))
      // `after.has(id)` alone is not enough: a second edit in an already-edited
      // section changes bytes too. So every section with an edit now, plus
      // every section that just lost its last one, is rebuilt. That over-
      // recompiles by one section per edit, which is 0–15 ms.
      if (changed.length > 0) work.push({ chapterKey, ids: changed })
    }
    last.current = now
    if (work.length === 0) return

    let live = true
    const started = new Set(work.flatMap((w) => w.ids))
    setPending((p) => new Set([...p, ...started]))
    void (async () => {
      for (const { chapterKey, ids } of work) {
        const compiled = prepared.find((c) => reviewKeyOf(c.chapter) === chapterKey)
        if (!compiled) continue
        const ideaEdits = edits.get(chapterKey)?.edits ?? new Map<string, IdeaEdit>()
        const rebuilt = deps.recompile(compiled.chapter, ids, { profile: profileOf(compiled.chapter), answers, ideaEdits })
        const gated: CompiledSection[] = []
        for (const s of rebuilt) {
          if (s.error) { gated.push(s); continue }
          gated.push({ ...s, gate: await deps.audit(s.html) })
        }
        if (live) onRebuilt(chapterKey, gated)
      }
      if (live) setPending((p) => new Set([...p].filter((id) => !started.has(id))))
    })()
    return () => { live = false }
    // `prepared` is deliberately NOT a dependency: `onRebuilt` replaces
    // sections in it, and re-running on that replacement would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, answers, deps])

  return { pending }
}
```

Note the first-render behaviour the second test relies on: `last.current` starts empty, so a hook mounted with edits already present recompiles them once. That is correct — `prepared` came from the first compile without them.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run --project unit src/engine/idea/store.test.ts src/components/idea/useIdeaReviews.test.ts src/components/idea/useIdeaRecompile.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/idea/store.ts src/engine/idea/store.test.ts src/components/idea/useIdeaReviews.ts src/components/idea/useIdeaReviews.test.ts src/components/idea/useIdeaRecompile.ts src/components/idea/useIdeaRecompile.test.ts
git commit -m "feat: IDEA edits per chapter, kept with the review, recompiled and re-audited on change

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 7: Finding rows, the Applied list, and the chapter render

**Files:**
- Create: `src/components/idea/FindingRow.tsx`, `src/components/idea/AppliedList.tsx`, `src/components/idea/IdeaChapterRender.tsx`, `src/components/idea/idea.css`
- Modify: `src/components/idea/copy.ts`
- Test: `src/components/idea/FindingRow.test.tsx`, `src/components/idea/AppliedList.test.tsx`, `src/components/idea/IdeaChapterRender.browser.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  export function FindingRow(props: {
    finding: IdeaFinding
    sectionTitle: string
    onEvent: (event: IdeaEditsEvent) => void
    onFocus: (target: { sectionId: string; elementId: string } | undefined) => void
  }): JSX.Element
  export function AppliedList(props: {
    applied: readonly { key: string; edit: IdeaEdit; stale: boolean; sectionTitle: string }[]
    onUndo: (key: string) => void
  }): JSX.Element
  export function IdeaChapterRender(props: {
    compiled: CompiledChapter
    target: { sectionId: string; elementId: string } | undefined   // element to outline and scroll to
    pending: ReadonlySet<string>                                   // section ids whose recompile is in flight
  }): JSX.Element
  ```
  It replaces `<ChapterView compiled={current} audit={false} />` inside slice 1's aside. Same heading (`h2`, the chapter title — slice 1's switcher test looks for it), same attribution line, same `gate.html`-only body per section; what it adds is the outline and the pending line. It resolves packaged-asset references itself with `usePackagedAssetUrls(compiled.chapter.assets)`, as `ChapterView` does.

- [ ] **Step 1: Add copy**

Append to `IDEA_COPY` in `src/components/idea/copy.ts`:
```ts
  findings: {
    heading: 'What a rule found',
    none: 'No wording this rule set recognises. That is not a clean bill; the checklist below is the review.',
    ruleSays: (source: string) => `${source} ↗`,
    inQuotation: 'inside a quotation',
    where: (sectionTitle: string) => `in ${sectionTitle}`,
    replace: 'Replace',
    edit: 'Edit…',
    keep: 'Keep, add context…',
    keepAsIs: 'Keep as is',
    dismiss: 'Dismiss',
    save: 'Save',
    cancel: 'Cancel',
    contextPlaceholder: 'a widely used term at the time',
    replacementLabel: 'Replacement',
    contextLabel: 'Context to add after the term',
    observation: 'Observation',
    suggestionLabel: 'Suggested wording',
    useSuggestion: 'Use this wording',
    draft: 'draft',
    rule: 'rule',
  },
  applied: {
    heading: 'Applied',
    undo: 'Undo',
    stale: 'no longer matches; not applied',
    replaced: (from: string, to: string) => `“${from}” → “${to}”`,
    kept: (term: string, context?: string) => (context ? `“${term}” kept, with “(${context})”` : `“${term}” kept as is`),
    announceApplied: 'Applied.',
    announceUndone: 'Undone.',
    announceDismissed: 'Dismissed.',
  },
  render: {
    pending: 'Re-checking this section…',
  },
```

- [ ] **Step 2: Write the failing tests**

`src/components/idea/FindingRow.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { FindingRow } from './FindingRow'
import type { EditFinding, ObservationFinding } from '../../engine/idea/findings'

const edit: EditFinding = {
  kind: 'edit', key: 's1::a::0::suffers from', category: '7.6', sectionId: 's1', elementId: 'a',
  original: 'suffers from', occurrence: 0, replacement: 'has', inQuotation: false,
  rule: { id: 'ablist-suffers-from', source: 'terms', note: 'Say what the person has.', sourceUrl: 'https://ncdj.org/style-guide/' },
  origin: 'rule',
}

test('a rule edit finding shows original, replacement, note, source link, and location', () => {
  render(<FindingRow finding={edit} sectionTitle="4.2 Nutrients" onEvent={vi.fn()} onFocus={vi.fn()} />)
  expect(screen.getByText('suffers from')).toBeInTheDocument()
  expect(screen.getByText('has')).toBeInTheDocument()
  expect(screen.getByText('Say what the person has.')).toBeInTheDocument()
  expect(screen.getByRole('link', { name: /ncdj\.org/ })).toHaveAttribute('href', 'https://ncdj.org/style-guide/')
  expect(screen.getByText('in 4.2 Nutrients')).toBeInTheDocument()
  expect(screen.getByText('rule')).toBeInTheDocument()
})

test('Replace dispatches a replace event with the finding’s replacement', () => {
  const onEvent = vi.fn()
  render(<FindingRow finding={edit} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'replace', key: edit.key, replacement: 'has' })
})

test('Edit… opens a field prefilled with the replacement and Save dispatches what was typed', () => {
  const onEvent = vi.fn()
  render(<FindingRow finding={edit} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Edit…' }))
  const field = screen.getByRole('textbox', { name: 'Replacement' })
  expect(field).toHaveValue('has')
  fireEvent.change(field, { target: { value: 'is living with' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'replace', key: edit.key, replacement: 'is living with' })
})

test('a quotation finding leads with Keep, add context… and Save dispatches a keep with context', () => {
  const onEvent = vi.fn()
  render(<FindingRow finding={{ ...edit, inQuotation: true }} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  expect(screen.getByText('inside a quotation')).toBeInTheDocument()
  const buttons = screen.getAllByRole('button').map((b) => b.textContent)
  expect(buttons.indexOf('Keep, add context…')).toBeLessThan(buttons.indexOf('Replace'))
  fireEvent.click(screen.getByRole('button', { name: 'Keep, add context…' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Context to add after the term' }), { target: { value: 'a term used at the time' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'keep', key: edit.key, context: 'a term used at the time' })
})

test('Keep as is dispatches a keep without context; Dismiss dispatches dismiss', () => {
  const onEvent = vi.fn()
  render(<FindingRow finding={edit} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Keep as is' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'keep', key: edit.key })
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'dismiss', key: edit.key })
})

test('focus and blur report the element to highlight', () => {
  const onFocus = vi.fn()
  render(<FindingRow finding={edit} sectionTitle="s" onEvent={vi.fn()} onFocus={onFocus} />)
  fireEvent.focus(screen.getByRole('button', { name: 'Replace' }))
  expect(onFocus).toHaveBeenLastCalledWith({ sectionId: 's1', elementId: 'a' })
  fireEvent.blur(screen.getByRole('button', { name: 'Replace' }))
  expect(onFocus).toHaveBeenLastCalledWith(undefined)
})

test('an observation renders its columns and a Use-this-wording button when a suggestion is present', () => {
  const obs: ObservationFinding = {
    kind: 'observation', key: 's1::a::0::hit the books', category: '7.6', sectionId: 's1', elementId: 'a',
    columns: { idiom: 'hit the books', gloss: 'study hard', suggestion: 'hit the books (study hard)' },
    rule: { id: 'idiom-hit-the-books', source: 'idiom' }, origin: 'rule',
  }
  const onEvent = vi.fn()
  render(<FindingRow finding={obs} sectionTitle="s" onEvent={onEvent} onFocus={vi.fn()} />)
  expect(screen.getByText('study hard')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Use this wording' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'replace', key: obs.key, replacement: 'hit the books (study hard)' })
})

test('a draft finding is labelled draft', () => {
  render(<FindingRow finding={{ ...edit, origin: 'draft' }} sectionTitle="s" onEvent={vi.fn()} onFocus={vi.fn()} />)
  expect(screen.getByText('draft')).toBeInTheDocument()
})
```

`src/components/idea/AppliedList.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { AppliedList } from './AppliedList'

test('applied edits are listed with their change and Undo; stale ones say so', () => {
  const onUndo = vi.fn()
  render(
    <AppliedList
      applied={[
        { key: 's1::a::0::suffers from', edit: { kind: 'replace', replacement: 'has' }, stale: false, sectionTitle: 'S' },
        { key: 's1::b::0::the blind', edit: { kind: 'keep', context: 'as quoted' }, stale: true, sectionTitle: 'S' },
      ]}
      onUndo={onUndo}
    />,
  )
  expect(screen.getByText('“suffers from” → “has”')).toBeInTheDocument()
  expect(screen.getByText('“the blind” kept, with “(as quoted)”')).toBeInTheDocument()
  expect(screen.getByText('no longer matches; not applied')).toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: 'Undo' })[0]!)
  expect(onUndo).toHaveBeenCalledWith('s1::a::0::suffers from')
})

test('an empty list renders nothing', () => {
  const { container } = render(<AppliedList applied={[]} onUndo={vi.fn()} />)
  expect(container).toBeEmptyDOMElement()
})
```

`src/components/idea/IdeaChapterRender.browser.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { IdeaChapterRender } from './IdeaChapterRender'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import type { GateResult } from '../../engine/gate'
import '../../App.css'

const gate = (html: string): GateResult =>
  ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult
const chapter: Chapter = {
  source: 'openstax', bookId: 'b', title: '4: Nutrition', sections: [], xrefs: new Map(),
  attribution: { bookTitle: 'Human Biology', publisher: 'LibreTexts', authors: [] },
}
const s1: CompiledSection = { id: 's1', title: 'S1', html: '<p>raw one</p>', notes: [], queue: [], gate: gate('<p id="b2c-blk-0">one</p><p id="b2c-blk-1">two</p>') }
const s2: CompiledSection = { id: 's2', title: 'S2', html: '<p>raw two</p>', notes: [], queue: [], gate: gate('<p id="b2c-blk-0">three</p>') }
const compiled: CompiledChapter = { chapter, sections: [s1, s2], queue: [] }
const none = new Set<string>()

test('the chapter heading and every gated section render; raw html never does', () => {
  const { container } = render(<IdeaChapterRender compiled={compiled} target={undefined} pending={none} />)
  expect(screen.getByRole('heading', { name: '4: Nutrition' })).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'S1' })).toBeInTheDocument()
  expect(screen.getByRole('article', { name: 'S2' })).toBeInTheDocument()
  expect(container.innerHTML).not.toContain('raw one')
})

// Block ids repeat across sections (`b2c-blk-0` is in both), so the target is
// found INSIDE its section's article, never by a document-wide id lookup.
test('the target element in the named section carries the outline class, and a new target moves it', () => {
  const { rerender } = render(<IdeaChapterRender compiled={compiled} target={{ sectionId: 's2', elementId: 'b2c-blk-0' }} pending={none} />)
  const inS2 = screen.getByRole('article', { name: 'S2' }).querySelector('#b2c-blk-0')
  const inS1 = screen.getByRole('article', { name: 'S1' }).querySelector('#b2c-blk-0')
  expect(inS2).toHaveClass('b2c-idea-target')
  expect(inS1).not.toHaveClass('b2c-idea-target')
  rerender(<IdeaChapterRender compiled={compiled} target={{ sectionId: 's1', elementId: 'b2c-blk-1' }} pending={none} />)
  expect(inS2).not.toHaveClass('b2c-idea-target')
  expect(screen.getByRole('article', { name: 'S1' }).querySelector('#b2c-blk-1')).toHaveClass('b2c-idea-target')
})

test('the outline is geometry only, never a colour', () => {
  render(<IdeaChapterRender compiled={compiled} target={{ sectionId: 's1', elementId: 'b2c-blk-1' }} pending={none} />)
  const s = getComputedStyle(screen.getByRole('article', { name: 'S1' }).querySelector('#b2c-blk-1')!)
  expect(parseFloat(s.outlineWidth)).toBeGreaterThanOrEqual(3)
  expect(s.outlineColor).toBe(s.color)
})

test('a pending section shows the pending line in place of its body; the others still render', () => {
  const { container } = render(<IdeaChapterRender compiled={compiled} target={undefined} pending={new Set(['s1'])} />)
  expect(screen.getByText('Re-checking this section…')).toBeInTheDocument()
  expect(container.innerHTML).not.toContain('>one<')
  expect(container.innerHTML).toContain('>three<')
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run --project unit src/components/idea/FindingRow.test.tsx src/components/idea/AppliedList.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `idea.css`**

```css
/*
 * The IDEA render's outline. Same rules as `queue.css`'s `.b2c-queue-target`
 * and for the same reasons: `outline` so publisher layout does not move,
 * `currentColor` so forced colours and themes keep it, and thicker than any
 * UA focus ring so "the thing you are judging" and "what your keystroke hits"
 * stay separable by geometry alone.
 */
.b2c-idea-render {
  border-inline-start: 3px solid currentColor;
  padding-inline-start: 1rem;
  margin-inline-start: 0.25rem;
}
.b2c-idea-target {
  outline: 3px solid currentColor;
  outline-offset: 6px;
}
/* A draft row is set apart by a dashed border — geometry, not colour. */
.b2c-idea-draft {
  border-style: dashed;
}
```

- [ ] **Step 5: Write `FindingRow.tsx`**

```tsx
/**
 * One finding, STRINGS ONLY, with the four decisions the spec gives it.
 *
 * A quotation finding lists Keep first: the Framework's rule for historical
 * usage is to add context, not rewrite, and button order is the one hint the
 * card gives about which answer is usually right.
 */
import { useId, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { IdeaFinding } from '../../engine/idea/findings'
import type { IdeaEditsEvent } from '../../engine/idea/edits'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'
const BTN = `${TARGET} rounded-md border border-neutral-300 px-3 text-sm dark:border-neutral-700`
const PRIMARY = `${TARGET} rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`
const FIELD = 'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'

type Mode = 'idle' | 'edit' | 'context'

export function FindingRow({
  finding, sectionTitle, onEvent, onFocus,
}: {
  finding: IdeaFinding
  sectionTitle: string
  onEvent: (event: IdeaEditsEvent) => void
  onFocus: (target: { sectionId: string; elementId: string } | undefined) => void
}) {
  const id = useId()
  const [mode, setMode] = useState<Mode>('idle')
  const [text, setText] = useState(finding.kind === 'edit' ? finding.replacement : '')
  const c = IDEA_COPY.findings
  const focusProps = finding.elementId
    ? {
        onFocus: () => onFocus({ sectionId: finding.sectionId, elementId: finding.elementId! }),
        onBlur: () => onFocus(undefined),
      }
    : {}
  const origin = (
    <span className="rounded border border-current px-1 text-xs uppercase tracking-wide">
      {finding.origin === 'draft' ? c.draft : c.rule}
    </span>
  )
  const source = finding.rule?.sourceUrl && (
    <a href={finding.rule.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm underline">
      {new URL(finding.rule.sourceUrl).hostname}
      <ExternalLink className="size-3" aria-hidden="true" />
      <span className="sr-only">({IDEA_COPY.opensNewTab})</span>
    </a>
  )

  if (finding.kind === 'observation') {
    const suggestion = finding.columns.suggestion
    return (
      <li className={`flex flex-col gap-2 rounded-md border border-neutral-300 p-3 dark:border-neutral-700 ${finding.origin === 'draft' ? 'b2c-idea-draft' : ''}`} {...focusProps}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {origin}
          <span className="font-semibold">{c.observation}</span>
          <span className="text-neutral-600 dark:text-neutral-400">{c.where(sectionTitle)}</span>
        </div>
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {Object.entries(finding.columns).filter(([k]) => k !== 'suggestion').map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-neutral-600 dark:text-neutral-400">{k}</dt>
              <dd className="m-0">{v}</dd>
            </div>
          ))}
        </dl>
        {finding.rule?.note && <p className="m-0 text-sm">{finding.rule.note}</p>}
        {source}
        {suggestion && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">{c.suggestionLabel}: <span className="font-semibold">{suggestion}</span></span>
            {finding.elementId && (
              <button type="button" className={PRIMARY} onClick={() => onEvent({ type: 'replace', key: finding.key, replacement: suggestion })} {...focusProps}>
                {c.useSuggestion}
              </button>
            )}
            <button type="button" className={BTN} onClick={() => onEvent({ type: 'dismiss', key: finding.key })} {...focusProps}>{c.dismiss}</button>
          </div>
        )}
        {!suggestion && (
          <div><button type="button" className={BTN} onClick={() => onEvent({ type: 'dismiss', key: finding.key })} {...focusProps}>{c.dismiss}</button></div>
        )}
      </li>
    )
  }

  const replace = <button type="button" className={finding.inQuotation ? BTN : PRIMARY} onClick={() => onEvent({ type: 'replace', key: finding.key, replacement: finding.replacement })} {...focusProps}>{c.replace}</button>
  const keepContext = <button type="button" className={finding.inQuotation ? PRIMARY : BTN} onClick={() => setMode('context')} {...focusProps}>{c.keep}</button>
  const editBtn = <button type="button" className={BTN} onClick={() => { setText(finding.replacement); setMode('edit') }} {...focusProps}>{c.edit}</button>
  const keepAsIs = <button type="button" className={BTN} onClick={() => onEvent({ type: 'keep', key: finding.key })} {...focusProps}>{c.keepAsIs}</button>
  const dismiss = <button type="button" className={BTN} onClick={() => onEvent({ type: 'dismiss', key: finding.key })} {...focusProps}>{c.dismiss}</button>

  return (
    <li className={`flex flex-col gap-2 rounded-md border border-neutral-300 p-3 dark:border-neutral-700 ${finding.origin === 'draft' ? 'b2c-idea-draft' : ''}`}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {origin}
        <span className="font-semibold">{finding.original}</span>
        <span aria-hidden="true">→</span>
        <span className="sr-only">replace with</span>
        <span className="font-semibold">{finding.replacement}</span>
        {finding.inQuotation && <span className="text-neutral-600 dark:text-neutral-400">({c.inQuotation})</span>}
        <span className="text-neutral-600 dark:text-neutral-400">{c.where(sectionTitle)}</span>
      </div>
      {finding.rule.note && <p className="m-0 text-sm">{finding.rule.note}</p>}
      {source}
      {mode === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {finding.inQuotation ? <>{keepContext}{replace}</> : <>{replace}{editBtn}{keepContext}</>}
          {keepAsIs}
          {dismiss}
        </div>
      )}
      {mode === 'edit' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-r`}>{c.replacementLabel}</label>
          <input id={`${id}-r`} className={`${FIELD} ${TARGET}`} value={text} onChange={(e) => setText(e.target.value)} {...focusProps} />
          <button type="button" className={PRIMARY} onClick={() => { onEvent({ type: 'replace', key: finding.key, replacement: text }); setMode('idle') }}>{c.save}</button>
          <button type="button" className={BTN} onClick={() => setMode('idle')}>{c.cancel}</button>
        </div>
      )}
      {mode === 'context' && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm" htmlFor={`${id}-c`}>{c.contextLabel}</label>
          <input id={`${id}-c`} className={`${FIELD} ${TARGET}`} placeholder={c.contextPlaceholder} value={text === finding.replacement ? '' : text} onChange={(e) => setText(e.target.value)} {...focusProps} />
          <button type="button" className={PRIMARY} onClick={() => { const context = text === finding.replacement ? '' : text.trim(); onEvent(context ? { type: 'keep', key: finding.key, context } : { type: 'keep', key: finding.key }); setMode('idle') }}>{c.save}</button>
          <button type="button" className={BTN} onClick={() => setMode('idle')}>{c.cancel}</button>
        </div>
      )}
    </li>
  )
}
```

The `text` state is shared by the two fields and initialised to the replacement; the context field shows it as empty until typed, which is what the "Keep, add context" test relies on (it types a value, then Save carries it).

- [ ] **Step 6: Write `AppliedList.tsx`**

```tsx
import type { IdeaEdit } from '../../engine/idea/edits'
import { parseIdeaEditKey } from '../../engine/idea/edits'
import { IDEA_COPY } from './copy'

const TARGET = 'min-h-9 min-w-9'

export function AppliedList({
  applied, onUndo,
}: {
  applied: readonly { key: string; edit: IdeaEdit; stale: boolean; sectionTitle: string }[]
  onUndo: (key: string) => void
}) {
  if (applied.length === 0) return null
  const c = IDEA_COPY.applied
  return (
    <div>
      <h5 className="mb-1 text-sm font-semibold">{c.heading}</h5>
      <ul className="m-0 flex list-none flex-col gap-1 p-0">
        {applied.map(({ key, edit, stale, sectionTitle }) => {
          const { original } = parseIdeaEditKey(key)
          const what = edit.kind === 'replace' ? c.replaced(original, edit.replacement) : c.kept(original, edit.context)
          return (
            <li key={key} className="flex flex-wrap items-center gap-2 text-sm">
              <span>{what}</span>
              <span className="text-neutral-600 dark:text-neutral-400">{IDEA_COPY.findings.where(sectionTitle)}</span>
              {stale && <span className="text-neutral-600 dark:text-neutral-400">— {c.stale}</span>}
              <button type="button" className={`${TARGET} rounded-md border border-neutral-300 px-2 text-sm dark:border-neutral-700`} onClick={() => onUndo(key)}>
                {c.undo}<span className="sr-only"> {what}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 7: Write `IdeaChapterRender.tsx`**

```tsx
/**
 * The read-only chapter render in the IDEA aside — the whole chapter, every
 * section — with the focused finding's element outlined and a section whose
 * recompile is in flight replaced by a sentence.
 *
 * This takes over from `ChapterView` in the IDEA aside (slice 1 used it with
 * the accessibility verdicts off). Same construction as `ChapterView` and the
 * queue's region E, and the same invariant: only `gate.html` (allowlist-
 * repaired) is ever set as innerHTML; `s.html` — compiled but un-audited —
 * never is, which is why a pending section shows a sentence and not "the
 * new bytes, briefly". Packaged-asset tokens are resolved for display only,
 * exactly as `ChapterView` does it.
 *
 * The outline is found INSIDE the target's section. Block ids are minted per
 * section (`b2c-blk-0` exists in every section), so a document-wide id
 * lookup would light up the first section's paragraph for every finding.
 */
import { useLayoutEffect, useRef } from 'react'
import type { CompiledChapter } from '../../contracts/index'
import { CanvasShellStyles } from '../CanvasShellStyles'
import { usePackagedAssetUrls } from '../usePackagedAssetUrls'
import { IDEA_COPY } from './copy'
import './idea.css'

const HIGHLIGHT = 'b2c-idea-target'

export function IdeaChapterRender({
  compiled, target, pending,
}: {
  compiled: CompiledChapter
  target: { sectionId: string; elementId: string } | undefined
  pending: ReadonlySet<string>
}) {
  const { chapter } = compiled
  const resolve = usePackagedAssetUrls(chapter.assets)
  const root = useRef<HTMLElement>(null)
  // Re-run when the bytes change too: a recompile replaces the section's
  // article, and the outline has to land on the new element.
  const bytes = compiled.sections.map((s) => s.gate?.html ?? '').join(' ')

  useLayoutEffect(() => {
    if (!root.current || !target) return
    const article = root.current.querySelector(`article[data-section="${CSS.escape(target.sectionId)}"]`)
    const el = article?.querySelector(`#${CSS.escape(target.elementId)}`)
    if (!el) return
    el.classList.add(HIGHLIGHT)
    el.scrollIntoView({ block: 'center' })
    return () => el.classList.remove(HIGHLIGHT)
  }, [target, bytes])

  return (
    <section ref={root} className="b2c-idea-render" aria-labelledby="idea-chapter-heading">
      <CanvasShellStyles />
      <h2 id="idea-chapter-heading">{chapter.title}</h2>
      <p>
        From {chapter.attribution.url
          ? <a href={chapter.attribution.url}>{chapter.attribution.bookTitle}</a>
          : chapter.attribution.bookTitle} by{' '}
        {chapter.attribution.publisher}
        {chapter.attribution.license ? ` — ${chapter.attribution.license.name}` : ''}
      </p>
      {compiled.sections.map((s) => (
        <article key={s.id} data-section={s.id} aria-label={s.title}>
          {pending.has(s.id) || !s.gate
            ? <p className="text-sm">{IDEA_COPY.render.pending}</p>
            : <div className="b2c-section-body" dangerouslySetInnerHTML={{ __html: resolve(s.gate.html) }} />}
        </article>
      ))}
    </section>
  )
}
```

`data-section` rather than `id={s.id}` on the article: `ChapterView` uses the section id as the element id, and the two never render on one screen, but a section id is publisher data and could collide with a block id inside the body — a data attribute cannot.

- [ ] **Step 8: Run all three test files**

Run: `npx vitest run --project unit src/components/idea/FindingRow.test.tsx src/components/idea/AppliedList.test.tsx && npx vitest run --project browser src/components/idea/IdeaChapterRender.browser.test.tsx`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

```bash
npm run typecheck
git add src/components/idea
git commit -m "feat: finding rows, the applied list, and the IDEA chapter render with highlight-on-focus

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 8: Wire findings into the panel, the screen, and the app

**Files:**
- Modify: `src/components/idea/CategoryPanel.tsx`, `src/components/idea/IdeaScreen.tsx`, `src/components/ChapterView.tsx`, `src/App.tsx`
- Test: `src/components/idea/CategoryPanel.test.tsx` (append), `src/components/idea/IdeaScreen.test.tsx` (append and amend), `src/components/idea/IdeaScreen.browser.test.tsx` (extend the a11y test's props), `src/components/ChapterView.test.tsx` (remove one test)

**Interfaces:**
- `CategoryPanel` gains: `findings?: readonly IdeaFinding[]`, `applied?: readonly { key; edit; stale; sectionTitle }[]`, `sectionTitleOf: (sectionId: string) => string`, `onEditEvent?: (e: IdeaEditsEvent) => void`, `onFocusFinding?: (t) => void`.
- `IdeaScreen` gains: `edits: ReadonlyMap<string, IdeaEdits>`, `onEditEvent: (key: string, e: IdeaEditsEvent) => void`, `pending: ReadonlySet<string>` — alongside slice 1's `header`, `onHeaderEvent`, `onForget`, `onExport`, which stay. Its aside swaps `ChapterView` for `IdeaChapterRender`.
- `ChapterView` loses the `audit` prop slice 1 added: nothing renders it with the verdicts off any more.
- `App` composes `useIdeaReviews` (which now holds edits) + `useIdeaRecompile`, replaces rebuilt sections in `prepared`, and passes a chapter's persisted edits into its initial compile. Nothing is reset with derived output.

- [ ] **Step 1: Write the failing tests**

Append to `src/components/idea/CategoryPanel.test.tsx`:
```tsx
import type { EditFinding } from '../../engine/idea/findings'

const finding: EditFinding = {
  kind: 'edit', key: 's1::a::0::crazy', category: '7.6', sectionId: 's1', elementId: 'a', original: 'crazy',
  occurrence: 0, replacement: 'wild', inQuotation: false, rule: { id: 'ablist-crazy', source: 'terms' }, origin: 'rule',
}

test('findings render in a "What a rule found" zone above the checklist, and the header counts them', () => {
  const onEditEvent = vi.fn()
  render(
    <CategoryPanel category={categoryById('7.6')} review={newReview().categories['7.6']} open onToggle={vi.fn()} onEvent={vi.fn()}
      findings={[finding]} applied={[]} sectionTitleOf={() => 'S1'} onEditEvent={onEditEvent} onFocusFinding={vi.fn()} />,
  )
  expect(screen.getByRole('button', { name: /7\.6 .*1 suggestion/ })).toBeInTheDocument()
  const zone = screen.getByRole('group', { name: 'What a rule found' })
  fireEvent.click(within(zone).getByRole('button', { name: 'Replace' }))
  expect(onEditEvent).toHaveBeenCalledWith({ type: 'replace', key: finding.key, replacement: 'wild' })
})

test('with no findings the zone says so without claiming a clean bill', () => {
  render(
    <CategoryPanel category={categoryById('7.6')} review={newReview().categories['7.6']} open onToggle={vi.fn()} onEvent={vi.fn()}
      findings={[]} applied={[]} sectionTitleOf={() => 'S1'} onEditEvent={vi.fn()} onFocusFinding={vi.fn()} />,
  )
  expect(screen.getByText(/That is not a clean bill/)).toBeInTheDocument()
})

test('categories with no rule finder show no findings zone at all', () => {
  render(<CategoryPanel category={categoryById('7.4')} review={newReview().categories['7.4']} open onToggle={vi.fn()} onEvent={vi.fn()} findings={[]} applied={[]} sectionTitleOf={() => ''} />)
  expect(screen.queryByRole('group', { name: 'What a rule found' })).not.toBeInTheDocument()
})
```

Append to `src/components/idea/IdeaScreen.test.tsx`:
```tsx
import { newEdits, reduceEdits, ideaEditKey, type IdeaEdits } from '../../engine/idea/edits'
import type { GateResult } from '../../engine/gate'

const gate = (html: string): GateResult => ({ html, conformance: { blockers: [], issues: [] }, badgeWithheld: false }) as unknown as GateResult
const withHtml = (title: string, html: string): CompiledChapter => ({
  chapter: chapter(title),
  sections: [{ id: `${title}-s1`, title: 'S1', html, notes: [], queue: [], gate: gate(html) }],
  queue: [],
})

/** Slice 1's props plus this slice's, so each test names only what it varies. */
const base = {
  reviews: new Map(), header: newHeader(), onEvent: vi.fn(), onHeaderEvent: vi.fn(), onForget: vi.fn(), onExport: () => 'x',
  edits: new Map<string, IdeaEdits>(), pending: new Set<string>(), onEditEvent: vi.fn(),
}

test('findings are computed from the prepared html and edits suppress them', () => {
  const c = withHtml('4: Nutrition', '<p id="b2c-blk-0">He suffers from asthma.</p>')
  const onEditEvent = vi.fn()
  const { rerender } = render(<IdeaScreen {...base} chapters={[c]} onEditEvent={onEditEvent} />)
  fireEvent.click(screen.getByRole('button', { name: /^7\.6 / }))
  fireEvent.click(screen.getByRole('button', { name: 'Replace' }))
  const key = ideaEditKey('4: Nutrition-s1', 'b2c-blk-0', 0, 'suffers from')
  expect(onEditEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'replace', key, replacement: 'has' })
  const edits = new Map<string, IdeaEdits>([[reviewKeyOf(chapter('4: Nutrition')), reduceEdits(newEdits(), { type: 'replace', key, replacement: 'has' })]])
  rerender(<IdeaScreen {...base} chapters={[c]} edits={edits} onEditEvent={onEditEvent} />)
  expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument()
  expect(screen.getByText('“suffers from” → “has”')).toBeInTheDocument()
})

test('the chapter render beside the panels shows the pending line for a section being re-checked', () => {
  const c = withHtml('4: Nutrition', '<p id="b2c-blk-0">x</p>')
  render(<IdeaScreen {...base} chapters={[c]} pending={new Set(['4: Nutrition-s1'])} />)
  const aside = screen.getByRole('complementary', { name: 'Chapter as it will be published' })
  expect(within(aside).getByText('Re-checking this section…')).toBeInTheDocument()
})
```

Update slice 1's `renderScreen` helper in that file to spread `edits: new Map(), pending: new Set(), onEditEvent: vi.fn()` into the render, and the `props` object in `IdeaScreen.browser.test.tsx` to add `edits: new Map(), pending: new Set(), onEditEvent: () => {}`. Slice 1's test 'the chapter is readable beside the panels, without the accessibility verdicts' still holds against `IdeaChapterRender` (it renders no `Accessibility` heading either); slice 1's switcher test still finds the `h2` chapter heading.

In `src/components/ChapterView.test.tsx`, delete the test 'with audit off, renders the gated body and no accessibility panel'.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/components/idea/`
Expected: FAIL — new props unknown.

- [ ] **Step 3: `CategoryPanel.tsx` — the findings zone**

Add imports: `import type { IdeaFinding } from '../../engine/idea/findings'`, `import type { IdeaEdit, IdeaEditsEvent } from '../../engine/idea/edits'`, `import { FindingRow } from './FindingRow'`, `import { AppliedList } from './AppliedList'`.

Add to props:
```ts
  findings?: readonly IdeaFinding[]
  applied?: readonly { key: string; edit: IdeaEdit; stale: boolean; sectionTitle: string }[]
  sectionTitleOf?: (sectionId: string) => string
  onEditEvent?: (event: IdeaEditsEvent) => void
  onFocusFinding?: (target: { sectionId: string; elementId: string } | undefined) => void
```

Add a constant: `const RULE_CATEGORIES = new Set<CategoryId>(['7.3', '7.6'])` (import `CategoryId`). In the header, after the rated summary, add a count when the category has a finder:
```tsx
          {RULE_CATEGORIES.has(category.id) && (
            <span className="text-xs font-normal text-neutral-600 dark:text-neutral-400">
              {` · ${(findings ?? []).length} suggestion${(findings ?? []).length === 1 ? '' : 's'}`}
            </span>
          )}
```
Between the restorative block and the checklist fieldset, insert:
```tsx
          {RULE_CATEGORIES.has(category.id) && (
            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 text-sm font-semibold">{IDEA_COPY.findings.heading}</legend>
              {(findings ?? []).length === 0
                ? <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{IDEA_COPY.findings.none}</p>
                : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {(findings ?? []).map((f) => (
                      <FindingRow key={f.key} finding={f} sectionTitle={sectionTitleOf?.(f.sectionId) ?? ''} onEvent={(e) => onEditEvent?.(e)} onFocus={(t) => onFocusFinding?.(t)} />
                    ))}
                  </ul>
                )}
              <div className="mt-3">
                <AppliedList applied={applied ?? []} onUndo={(key) => onEditEvent?.({ type: 'undo', key })} />
              </div>
            </fieldset>
          )}
```

- [ ] **Step 4: `IdeaScreen.tsx` — compute findings, applied, and swap the render**

Add props `edits`, `onEditEvent`, `pending` (types above). Add imports: `findingsFor`, `findingsByCategory` from `../../engine/idea/findings`; `newEdits`, `parseIdeaEditKey`, `IdeaEdits`, `IdeaEditsEvent` from `../../engine/idea/edits`; `findOccurrence` from `../../engine/idea/text`; `IdeaChapterRender` from `./IdeaChapterRender`; `useMemo`. Remove the `ChapterView` import.

The `focus` state must be declared with the other `useState`s above the early return (hooks must precede it):
```tsx
  const [focus, setFocus] = useState<{ sectionId: string; elementId: string } | undefined>()
```

Inside the component, after `review`:
```tsx
  const chapterEdits = edits.get(key) ?? newEdits()
  const findings = useMemo(
    () => current.sections.flatMap((s) => findingsFor({ id: s.id, html: s.gate?.html ?? s.html }, chapterEdits)),
    [current, chapterEdits],
  )
  const byCategory = findingsByCategory(findings)
  const sectionTitleOf = (id: string) => current.sections.find((s) => s.id === id)?.title ?? ''
  /**
   * Stale = the edit's original is no longer at its key in the CURRENT bytes.
   * Computed here, against the same html the render shows, rather than
   * carried in the map: the map records a decision, not whether it landed.
   */
  const applied = [...chapterEdits.edits.entries()].map(([k, edit]) => {
    const { sectionId, elementId, occurrence, original } = parseIdeaEditKey(k)
    const section = current.sections.find((s) => s.id === sectionId)
    const html = section?.gate?.html ?? section?.html ?? ''
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const el = doc.getElementById(elementId)
    // After a replace the original is GONE by design; a stale replace is one
    // where neither the original nor the replacement is at that element.
    const present = el !== null && (
      (edit.kind === 'replace' && (el.textContent ?? '').includes(edit.replacement)) ||
      (edit.kind === 'keep' && findOccurrence(el, original, occurrence) !== undefined)
    )
    return { key: k, edit, stale: !present, sectionTitle: section?.title ?? '' }
  })
```
Pass to each `CategoryPanel`: `findings={byCategory.get(category.id) ?? []} applied={applied} sectionTitleOf={sectionTitleOf} onEditEvent={(e) => onEditEvent(key, e)} onFocusFinding={setFocus}`.

In slice 1's aside, replace `<ChapterView compiled={current} audit={false} />` with:
```tsx
          <IdeaChapterRender compiled={current} target={focus} pending={pending} />
```
Nothing is added below the panels; the aside is the render.

Then in `src/components/ChapterView.tsx`, remove the `audit` prop: restore the signature to `({ compiled }: { compiled: CompiledChapter })`, drop the `audit &&` guards, and delete the paragraph of the header comment that described the prop.

- [ ] **Step 5: `App.tsx` — compose**

Imports: `useIdeaRecompile` from `./components/idea/useIdeaRecompile`; `mergeQueues` from `./engine/compile/index` (already imported for `partial`).

The initial compile receives the chapter's persisted edits, so a re-prepared chapter comes back with its wording applied and gated in one pass, the way it would if the edits had been made a minute ago. In `compileForReview`, add to the `compileAndAuditChapter` options:
```ts
      ideaEdits: ideaReviews.editsFor(reviewKeyOf(ch)).edits,
```
(If the IndexedDB read has not returned by the time a chapter is prepared, the restore changes `edits`, and `useIdeaRecompile` below recompiles the affected sections then. Both orders end in the same bytes.)

After `ideaReviews`:
```ts
  const onRebuilt = useCallback((chapterKey: string, sections: readonly CompiledSection[]) => {
    setPrepared((all) => all.map((c) => {
      if (reviewKeyOf(c.chapter) !== chapterKey) return c
      const byId = new Map(sections.map((s) => [s.id, s]))
      const next = c.sections.map((s) => byId.get(s.id) ?? s)
      return { ...c, sections: next, queue: mergeQueues(next) }
    }))
  }, [])
  const { pending: ideaPending } = useIdeaRecompile({
    prepared, answers, edits: ideaReviews.edits,
    profileOf: (ch) => publisherProfiles[ch.source],
    onRebuilt,
  })
```
`clearDerivedOutput()` is unchanged — edits are keyed by chapter identity and persist, like the reviews (spec §2.7). `IdeaScreen` render gains `edits={ideaReviews.edits} onEditEvent={ideaReviews.dispatchEdit} pending={ideaPending}`.

`unansweredCount` must also count queue items a rebuilt section reintroduces (none in this slice — `applyIdeaEdits` adds no queue items; slice 5 will). Leave as is.

- [ ] **Step 6: Run everything**

Run: `npm run typecheck && npx vitest run --project unit && npx vitest run --project browser src/components/idea/`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/components/idea src/components/ChapterView.tsx src/components/ChapterView.test.tsx src/App.tsx
git commit -m "feat: rule findings in the IDEA panels, applied through recompile to the export

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 9: Golden, docs, and acceptance

**Files:**
- Modify: `src/engine/compile/golden.test.ts` (one new case), create `src/engine/compile/__goldens__/page-section.idea-edits.compiled.html`
- Modify: `docs/IDEA.md`, `README.md`, `docs/RELEASE-ACCEPTANCE.md`

- [ ] **Step 1: Add the golden case**

Append to `src/engine/compile/golden.test.ts`:
```ts
import { ideaEditKey, type IdeaEdit } from '../idea/edits'

describe('compile page-section with IDEA edits', () => {
  const { section, ctx } = fixtureContext('page-section')
  // The fixture's first block. Read the golden to pick a real phrase: this
  // uses the first three words of `b2c-blk-0` so the case stays anchored to
  // text that exists.
  const plain = compileSection(section, ctx)
  const first = new DOMParser().parseFromString(`<body>${plain.html}</body>`, 'text/html').getElementById('b2c-blk-0')
  const original = (first?.textContent ?? '').trim().split(/\s+/).slice(0, 3).join(' ')
  const edits = new Map<string, IdeaEdit>([[ideaEditKey(section.id, 'b2c-blk-0', 0, original), { kind: 'replace', replacement: 'REPLACED WORDS HERE' }]])
  const out = compileSection(section, { ...ctx, ideaEdits: edits })

  it('applies the edit and appends the change note; nothing else moves', () => {
    expect(out.html).toContain('REPLACED WORDS HERE')
    expect(out.html).toContain('b2c-idea-change')
    golden('page-section.idea-edits.compiled.html', `${out.html}\n`)
  })
})
```
Run once with `UPDATE_GOLDENS=1` to create the file, read it, commit it.

- [ ] **Step 2: Docs**

`docs/IDEA.md` — replace the "Slice 1 (this release)" heading with "Slices 1–2 (this release)" and add under Network/Storage/Inference/Gate:
```markdown
- **Rule checks:** the terminology, gendered-noun, and idiom lists are vendored JSON
  (`src/engine/idea/data/`, CC BY 4.0) and run in the browser over the compiled section; no
  network.
- **Edits:** an accepted suggestion is a map entry applied by a compile step on every recompile,
  including the first compile of a re-prepared chapter. The section is re-audited before it can be
  published again. Every applied edit adds one sentence to the page's Source-and-license block:
  "Modified from the original: wording updated for inclusive language."
- **Storage, extended:** edits are saved in the same IndexedDB document as the ratings and
  restored through the same validating replay; *Forget all IDEA reviews* removes them too. A
  dismissed suggestion is not saved — it is hidden for this session only.
- **The queue's answers now leave the queue screen:** Plan's count and the export describe the
  answered chapter (a pre-existing gap closed by this slice's first task).
```

`README.md` — extend the IDEA paragraph with:
```markdown
Two categories — appropriate terminology and gender-inclusive nouns — also get rule-based
suggestions from a vendored, curated list (CC BY 4.0; the list names its sources). A suggestion
never changes the page until the instructor presses Replace; a term inside a quotation is offered
"Keep, add context" first, following the Framework's guidance for historical usage. Every applied
change is listed with Undo, and the page's Source-and-license block records that wording was
modified, as CC BY requires.
```

`docs/RELEASE-ACCEPTANCE.md` — append:
```markdown
## 5. IDEA review — slice 2

1. Prepare an OpenStax chapter whose text contains "suffers from" or "chairman" (Human Biology
   4.2 Nutrients, or paste a paragraph via the Text tab).
2. IDEA → 7.6 shows "N suggestions" in its header; open it. Focus the Replace button: the
   paragraph is outlined in the chapter render beside the panels and scrolled into view.
3. Replace one; it moves to Applied; the render shows "Re-checking this section…" and then the
   new wording within a second, and the Source-and-license block ends with the "Modified from the
   original" sentence.
4. Undo it; the wording and the sentence revert.
5. Replace it again. **Reload the tab** and prepare the same chapter: the replacement is already
   applied in the render, listed under Applied, and the sentence is present — without pressing
   anything. Dismiss a different suggestion, reload again: it is back.
6. Export the cartridge, unzip: the page HTML carries the replacement and the sentence; no
   `idea-rubric1-*` file is inside.
7. Answer an alt-text item in Review before step 6 if any exist: the exported page carries the
   answered alt (Task 1's lift).
8. **Forget all IDEA reviews** → confirm. Applied is empty; the render shows the original wording
   after the recompile.
```

- [ ] **Step 3: Full suite and commit**

Run: `npm run typecheck && npm test`
Expected: green.

```bash
git add src/engine/compile/golden.test.ts src/engine/compile/__goldens__/page-section.idea-edits.compiled.html docs/IDEA.md README.md docs/RELEASE-ACCEPTANCE.md
git commit -m "docs: pin IDEA edits with a golden and record the slice-2 obligations

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (slice 2 = §8.2):** `terms.ts`/`idioms.ts` (§3.1, §3.2) → Tasks 4–5; curated list with the software-context rules dropped and pronoun rules as observations → Task 4 data + Task 5 `edit:false`; quotation guard → Task 2 `isQuotation` + Task 5; case preservation + inline-boundary refusal → Task 2 + Task 3; `applyIdeaEdits` with stale drop + `FixNote` (§2.4) → Task 3; change note in attribution (§2.4) → Task 3; re-run semantics (§3.6) → Task 5 `findingsFor` suppression + Task 6 recompile; highlight-on-focus, Replace/Edit/Keep/Dismiss, Applied/Undo, draft-vs-rule visual (§5.3) → Tasks 7–8; edits flow to export via recompile→gate→`prepared` → Tasks 1, 6, 8; golden (§7.3) → Task 9; data boundary docs (§7.2) → Task 9. Not in this slice: 7.1/7.7 inventories (slice 3), model (slice 4), images (slice 5).

**Placeholder scan:** none. Every step shows code.

**Alignment with the revised slice 1 (2026-09-11):** edits persist in the same document as reviews through `toPersisted(header, reviews, edits)` / `restore` (Task 6), so `forgetAll` is the one forget and `clearDerivedOutput` touches neither; the initial compile receives persisted edits (Task 8); `IdeaChapterRender` replaces `ChapterView` inside slice 1's aside rather than adding a second render (Tasks 7–8), and `ChapterView.audit` goes away; every `IdeaScreen` render in tests carries slice 1's `header` / `onHeaderEvent` / `onForget`.

**Type consistency:** `ideaEditKey(sectionId, elementId, occurrence, original)` everywhere; `IdeaEditsEvent` union identical in Tasks 2, 6, 7, 8; `IdeaRecompileDeps.recompile(chapter, ids, { profile, answers, ideaEdits })` matches `recompileSections`'s opts after Task 3; `findingsFor(section, edits)` signature identical in Tasks 5 and 8; `CategoryPanel` new props identical in Tasks 8 test and implementation; `useIdeaReviews` returns `edits` / `editsFor` / `dispatchEdit` in Task 6 and App consumes exactly those in Task 8; `IdeaChapterRender({ compiled, target, pending })` identical in Tasks 7 and 8; `reviewKeyOf` from slice 1 reused unchanged.
