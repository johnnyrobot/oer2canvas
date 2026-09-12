# IDEA Review — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the optional IDEA phase to oer2canvas with the Framework's eight categories as checklists, a human-only Rubric 1 rating per rubric row, notes, Rubric 1's chapter-level Summary and Suggestions, a session-level assessor and BIPOC benchmark, the chapter readable beside the panels, reviews that survive a reload, and a Markdown + JSON Rubric 1 download — no findings, no model, no image search yet.

**Architecture:** Two pure reducers in `src/engine/idea/review.ts` hold every rule: `(review, event) => review` for one chapter's rubric and `(header, event) => header` for the assessor and benchmark, which Rubric 1 asks for once, not once per chapter. A thin React hook holds one review per prepared chapter plus the header, and persists both to the app's existing IndexedDB store so an hour of rubric work is not lost to a reload or a re-prepare. The vendored Framework text lives in a typed constant module, quoted in full from the March 2025 document. A pure export module turns a review and header into Markdown and JSON in Rubric 1's own shape. The shell gains a sixth `PhaseId` that is always reachable once chapters are prepared and never affects Plan. The screen is eight collapsible panels per chapter with the chapter's repaired HTML rendered beside them, so the instructor reads what they rate; adding findings in slice 2 is adding a zone inside a panel, not a new screen.

**Tech Stack:** TypeScript, React 19, Vite, Vitest 4 (jsdom `unit` project + Playwright `browser` and `browser-forced-colors` projects), Testing Library, axe-core, lucide-react, Tailwind.

**Spec:** `docs/IDEA_REVIEW_SPEC.md` (§2.1, §2.5, §2.7, §5, §7.2, §7.3, §8 slice 1). The spec was revised 2026-09-11 alongside this plan; the four decisions that changed are recorded there, not here: ratings are per Rubric 1 row (7.1 has three), the assessor and benchmark are session-level, reviews persist in the browser, and the chapter renders on the IDEA screen.

## Global Constraints

- **The rating is never machine-written.** No code path outside a user event dispatches a `rate` event. Restoring a saved review replays the instructor's own events through the reducer; it never invents one. (Spec §1, §2.1.)
- **IDEA never gates Plan.** `phaseAvailability(s).plan` must not read any IDEA field. (Spec §5.1.)
- **IDEA never reaches `done` on its own.** Its availability is `'available'` with a detail string, never `'done'`. (Spec §5.1.)
- **No network in tests.** `src/test/setup.ts` throws on any `fetch`; nothing in this slice fetches. Storage is a `KeyValueStore` injected into the hook; tests pass an in-memory one.
- **User-facing strings live in one constants object per component** (`src/components/idea/copy.ts`), quoted from the spec, never re-derived. (Spec §5.3.)
- **The Framework text is CC BY 4.0, reproduced in full, and attributed** in the panel footer and in `THIRD-PARTY-NOTICES.md`. Where this plan departs from the source text it says so in the module (one run-on example paragraph is kept with its bullet; nothing is shortened). (Spec §2.1, §7.2.)
- **Rubric 1 is download-only, never packaged into the cartridge.** (Spec §2.5.)
- **Reviews are stored only in this browser** (IndexedDB, the app's existing `oer2canvas` database) and only until the instructor forgets them. Nothing about a review leaves the device. (Spec §2.7, §7.2.)
- **Every control clears 24×24** — use the shell's `min-h-9 min-w-9` pattern. Inline links in running text are exempt (WCAG 2.2 SC 2.5.8 inline exception). **`aria-disabled`, never `disabled`**, on anything that carries a reason.
- **Tailwind classes follow the shell's palette** (`bg-white dark:bg-neutral-900`, `border-neutral-200 dark:border-neutral-800`, `text-brand-700 dark:text-brand-300`); no new colours.
- Copy for the one string that argues, verbatim: *"Rate what you observed, not what the tool counted. The counts and drafts are evidence; the judgment is yours."*
- Run `npm run typecheck` before every commit; the `build` script runs it and CI refuses type errors.
- Commit messages: imperative, lower-case type prefix (`feat:`, `test:`, `docs:`), ending with the trailer `Co-Authored-By: Claude <model name> <noreply@anthropic.com>` for the model that is actually running. No session links of any kind.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/engine/idea/framework.ts` | The vendored Framework: category ids, §7 titles, Rubric 1 titles, restorative requirement, elements for consideration (stable ids), Rubric 1 rows, resource links. Pure data + one lookup. |
| `src/engine/idea/review.ts` | `IdeaReview` / `IdeaHeader` types, `newReview()`, `newHeader()`, `reduceReview()`, `reduceHeader()`, `isCategoryRated()`, `ratedCount()`, `ratingCounts()`. Pure. |
| `src/engine/idea/store.ts` | `toPersisted()` / `restore()`: the shape written to IndexedDB and the validating read that replays it through the reducers. Pure. |
| `src/engine/idea/rubric-export.ts` | `rubric1Markdown()`, `rubric1Json()`, `rubric1Filename()`. Pure. |
| `src/engine/idea/download.ts` | `downloadTextFile()` — the same anchor-click pattern as `engine/export/download.ts`, for text. |
| `src/shell/phases.ts` | Add `'idea'` to `PhaseId`/`PHASE_ORDER`/`PHASE_LABEL`; `ShellState.ideaRated/ideaTotal`; `ideaSummary()`; availability with a `detail`. |
| `src/shell/AppShell.tsx` | Icon for the new phase; render `detail` on an available phase. |
| `src/shell/PlanScreen.tsx` | Show the IDEA summary line above the commit control. |
| `src/components/ChapterView.tsx` | Gains `audit?: boolean` so the IDEA screen can show the chapter without the accessibility verdicts. |
| `src/components/idea/copy.ts` | Every user-facing string on the IDEA screen. |
| `src/components/idea/CategoryPanel.tsx` | One category: restorative requirement, checklist, rubric rows, notes. |
| `src/components/idea/IdeaScreen.tsx` | Header (assessor, benchmark, export, forget), chapter switcher, eight panels, Summary and Suggestions, the chapter render. |
| `src/components/idea/useIdeaReviews.ts` | Hook: header + `Map<reviewKey, IdeaReview>`, `dispatch`, `dispatchHeader`, `forgetAll`, persistence through an injected `KeyValueStore`. |
| `src/App.tsx` | Mount the phase, derive shell counts, wire export and storage. |
| `README.md`, `PRIVACY.md`, `THIRD-PARTY-NOTICES.md`, `docs/IDEA.md`, `docs/RELEASE-ACCEPTANCE.md` | Obligations, storage disclosure, attribution, data boundary, acceptance scenario. |

---

### Task 1: The vendored Framework module

**Files:**
- Create: `src/engine/idea/framework.ts`
- Test: `src/engine/idea/framework.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type CategoryId = '7.1' | '7.2' | '7.3' | '7.4' | '7.5' | '7.6' | '7.7' | '7.8'
  export const IDEA_CATEGORY_IDS: readonly CategoryId[]
  export interface FrameworkElement { id: string; text: string }         // id like '7.6.3'
  export interface RubricRow { id: string; exclusive: string; emerging: string; inclusive: string }  // id like '7.1.a'
  export interface FrameworkResource { label: string; url: string }
  export interface IdeaCategory {
    id: CategoryId; title: string; rubricTitle: string; restorative: string
    elements: readonly FrameworkElement[]; rows: readonly RubricRow[]; resources: readonly FrameworkResource[]
  }
  export const IDEA_FRAMEWORK: readonly IdeaCategory[]
  export const FRAMEWORK_ATTRIBUTION: { title: string; author: string; url: string; license: { name: string; url: string } }
  export const RUBRIC_NA_TEXT: string
  export const RUBRIC_SUMMARY_HINT: string
  export const RUBRIC_SUGGESTIONS_HINT: string
  export function categoryById(id: CategoryId): IdeaCategory
  ```

- [ ] **Step 1: Write the failing test**

`src/engine/idea/framework.test.ts`:
```ts
import { FRAMEWORK_ATTRIBUTION, IDEA_CATEGORY_IDS, IDEA_FRAMEWORK, categoryById } from './framework'

test('the Framework has the eight categories in document order', () => {
  expect(IDEA_FRAMEWORK.map((c) => c.id)).toEqual(['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7', '7.8'])
  expect(IDEA_CATEGORY_IDS).toEqual(IDEA_FRAMEWORK.map((c) => c.id))
})

// Ids are what the review map and the export key on, so a duplicate would make
// two checklist answers or two ratings silently overwrite each other.
test('every element id and rubric row id is unique across the whole Framework', () => {
  const ids = IDEA_FRAMEWORK.flatMap((c) => [...c.elements.map((e) => e.id), ...c.rows.map((r) => r.id)])
  expect(new Set(ids).size).toBe(ids.length)
  for (const c of IDEA_FRAMEWORK) {
    for (const e of c.elements) expect(e.id.startsWith(`${c.id}.`), e.id).toBe(true)
    for (const r of c.rows) expect(r.id.startsWith(`${c.id}.`), r.id).toBe(true)
  }
})

// Rubric 1 gives Illustrations and Photos three rows and every other category one.
test('rubric rows match Appendix A', () => {
  expect(categoryById('7.1').rows).toHaveLength(3)
  for (const id of IDEA_CATEGORY_IDS.filter((c) => c !== '7.1')) {
    expect(categoryById(id).rows, id).toHaveLength(1)
  }
})

// The element counts are the document's. A dropped bullet is a silently
// narrower checklist, so the counts are pinned, not just "at least three".
test('the elements for consideration are all present', () => {
  const counts = Object.fromEntries(IDEA_FRAMEWORK.map((c) => [c.id, c.elements.length]))
  expect(counts).toEqual({ '7.1': 5, '7.2': 5, '7.3': 5, '7.4': 7, '7.5': 6, '7.6': 6, '7.7': 3, '7.8': 6 })
})

// Two places the source text is easy to abridge and was, in an earlier draft.
test('the text is quoted in full, not shortened', () => {
  expect(categoryById('7.6').restorative).toContain('“schizophrenics”')
  expect(categoryById('7.6').restorative).toContain('“primary” bedroom')
  expect(categoryById('7.6').elements[4].text).toContain('Language that is offensive to people with disabilities is ableist.')
  expect(categoryById('7.5').elements[5].text).toContain('The Red Badge of Courage')
  expect(categoryById('7.8').elements[5].text).toContain('“rural communities tend to support gun rights.”')
})

test('no category is empty of guidance', () => {
  for (const c of IDEA_FRAMEWORK) {
    expect(c.title, c.id).not.toBe('')
    expect(c.rubricTitle, c.id).not.toBe('')
    expect(c.restorative.length, c.id).toBeGreaterThan(80)
    for (const r of c.rows) {
      expect(r.exclusive, r.id).not.toBe('')
      expect(r.emerging, r.id).not.toBe('')
      expect(r.inclusive, r.id).not.toBe('')
    }
  }
})

test('the attribution names the CC BY 4.0 licence', () => {
  expect(FRAMEWORK_ATTRIBUTION.license.name).toBe('CC BY 4.0')
  expect(FRAMEWORK_ATTRIBUTION.license.url).toMatch(/^https:\/\/creativecommons\.org\/licenses\/by\/4\.0/)
  expect(FRAMEWORK_ATTRIBUTION.url).toMatch(/^https:\/\/asccc-oeri\.org\//)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/engine/idea/framework.test.ts`
Expected: FAIL — `Cannot find module './framework'`.

- [ ] **Step 3: Write the module**

The data block below was generated from the March 2025 Word document (`~/code/oeri-idea/IDEA-Framework-March-2025-Word.docx`, paragraphs under each §7 heading and the Appendix A checkboxes), so it is the document's own punctuation, including curly quotes, the hyphen in "30-70%", and the missing full stop on some rubric cells. Do not "tidy" it. The one editorial act is stated in the header comment.

`src/engine/idea/framework.ts`:
```ts
/**
 * The ASCCC OERI IDEA Framework, vendored IN FULL.
 *
 * Text is quoted from the "ASCCC OERI Inclusion, Diversity, Equity, and
 * Anti-Racism (IDEA) Framework and Implementation Guide, March 2025", which is
 * licensed CC BY 4.0. Every screen that shows this text shows
 * `FRAMEWORK_ATTRIBUTION` beside it; THIRD-PARTY-NOTICES.md carries it too.
 *
 * Quoted, not paraphrased, and not shortened: the earlier draft of this file
 * trimmed the examples out of 7.5, 7.6 and 7.8, and the examples are the part
 * an instructor unfamiliar with the Framework actually needs. The document's
 * own punctuation is kept — curly quotes, "30-70%" with a hyphen, cells with
 * and without a final full stop — because "quoted" has to mean quoted. The
 * ONE editorial act: in 7.5 the document sets a "For example, …" paragraph
 * under its fourth bullet without a bullet of its own; it is kept with that
 * bullet's text (7.5.4) rather than promoted to a bullet or dropped.
 *
 * Ids are STABLE and are what the review map keys on. Renumbering an element
 * is a data migration, not an edit: a saved checklist answer for '7.6.2' must
 * still mean "insert context, attribution, or quotations for historical
 * references" next year. Append; never renumber.
 *
 * `title` is the §7 heading; `rubricTitle` is the same category's heading in
 * Appendix A, which differs for five of the eight ("Illustrations and Photos
 * of People", "Incorporating Diverse Perspectives"). The screen shows `title`
 * because the restorative text sits under it; the export shows `rubricTitle`
 * because the export is Rubric 1.
 *
 * Rubric rows come from Appendix A (Rubric 1). Category 7.1 has three rows
 * there, each with its own "not applicable" box; every other category has one.
 * That asymmetry is the document's and is preserved rather than flattened,
 * because an assessor filling in Rubric 1 by hand answers all three.
 */
export type CategoryId = '7.1' | '7.2' | '7.3' | '7.4' | '7.5' | '7.6' | '7.7' | '7.8'

export interface FrameworkElement {
  /** `<category>.<n>`, e.g. `7.6.3`. Ours; the document does not number its bullets. */
  id: string
  text: string
}

export interface RubricRow {
  /** `<category>.<letter>`, e.g. `7.1.b`. */
  id: string
  exclusive: string
  emerging: string
  inclusive: string
}

export interface FrameworkResource {
  label: string
  url: string
}

export interface IdeaCategory {
  id: CategoryId
  /** The §7 heading. */
  title: string
  /** The same category's heading in Appendix A, Rubric 1. */
  rubricTitle: string
  /** The "Restorative Requirements" paragraph. */
  restorative: string
  /** The "Elements for Consideration" bullets. */
  elements: readonly FrameworkElement[]
  /** Rubric 1 rows for this category. */
  rows: readonly RubricRow[]
  /** The category's entries under §8.0 "Additional Resources". */
  resources: readonly FrameworkResource[]
}

export const FRAMEWORK_ATTRIBUTION = {
  title: 'ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism (IDEA) Framework and Implementation Guide, March 2025',
  author: 'ASCCC Open Educational Resources Initiative',
  url: 'https://asccc-oeri.org/asccc-oeri-inclusion-diversity-equity-and-anti-racism-idea-audit-framework/',
  license: { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' },
} as const

/** The "Not Applicable" box every Rubric 1 row carries. */
export const RUBRIC_NA_TEXT = 'This category does not apply to this resource. Explain in notes.'
/** Rubric 1's instructions for its two chapter-level free-text fields. */
export const RUBRIC_SUMMARY_HINT = 'Use this section to highlight main points and key information about the rubric assessments.'
export const RUBRIC_SUGGESTIONS_HINT = 'Use this section to provide any IDEA related suggestions beyond the specific feedback you provided on the rubric.'

export const IDEA_FRAMEWORK: readonly IdeaCategory[] = [
  {
    id: '7.1',
    title: 'Illustrations and Photos',
    rubricTitle: 'Illustrations and Photos of People',
    restorative:
      'When illustrations and photos are reflective of diverse populations, students can see themselves, or people like them, in the learning materials. At the same time, visuals should not serve to perpetuate stereotypes. When images of people are not a typical element of the resources for a discipline (such as math or physics), consider incorporating images to humanize the content.',
    elements: [
      { id: '7.1.1', text: 'Consider diversity in terms of race, ethnicity, age, gender, gender expression, physical and mental abilities, sexual orientation and more.' },
      { id: '7.1.2', text: 'Examine the number of images and illustrations and the individuals and populations represented therein. Ensure that all populations are equitably represented throughout the resource.' },
      { id: '7.1.3', text: 'Include images of people where the context of the image does not relate to their identity.' },
      { id: '7.1.4', text: 'Analyze the role, depiction, connotation, expressions of authority, and purpose of the people represented in the image. Ensure that images do not perpetuate stereotypes. Examine the background or setting of the image to assess whether it depicts anything that may be perceived as negative.' },
      { id: '7.1.5', text: 'Consider diversity on a section or chapter level and in the work as a whole. Although it is impossible to represent every population in every illustration or photo, the resource should include a diversity of images and illustrations throughout.' },
    ],
    rows: [
      { id: '7.1.a', exclusive: 'Less than 30% of photos and illustrations include BIPOC', emerging: '30-70% of photos and illustrations include BIPOC', inclusive: 'More than 70% of photos and illustrations include BIPOC' },
      { id: '7.1.b', exclusive: 'Very few to no examples of diversity beyond race and ethnicity.', emerging: '1-2 examples of diversity beyond race and ethnicity.', inclusive: 'More than 2 examples of diversity beyond race and ethnicity.' },
      { id: '7.1.c', exclusive: 'Many examples of illustrations and photos that are not culturally sensitive or appropriate. Include examples in notes', emerging: 'Some examples of illustrations and photos that are not culturally sensitive or appropriate. Include examples in notes', inclusive: 'Very few to no examples of illustrations and photos that are not culturally sensitive or appropriate. Include examples in notes' },
    ],
    resources: [
      { label: 'Sources of stock photos featuring people of color', url: 'https://www.diversetechgeek.com/stock-photos-people-of-color/' },
      { label: 'Sources of free LGBTQ stock photos', url: 'https://www.diversetechgeek.com/sources-free-lgbtq-stock-photos/' },
      { label: 'List of diverse and free stock photo sites', url: 'https://blog.walls.io/socialmedia/diverse-and-free-stock-photo-sites/' },
      { label: 'Source of free photos of Black and Brown people (nappy)', url: 'https://nappy.co/' },
    ],
  },
  {
    id: '7.2',
    title: 'Example Names',
    rubricTitle: 'Example Names',
    restorative:
      'Names of people are often needed for examples, exercises, and scenarios, and they should represent various countries of origin, ethnicities, genders, and races and be properly portrayed. At the same time, negative comparisons or stereotypes associated with particular names and national origins or ethnicities should be avoided.',
    elements: [
      { id: '7.2.1', text: 'Consider the diversity and overall representation on a quantitative and qualitative basis.' },
      { id: '7.2.2', text: 'Determine whether names indicative of a particular race, ethnicity, or national origin are associated with stereotypes or negative concepts.' },
      { id: '7.2.3', text: 'Seek other opinions, including those of students, when necessary.' },
      { id: '7.2.4', text: 'Seek out name pronunciations, if in doubt, when recording video presentations or lectures.' },
      { id: '7.2.5', text: 'Consider using your own roster of students to find diverse names.' },
    ],
    rows: [
      { id: '7.2.a', exclusive: 'Less than 30% of names reflect BIPOC culture', emerging: '30-70% of names reflect BIPOC culture', inclusive: 'More than 70% of names reflect BIPOC culture' },
    ],
    resources: [
      { label: 'Popular names from around the world', url: 'https://babynames.mom.com/name-list/global' },
      { label: 'Multicultural names', url: 'https://nameberry.com/userlist/view/62227/all' },
      { label: 'Gender neutral names', url: 'https://nameberry.com/unisex-names' },
      { label: 'Name pronunciation guide', url: 'https://www.pronouncenames.com/' },
    ],
  },
  {
    id: '7.3',
    title: 'Gender-Inclusive Language and Use of Pronouns',
    rubricTitle: 'Gender Inclusive Language and Use of Pronouns',
    restorative:
      'Gender inclusivity is important because all students should be able to see themselves represented. Gender inclusive language can refer to the use of gender-neutral pronouns or language that intentionally dispels gender stereotypes.',
    elements: [
      { id: '7.3.1', text: 'Pay attention to connotations and make sure that gender stereotypes are not perpetuated. If in doubt, ask for another opinion.' },
      { id: '7.3.2', text: 'Use pronouns clearly. If using traditionally plural pronouns (such as them or they) confuses the context, change the wording to reflect the situation clearly.' },
      { id: '7.3.3', text: 'Explicitly state what pronouns an individual uses, if appropriate.' },
      { id: '7.3.4', text: 'Consider reducing the use of pronouns and rewriting sentences to eliminate pronouns.' },
      { id: '7.3.5', text: 'Avoid making assumptions about an individual’s gender.' },
    ],
    rows: [
      { id: '7.3.a', exclusive: 'Many examples of language that is not gender inclusive and inappropriate use of pronouns. Include examples in notes.', emerging: 'Some examples of language that is not gender inclusive and inappropriate use of pronouns. Include examples in notes.', inclusive: 'Very few to no examples of language that is not gender inclusive and inappropriate use of pronouns. Include examples in notes.' },
    ],
    resources: [
      { label: 'GLSEN Pronoun Guide', url: 'https://www.glsen.org/activity/pronouns-guide-glsen' },
      { label: 'Alternatives to gendered nouns (EIGE)', url: 'https://eige.europa.eu/publications-resources/toolkits-guides/gender-sensitive-communication/practical-tools/examples-common-gendered-nouns-alternatives' },
      { label: 'GLSEN Gender Terminology Guide', url: 'https://www.glsen.org/activity/gender-terminology' },
      { label: 'Key gender and sexuality terms (MSU)', url: 'https://gscc.msu.edu/education/glossary.html' },
      { label: 'Gender-Inclusive Biology', url: 'https://www.genderinclusivebiology.com/' },
    ],
  },
  {
    id: '7.4',
    title: 'Diverse Authors, Researchers, and Studies',
    rubricTitle: 'Diverse Authors, Researchers, and Studies',
    restorative:
      'Referencing discipline contributors—e.g., researchers, scholars, academics—with backgrounds like those of students both validates and affirms the students as student-scholars and invites them into the academic conversation. Recognize that all people carry around biases that affect what they include and exclude. Counteract these biases by actively seeking out achievements and discipline contributions from all cultures and countries. Note that diversity may not be perceptible in some of the references. Consider the use of open-source articles and diversify research by using diverse resources.',
    elements: [
      { id: '7.4.1', text: 'Examine the diversity of included contributors in the discipline. If diversity is lacking, seek diversity in the contributions mentioned.' },
      { id: '7.4.2', text: 'If the contributions are dominated by cis-hetero white men, discuss this with the class and include some of the historical and structural explanations for the lack of diversity i.e., lack of educational opportunities for minoritized groups.' },
      { id: '7.4.3', text: 'Include current, more diverse contributors when possible and relevant where historical contributors are not diverse. Keep in mind that your goal is to ensure the inclusion of forgotten perspectives.' },
      { id: '7.4.4', text: 'Avoid isolating diverse contributors to specific sections, e.g., “multicultural impacts on psychology.”' },
      { id: '7.4.5', text: 'Include examples of and references to historically underrepresented groups, such as Arabic contributors to mathematics and astronomy.' },
      { id: '7.4.6', text: 'Seek out specific efforts and programs to drive inclusive citation.' },
      { id: '7.4.7', text: 'If less formal, in-text mentions of specific researchers or studies are included, these references should be as diverse as possible.' },
    ],
    rows: [
      { id: '7.4.a', exclusive: 'Very few to no examples of diverse authors and researchers with few to no studies related to BIPOC', emerging: 'Some examples of diverse authors and researchers with some studies related to BIPOC', inclusive: 'Many examples of diverse authors and researchers with many studies related to BIPOC' },
    ],
    resources: [
      { label: '500 Queer Scientists', url: 'https://500queerscientists.com/' },
      { label: 'Cite Black Authors', url: 'https://citeblackauthors.com/listings/' },
      { label: 'Disabled Writers Database', url: 'https://disabledwriters.com/the-database/' },
      { label: 'Scientist Spotlights Initiative', url: 'https://scientistspotlights.org/' },
      { label: 'Directory of Open Access Journals', url: 'https://doaj.org/' },
    ],
  },
  {
    id: '7.5',
    title: 'Applications, Examples, and Problem Scenarios that Relate to Diverse Audiences',
    rubricTitle: 'Applications, Examples and Problem Scenarios',
    restorative:
      'When using real-world examples, one should include diverse and relatable examples for students and avoid stereotypes. This should be done on a chapter or section basis in the resource as well as holistically. Examples that rely on cultural knowledge will not be understandable by everyone and should be appropriately explained.',
    elements: [
      { id: '7.5.1', text: 'Review, and potentially have students review, problems and exercises, giving special consideration to their context and inclusivity.' },
      { id: '7.5.2', text: 'Analyze terminology, contexts, and situations presented in problems and applications to ensure that they are comprehensible by all populations.' },
      { id: '7.5.3', text: 'Write and use examples that include diverse people, organizations, geographies, and situations.' },
      { id: '7.5.4', text: 'Avoid negative stereotypes or sensitive subjects in problems and applications unless the subject matter demands it. For example, a section on mental health may require statistics on suicide rates, but a math textbook can likely employ an example that does not rely on such sensitive material.' },
      { id: '7.5.5', text: 'Be mindful when creating exercises that require specific knowledge, context, or frame of reference.' },
      { id: '7.5.6', text: 'Examine and adjust assumptions and expectations about prior knowledge, especially regarding knowledge from different subjects or cultural contexts. For example, in a history course, do not assume that everyone has read The Red Badge of Courage or has seen Saving Private Ryan; in an astronomy course, do not assume students have cooked when discussing heating or cooling. Even very common cultural elements such as Harry Potter, Disney, or popular game shows are not universal.' },
    ],
    rows: [
      { id: '7.5.a', exclusive: 'Very few to no examples of applications, examples and scenarios reflect BIPOC culture', emerging: 'Some examples of applications, examples and scenarios reflect BIPOC culture', inclusive: 'Many examples of applications, examples and scenarios reflect BIPOC culture' },
    ],
    resources: [],
  },
  {
    id: '7.6',
    title: 'Appropriate Terminology',
    rubricTitle: 'Appropriate Terminology',
    restorative:
      'References to people, groups, populations, categories, conditions, and disabilities should use appropriate verbiage and not contain derogatory, colloquial, inappropriate, or otherwise incorrect language. For historical uses that must remain in place, consider adding context, such as “a widely-used term at the time.” While “slave” was once commonly used to refer to African Americans who were enslaved and individuals who had schizophrenia were referred to as “schizophrenics”, today we strive to not use terminology that reduces a person to something that was done to them - and language that reflects their status as property - or a medical condition which they are living with. Ensure that quotations or paraphrases using outdated terms are attributed, contextualized, and limited. As language is not static, it is important to keep in mind that what terms are deemed “acceptable” is ever-changing. The need to begin referring to yesterday’s “master” bedroom” as today’s “primary” bedroom” or “foreign” languages as “world” languages may seem understandable and obvious today but was not commonly challenged historically.',
    elements: [
      { id: '7.6.1', text: 'Identify any outmoded or incorrect terminology and replace or reframe the terminology.' },
      { id: '7.6.2', text: 'Insert context, attribution, or quotations for historical references as needed.' },
      { id: '7.6.3', text: 'Identify and use the best terminology at the time. As noted, terminology changes regularly and acceptability is not universal. Consult style guides as necessary; note they may conflict. Do not feel obligated to use the latest term if it is not widely used or is controversial.' },
      { id: '7.6.4', text: 'Define outmoded terminology in historical situations—e.g., court cases, laws, or articles—using quotations or annotated with contextual information. For example, the use of “illegal alien” in a discussion of law can be framed as “as stated in the decision” or something similar.' },
      { id: '7.6.5', text: 'Avoid ableist language. Language that is offensive to people with disabilities is ableist. This includes using words like “psycho,” and “crazy” or phrases like “blind spot” or “falling on deaf ears”. This type of language is problematic because it expresses contempt for having a disability.' },
      { id: '7.6.6', text: 'Avoid or limit idioms or colloquialisms that may lead to misconceptions among those who natively speak other languages or who may not have the educational or cultural context to understand them. While “hitting the books” and “break a leg” may have clear meanings to most speakers of English raised in the United States, those meanings are not universal and a literal interpretation of such phrases could create not only confusion, but fear of bodily harm. Clarify the context and use of common idioms or colloquialisms when they appear so that students may understand them better.' },
    ],
    rows: [
      { id: '7.6.a', exclusive: 'Many examples of terminology that is derogatory/ inappropriate. Include examples in notes', emerging: 'Some examples of terminology that is derogatory/inappropriate. Include examples in notes', inclusive: 'Very few to no examples of terminology that is derogatory/inappropriate. Include examples in notes' },
    ],
    resources: [
      { label: 'Disability Language Style Guide (NCDJ)', url: 'https://ncdj.org/style-guide/' },
      { label: 'Ableism in writing and everyday language (ACES)', url: 'https://aceseditors.org/news/2021/ableism-in-writing-and-everyday-language' },
      { label: 'Diversity/Inclusivity Style Guide (CSU)', url: 'https://www.calstate.edu/csu-system/csu-branding-standards/editorial-style-guide/Pages/diversity-style-guide.aspx' },
      { label: 'The Diversity Style Guide', url: 'https://www.diversitystyleguide.com/' },
      { label: 'GLAAD Media Reference Guide', url: 'https://www.glaad.org/reference' },
      { label: 'NABJ Style Guide', url: 'https://www.nabj.org/page/styleguide' },
      { label: 'Racial Equity Tools Glossary', url: 'https://www.racialequitytools.org/glossary' },
      { label: 'Religion Stylebook', url: 'http://religionstylebook.com/' },
      { label: 'Style guide: reporting on mental health', url: 'https://sprc.org/wp-content/uploads/2023/01/mental-health-reporting-style-guide.pdf' },
    ],
  },
  {
    id: '7.7',
    title: 'Keyword, Glossary, and other types of Metadata Representation',
    rubricTitle: 'Keyword, Glossary and Metadata Representation',
    restorative:
      'Quite often textbooks include metadata sections like chapter outlines/summaries, key takeaways, keywords, glossaries, indexes, etc. What’s included in these sections signal high priority to students, and, as such, one should ensure that diverse topics, scholars, perspectives and terms are appropriately represented in these sections.',
    elements: [
      { id: '7.7.1', text: 'Analyze keyword lists and glossaries and identify core terms that reflect diverse scholars and perspectives that are not represented or highlighted.' },
      { id: '7.7.2', text: 'Assess whether software is negatively impacting the resource’s index. Book indexes are usually not fully representative of book content; they are often built by software, and search capabilities do not always lend themselves to inclusivity.' },
      { id: '7.7.3', text: 'Add keywords, perspectives and key takeaways that specifically highlight issues important to underrepresented groups.' },
    ],
    rows: [
      { id: '7.7.a', exclusive: 'Very few to no examples of keywords or glossary terms reflect diverse topics and/or folks', emerging: 'Some examples of keywords or glossary terms reflect diverse topics and/or folks', inclusive: 'Many examples of keywords or glossary terms reflect diverse topics and/or folks' },
    ],
    resources: [],
  },
  {
    id: '7.8',
    title: 'Incorporating Diverse Perspectives on Issues, Events, and Concepts That Are Relevant to Underrepresented Groups',
    rubricTitle: 'Incorporating Diverse Perspectives',
    restorative:
      'Diverse populations experience issues such as social problems, health, politics, business practices, and economic conditions that may differ from the mainstream. Purposefully incorporating perspectives from populations that are commonly not included allows for how – and why – perspectives may vary to be examined.',
    elements: [
      { id: '7.8.1', text: 'Include diverse perspectives when presenting controversies, arguments, and opinions for each topic or concept covered. A variety of perspectives will expose students to different points of view and widen the context. Do not avoid the inclusion of a perspective due to the discomfort it might create.' },
      { id: '7.8.2', text: 'Do not stigmatize individuals having a specific condition, occupation, experience, or background.' },
      { id: '7.8.3', text: 'Be aware that certain controversial topics, when necessary to include, should be described in an academic manner that recognizes the existing controversy and provides an analysis of the relevant facts or data.' },
      { id: '7.8.4', text: 'If a discipline has accepted a specific position on a topic—e.g., climate change, sexual orientation being partially determined biologically—describe that position. Consider alternative points of view in relation to the discipline adopted position and explain rationale for the position.' },
      { id: '7.8.5', text: 'If a sociopolitical issue without a consensus must be described—e.g., campus carry, voting rights—include a balanced viewpoint by providing differing perspectives on the issue.' },
      { id: '7.8.6', text: 'Avoid characterizations that lead to generalization, such as “rural communities tend to support gun rights.” If a generalization must be stated, provide a reference to support that generalization and additional context for understanding. Also, include any counterpoints from within that generalization.' },
    ],
    rows: [
      { id: '7.8.a', exclusive: 'Use of 0 diverse perspectives relevant to underrepresented groups', emerging: 'Use of 1 diverse perspective relevant to underrepresented groups', inclusive: 'Use of 2 or more diverse perspectives relevant to underrepresented groups' },
    ],
    resources: [
      { label: 'Culturally Responsive & Inclusive Curriculum Resources (PSU)', url: 'https://guides.library.pdx.edu/culturallyresponsivecurriculum' },
      { label: 'Culturally Responsive Higher Education Curriculum Assessment Tool (ASCCC)', url: 'https://www.asccc.org/sites/default/files/Culturally_Responsive_Assessment_Tool.pdf' },
    ],
  },
]

export const IDEA_CATEGORY_IDS: readonly CategoryId[] = IDEA_FRAMEWORK.map((c) => c.id)

const BY_ID: ReadonlyMap<CategoryId, IdeaCategory> = new Map(IDEA_FRAMEWORK.map((c) => [c.id, c]))

export function categoryById(id: CategoryId): IdeaCategory {
  const c = BY_ID.get(id)
  if (!c) throw new Error(`unknown IDEA category ${id}`)
  return c
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit src/engine/idea/framework.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/idea/framework.ts src/engine/idea/framework.test.ts
git commit -m "feat: vendor the IDEA Framework as typed data, quoted in full

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 2: The review and header reducers

**Files:**
- Create: `src/engine/idea/review.ts`
- Test: `src/engine/idea/review.test.ts`

**Interfaces:**
- Consumes: `CategoryId`, `IDEA_CATEGORY_IDS`, `IDEA_FRAMEWORK`, `categoryById` from Task 1.
- Produces:
  ```ts
  export type Rating = 'na' | 'exclusive' | 'emerging' | 'inclusive'
  export type ChecklistAnswer = 'yes' | 'no' | 'unsure' | 'skip'
  export interface Assessor { name: string; title: string; college: string }
  export interface IdeaHeader { assessor: Assessor; benchmark: { bipocPercent: number } }
  export interface CategoryReview { ratings: ReadonlyMap<string, Rating>; notes: string; checklist: ReadonlyMap<string, ChecklistAnswer> }
  export interface IdeaReview { categories: Readonly<Record<CategoryId, CategoryReview>>; summary: string; suggestions: string }
  export const DEFAULT_BIPOC_PERCENT = 77
  export type IdeaReviewEvent =
    | { type: 'rate'; categoryId: CategoryId; rowId: string; rating: Rating }
    | { type: 'clear-rating'; categoryId: CategoryId; rowId: string }
    | { type: 'note'; categoryId: CategoryId; notes: string }
    | { type: 'check'; categoryId: CategoryId; elementId: string; answer: ChecklistAnswer }
    | { type: 'summary'; text: string }
    | { type: 'suggestions'; text: string }
  export type IdeaHeaderEvent =
    | { type: 'benchmark'; bipocPercent: number }
    | { type: 'assessor'; assessor: Partial<Assessor> }
  export function newReview(): IdeaReview
  export function newHeader(): IdeaHeader
  export function reduceReview(review: IdeaReview, event: IdeaReviewEvent): IdeaReview
  export function reduceHeader(header: IdeaHeader, event: IdeaHeaderEvent): IdeaHeader
  export function isCategoryRated(review: IdeaReview, id: CategoryId): boolean
  export function ratedCount(review: IdeaReview): number
  export function ratingCounts(review: IdeaReview): Readonly<Record<Rating | 'notRated', number>>
  ```

- [ ] **Step 1: Write the failing test**

`src/engine/idea/review.test.ts`:
```ts
import {
  DEFAULT_BIPOC_PERCENT, isCategoryRated, newHeader, newReview, ratedCount, ratingCounts, reduceHeader, reduceReview,
  type IdeaReview,
} from './review'
import { IDEA_CATEGORY_IDS } from './framework'

test('a new review has every category, nothing rated, and empty chapter-level fields', () => {
  const r = newReview()
  expect(Object.keys(r.categories)).toEqual(IDEA_CATEGORY_IDS)
  for (const id of IDEA_CATEGORY_IDS) {
    expect(r.categories[id].ratings.size).toBe(0)
    expect(r.categories[id].notes).toBe('')
    expect(r.categories[id].checklist.size).toBe(0)
  }
  expect(r.summary).toBe('')
  expect(r.suggestions).toBe('')
  expect(ratedCount(r)).toBe(0)
})

test('a new header carries the 77% benchmark and an empty assessor', () => {
  const h = newHeader()
  expect(h.benchmark.bipocPercent).toBe(DEFAULT_BIPOC_PERCENT)
  expect(h.assessor).toEqual({ name: '', title: '', college: '' })
})

test('rating a row records it and clearing removes it', () => {
  let r = reduceReview(newReview(), { type: 'rate', categoryId: '7.2', rowId: '7.2.a', rating: 'emerging' })
  expect(r.categories['7.2'].ratings.get('7.2.a')).toBe('emerging')
  expect(isCategoryRated(r, '7.2')).toBe(true)
  r = reduceReview(r, { type: 'clear-rating', categoryId: '7.2', rowId: '7.2.a' })
  expect(r.categories['7.2'].ratings.has('7.2.a')).toBe(false)
  expect(isCategoryRated(r, '7.2')).toBe(false)
})

// 7.1 has three rubric rows. Two of three is not rated — the sidebar count and
// the export both promise a complete row set when they say "rated".
test('a category with several rubric rows is rated only when every row is', () => {
  let r = reduceReview(newReview(), { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'exclusive' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.b', rating: 'inclusive' })
  expect(isCategoryRated(r, '7.1')).toBe(false)
  expect(ratedCount(r)).toBe(0)
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.c', rating: 'na' })
  expect(isCategoryRated(r, '7.1')).toBe(true)
  expect(ratedCount(r)).toBe(1)
})

test('a rating for a row that is not in the category is refused, not stored', () => {
  const r = reduceReview(newReview(), { type: 'rate', categoryId: '7.2', rowId: '7.1.a', rating: 'inclusive' })
  expect(r.categories['7.2'].ratings.size).toBe(0)
  expect(r.categories['7.1'].ratings.size).toBe(0)
})

test('notes and checklist answers are stored per category', () => {
  let r = reduceReview(newReview(), { type: 'note', categoryId: '7.6', notes: 'p. 12 uses "hermaphroditism"' })
  r = reduceReview(r, { type: 'check', categoryId: '7.6', elementId: '7.6.1', answer: 'no' })
  expect(r.categories['7.6'].notes).toBe('p. 12 uses "hermaphroditism"')
  expect(r.categories['7.6'].checklist.get('7.6.1')).toBe('no')
  expect(r.categories['7.5'].notes).toBe('')
})

test('a checklist answer for an element not in the category is refused', () => {
  const r = reduceReview(newReview(), { type: 'check', categoryId: '7.6', elementId: '7.1.1', answer: 'yes' })
  expect(r.categories['7.6'].checklist.size).toBe(0)
})

test('summary and suggestions are chapter-level text', () => {
  let r = reduceReview(newReview(), { type: 'summary', text: 'Strong on 7.5, weak on 7.1.' })
  r = reduceReview(r, { type: 'suggestions', text: 'Replace the two stock photos in 4.2.' })
  expect(r.summary).toBe('Strong on 7.5, weak on 7.1.')
  expect(r.suggestions).toBe('Replace the two stock photos in 4.2.')
})

// Rubric 1's "Category Count" block: how many rows landed in each column.
test('rating counts cover every rubric row, rated or not', () => {
  let r = reduceReview(newReview(), { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'emerging' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'na' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.8', rowId: '7.8.a', rating: 'inclusive' })
  expect(ratingCounts(r)).toEqual({ na: 1, exclusive: 0, emerging: 1, inclusive: 1, notRated: 7 })
})

// Framework §9.0: colleges may adjust the standard to their own demographics.
test('the benchmark is editable, clamped to a percentage, and unmoved by a non-number', () => {
  expect(reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: 62 }).benchmark.bipocPercent).toBe(62)
  expect(reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: 140 }).benchmark.bipocPercent).toBe(100)
  expect(reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: -3 }).benchmark.bipocPercent).toBe(0)
  const at62 = reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: 62 })
  expect(reduceHeader(at62, { type: 'benchmark', bipocPercent: Number.NaN }).benchmark.bipocPercent).toBe(62)
})

test('assessor fields merge', () => {
  let h = reduceHeader(newHeader(), { type: 'assessor', assessor: { name: 'A. Lee' } })
  h = reduceHeader(h, { type: 'assessor', assessor: { college: 'Foothill College' } })
  expect(h.assessor).toEqual({ name: 'A. Lee', title: '', college: 'Foothill College' })
})

test('the reducers never mutate their input', () => {
  const before: IdeaReview = newReview()
  const snap = (v: unknown) => JSON.stringify(v, (_k, x) => (x instanceof Map ? [...x] : x))
  const snapshot = snap(before)
  reduceReview(before, { type: 'rate', categoryId: '7.3', rowId: '7.3.a', rating: 'inclusive' })
  reduceReview(before, { type: 'note', categoryId: '7.3', notes: 'x' })
  reduceReview(before, { type: 'summary', text: 'x' })
  expect(snap(before)).toBe(snapshot)
  const header = newHeader()
  const hsnap = snap(header)
  reduceHeader(header, { type: 'assessor', assessor: { name: 'x' } })
  expect(snap(header)).toBe(hsnap)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/engine/idea/review.test.ts`
Expected: FAIL — `Cannot find module './review'`.

- [ ] **Step 3: Write the reducers**

`src/engine/idea/review.ts`:
```ts
/**
 * The IDEA review: what the HUMAN decided.
 *
 * Two pure reducers, for the same reason `session.ts` is one: every rule in
 * this screen is testable with nothing rendered. The hook in
 * `useIdeaReviews.ts` is plumbing over them.
 *
 * `IdeaReview` is one chapter's Rubric 1: eight categories, plus the rubric's
 * chapter-level Summary and Suggestions. `IdeaHeader` is the rubric's header —
 * assessor and BIPOC benchmark — and there is ONE per session, not one per
 * chapter: OERI's form repeats the header on every chapter's sheet, but the
 * person filling it in does not change between chapters, and asking for a
 * name five times for a five-chapter selection is how a form gets abandoned.
 * The export stamps the header into every chapter's file.
 *
 * THE RATING IS NEVER MACHINE-WRITTEN. The only way a `Rating` enters this
 * structure is a `rate` event, and the only things that dispatch one are a
 * radio the instructor clicked and `store.ts` replaying a rating the
 * instructor clicked earlier. Slice 4's model draft renders BESIDE the rating
 * column and has no path to it — the spec's one deliberate friction.
 *
 * Rows and elements are validated against the Framework: an event naming a
 * row that is not in its category is dropped. Not an error — a stale id from
 * a renumbered Framework should degrade to "nothing recorded", not crash the
 * screen — but never stored, because the export keys on these ids.
 */
import { IDEA_CATEGORY_IDS, IDEA_FRAMEWORK, categoryById, type CategoryId } from './framework'

export type Rating = 'na' | 'exclusive' | 'emerging' | 'inclusive'
export type ChecklistAnswer = 'yes' | 'no' | 'unsure' | 'skip'

export interface Assessor {
  name: string
  title: string
  college: string
}

/** Rubric 1's header. Once per session; stamped into every chapter's export. */
export interface IdeaHeader {
  assessor: Assessor
  /** Framework §9.0: 77% by default (CCCCO Data Mart, Fall 2022), adjustable per college. */
  benchmark: { bipocPercent: number }
}

export interface CategoryReview {
  /** By Rubric 1 row id. A category is rated when every one of its rows is. */
  ratings: ReadonlyMap<string, Rating>
  notes: string
  /** By Framework element id. */
  checklist: ReadonlyMap<string, ChecklistAnswer>
}

/** One chapter's Rubric 1. */
export interface IdeaReview {
  categories: Readonly<Record<CategoryId, CategoryReview>>
  /** Rubric 1's "Summary" field. */
  summary: string
  /** Rubric 1's "Suggestions" field. */
  suggestions: string
}

export const DEFAULT_BIPOC_PERCENT = 77

export type IdeaReviewEvent =
  | { type: 'rate'; categoryId: CategoryId; rowId: string; rating: Rating }
  | { type: 'clear-rating'; categoryId: CategoryId; rowId: string }
  | { type: 'note'; categoryId: CategoryId; notes: string }
  | { type: 'check'; categoryId: CategoryId; elementId: string; answer: ChecklistAnswer }
  | { type: 'summary'; text: string }
  | { type: 'suggestions'; text: string }

export type IdeaHeaderEvent =
  | { type: 'benchmark'; bipocPercent: number }
  | { type: 'assessor'; assessor: Partial<Assessor> }

const emptyCategory = (): CategoryReview => ({ ratings: new Map(), notes: '', checklist: new Map() })

export function newReview(): IdeaReview {
  const categories = {} as Record<CategoryId, CategoryReview>
  for (const id of IDEA_CATEGORY_IDS) categories[id] = emptyCategory()
  return { categories, summary: '', suggestions: '' }
}

export function newHeader(): IdeaHeader {
  return {
    assessor: { name: '', title: '', college: '' },
    benchmark: { bipocPercent: DEFAULT_BIPOC_PERCENT },
  }
}

function withCategory(
  review: IdeaReview,
  id: CategoryId,
  update: (c: CategoryReview) => CategoryReview,
): IdeaReview {
  return { ...review, categories: { ...review.categories, [id]: update(review.categories[id]) } }
}

const hasRow = (id: CategoryId, rowId: string) => categoryById(id).rows.some((r) => r.id === rowId)
const hasElement = (id: CategoryId, elementId: string) =>
  categoryById(id).elements.some((e) => e.id === elementId)

export function reduceReview(review: IdeaReview, event: IdeaReviewEvent): IdeaReview {
  switch (event.type) {
    case 'rate': {
      if (!hasRow(event.categoryId, event.rowId)) return review
      return withCategory(review, event.categoryId, (c) => {
        const ratings = new Map(c.ratings)
        ratings.set(event.rowId, event.rating)
        return { ...c, ratings }
      })
    }
    case 'clear-rating':
      return withCategory(review, event.categoryId, (c) => {
        const ratings = new Map(c.ratings)
        ratings.delete(event.rowId)
        return { ...c, ratings }
      })
    case 'note':
      return withCategory(review, event.categoryId, (c) => ({ ...c, notes: event.notes }))
    case 'check': {
      if (!hasElement(event.categoryId, event.elementId)) return review
      return withCategory(review, event.categoryId, (c) => {
        const checklist = new Map(c.checklist)
        checklist.set(event.elementId, event.answer)
        return { ...c, checklist }
      })
    }
    case 'summary':
      return { ...review, summary: event.text }
    case 'suggestions':
      return { ...review, suggestions: event.text }
  }
}

export function reduceHeader(header: IdeaHeader, event: IdeaHeaderEvent): IdeaHeader {
  switch (event.type) {
    case 'benchmark': {
      const n = event.bipocPercent
      // A non-number leaves the benchmark where it was: the field's text may be
      // mid-edit, and snapping to a default under the instructor's cursor is
      // worse than waiting for a number.
      if (!Number.isFinite(n)) return header
      return { ...header, benchmark: { bipocPercent: Math.min(100, Math.max(0, Math.round(n))) } }
    }
    case 'assessor':
      return { ...header, assessor: { ...header.assessor, ...event.assessor } }
  }
}

export function isCategoryRated(review: IdeaReview, id: CategoryId): boolean {
  const c = review.categories[id]
  return categoryById(id).rows.every((r) => c.ratings.has(r.id))
}

/** Categories whose every rubric row carries a rating. What the sidebar counts. */
export function ratedCount(review: IdeaReview): number {
  return IDEA_CATEGORY_IDS.filter((id) => isCategoryRated(review, id)).length
}

/** Rubric 1's "Category Count" block, over every rubric row. */
export function ratingCounts(review: IdeaReview): Readonly<Record<Rating | 'notRated', number>> {
  const counts = { na: 0, exclusive: 0, emerging: 0, inclusive: 0, notRated: 0 }
  for (const c of IDEA_FRAMEWORK) {
    for (const row of c.rows) {
      const rating = review.categories[c.id].ratings.get(row.id)
      if (rating) counts[rating] += 1
      else counts.notRated += 1
    }
  }
  return counts
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit src/engine/idea/review.test.ts`
Expected: PASS (12 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/idea/review.ts src/engine/idea/review.test.ts
git commit -m "feat: the IDEA review and header reducers, with the rating human-only by construction

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 3: The persisted shape and its validating restore

**Files:**
- Create: `src/engine/idea/store.ts`
- Test: `src/engine/idea/store.test.ts`

**Interfaces:**
- Consumes: everything in Task 2; `IDEA_CATEGORY_IDS` (Task 1).
- Produces:
  ```ts
  export const IDEA_STORAGE_KEY = 'idea.reviews'
  export interface PersistedIdea { version: 1; header: IdeaHeader; reviews: ReadonlyMap<string, IdeaReview> }
  export function toPersisted(header: IdeaHeader, reviews: ReadonlyMap<string, IdeaReview>): PersistedIdea
  export function restore(value: unknown): { header: IdeaHeader; reviews: ReadonlyMap<string, IdeaReview> } | undefined
  ```

- [ ] **Step 1: Write the failing test**

`src/engine/idea/store.test.ts`:
```ts
import { newHeader, newReview, reduceHeader, reduceReview } from './review'
import { IDEA_STORAGE_KEY, restore, toPersisted } from './store'

function sample() {
  let r = newReview()
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'emerging' })
  r = reduceReview(r, { type: 'check', categoryId: '7.6', elementId: '7.6.5', answer: 'yes' })
  r = reduceReview(r, { type: 'note', categoryId: '7.6', notes: 'p. 12' })
  r = reduceReview(r, { type: 'summary', text: 'ok' })
  let h = newHeader()
  h = reduceHeader(h, { type: 'assessor', assessor: { name: 'A. Lee' } })
  h = reduceHeader(h, { type: 'benchmark', bipocPercent: 62 })
  return { review: r, header: h }
}

test('the storage key is namespaced like the rest of the database', () => {
  expect(IDEA_STORAGE_KEY).toBe('idea.reviews')
})

test('a persisted document round-trips through restore', () => {
  const { review, header } = sample()
  const doc = toPersisted(header, new Map([['k', review]]))
  expect(doc.version).toBe(1)
  const back = restore(doc)!
  expect(back.header).toEqual(header)
  expect(back.reviews.get('k')).toEqual(review)
})

test('anything that is not a version-1 document restores to nothing', () => {
  expect(restore(undefined)).toBeUndefined()
  expect(restore(null)).toBeUndefined()
  expect(restore('x')).toBeUndefined()
  expect(restore({ version: 2 })).toBeUndefined()
})

// Restore REPLAYS through the reducers rather than trusting the bytes: a row
// or element id the current Framework does not know is dropped exactly as a
// live event naming it would be, and a value that is not a Rating is dropped
// rather than rendered as a checked radio the instructor never clicked.
test('unknown ids and malformed values are dropped, known ones kept', () => {
  const back = restore({
    version: 1,
    header: { assessor: { name: 'A', title: 7, college: null }, benchmark: { bipocPercent: '62' } },
    reviews: new Map([
      ['k', {
        summary: 'kept',
        suggestions: 42,
        categories: {
          '7.1': { ratings: new Map([['7.1.a', 'emerging'], ['7.1.z', 'inclusive'], ['7.1.b', 'wonderful']]), notes: 'n', checklist: new Map([['7.1.1', 'yes'], ['9.9.9', 'no']]) },
          '7.6': { ratings: 'not a map', notes: null, checklist: new Map() },
          '8.1': { ratings: new Map([['8.1.a', 'inclusive']]), notes: '', checklist: new Map() },
        },
      }],
      [3, { summary: 'dropped: key is not a string' }],
    ]),
  })!
  expect(back.header.assessor).toEqual({ name: 'A', title: '', college: '' })
  expect(back.header.benchmark.bipocPercent).toBe(77)
  expect(back.reviews.size).toBe(1)
  const r = back.reviews.get('k')!
  expect(r.summary).toBe('kept')
  expect(r.suggestions).toBe('')
  expect([...r.categories['7.1'].ratings]).toEqual([['7.1.a', 'emerging']])
  expect([...r.categories['7.1'].checklist]).toEqual([['7.1.1', 'yes']])
  expect(r.categories['7.1'].notes).toBe('n')
  expect(r.categories['7.6'].ratings.size).toBe(0)
  expect(r.categories['7.6'].notes).toBe('')
  expect('8.1' in r.categories).toBe(false)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/engine/idea/store.test.ts`
Expected: FAIL — `Cannot find module './store'`.

- [ ] **Step 3: Write the module**

`src/engine/idea/store.ts`:
```ts
/**
 * What an IDEA review looks like on disk, and the read that trusts none of it.
 *
 * The document is stored as an object graph — Maps included — because the
 * app's `KeyValueStore` is IndexedDB, whose structured clone keeps a Map a
 * Map. That is the reason `idb.ts` gives for not using localStorage, and it
 * holds here: no JSON round-trip, so no class of bug where a value stops
 * surviving one.
 *
 * `restore` does not cast. It rebuilds each review by replaying the stored
 * values through `reduceReview` and `reduceHeader`, so a saved document from
 * a release with a different Framework, or a hand-edited one, degrades to
 * "nothing recorded for that row" instead of a rating nobody clicked. This is
 * also what keeps "the rating is never machine-written" true across a
 * reload: what comes back is only what went in through a `rate` event.
 */
import { IDEA_CATEGORY_IDS } from './framework'
import {
  newHeader, newReview, reduceHeader, reduceReview,
  type ChecklistAnswer, type IdeaHeader, type IdeaReview, type Rating,
} from './review'

export const IDEA_STORAGE_KEY = 'idea.reviews'

export interface PersistedIdea {
  version: 1
  header: IdeaHeader
  reviews: ReadonlyMap<string, IdeaReview>
}

export function toPersisted(header: IdeaHeader, reviews: ReadonlyMap<string, IdeaReview>): PersistedIdea {
  return { version: 1, header, reviews }
}

const RATINGS: readonly string[] = ['na', 'exclusive', 'emerging', 'inclusive']
const ANSWERS: readonly string[] = ['yes', 'no', 'unsure', 'skip']

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const isRating = (v: unknown): v is Rating => typeof v === 'string' && RATINGS.includes(v)
const isAnswer = (v: unknown): v is ChecklistAnswer => typeof v === 'string' && ANSWERS.includes(v)
const entries = (v: unknown): [unknown, unknown][] => (v instanceof Map ? [...v] : [])

export function restore(value: unknown): { header: IdeaHeader; reviews: ReadonlyMap<string, IdeaReview> } | undefined {
  if (!isRecord(value) || value.version !== 1) return undefined

  let header = newHeader()
  if (isRecord(value.header)) {
    const a = isRecord(value.header.assessor) ? value.header.assessor : {}
    header = reduceHeader(header, {
      type: 'assessor',
      assessor: { name: str(a.name), title: str(a.title), college: str(a.college) },
    })
    const b = isRecord(value.header.benchmark) ? value.header.benchmark.bipocPercent : undefined
    if (typeof b === 'number') header = reduceHeader(header, { type: 'benchmark', bipocPercent: b })
  }

  const reviews = new Map<string, IdeaReview>()
  for (const [key, raw] of entries(value.reviews)) {
    if (typeof key !== 'string' || !isRecord(raw)) continue
    let review = newReview()
    review = reduceReview(review, { type: 'summary', text: str(raw.summary) })
    review = reduceReview(review, { type: 'suggestions', text: str(raw.suggestions) })
    const categories = isRecord(raw.categories) ? raw.categories : {}
    for (const categoryId of IDEA_CATEGORY_IDS) {
      const c = categories[categoryId]
      if (!isRecord(c)) continue
      review = reduceReview(review, { type: 'note', categoryId, notes: str(c.notes) })
      for (const [rowId, rating] of entries(c.ratings)) {
        if (typeof rowId === 'string' && isRating(rating)) review = reduceReview(review, { type: 'rate', categoryId, rowId, rating })
      }
      for (const [elementId, answer] of entries(c.checklist)) {
        if (typeof elementId === 'string' && isAnswer(answer)) review = reduceReview(review, { type: 'check', categoryId, elementId, answer })
      }
    }
    reviews.set(key, review)
  }
  return { header, reviews }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit src/engine/idea/store.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/idea/store.ts src/engine/idea/store.test.ts
git commit -m "feat: the persisted IDEA review shape and a restore that replays, not trusts

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 4: Rubric 1 export (Markdown, JSON, filename) and the text download

**Files:**
- Create: `src/engine/idea/rubric-export.ts`
- Create: `src/engine/idea/download.ts`
- Test: `src/engine/idea/rubric-export.test.ts`

**Interfaces:**
- Consumes: `IdeaReview`, `IdeaHeader`, `Rating`, `ChecklistAnswer`, `ratingCounts` (Task 2); `IDEA_FRAMEWORK`, `FRAMEWORK_ATTRIBUTION` (Task 1).
- Produces:
  ```ts
  export interface Rubric1Context { bookTitle: string; chapterTitle: string; publisher?: string; sourceUrl?: string; exportedAt: Date }
  export interface Rubric1Json { /* shape below */ }
  export const RATING_LABEL: Readonly<Record<Rating, string>>   // 'Not Applicable' | 'Exclusive' | 'Emerging Inclusive' | 'Inclusive'
  export function rubric1Markdown(review: IdeaReview, header: IdeaHeader, ctx: Rubric1Context): string
  export function rubric1Json(review: IdeaReview, header: IdeaHeader, ctx: Rubric1Context): Rubric1Json
  export function rubric1Filename(chapterTitle: string, now: Date, ext: 'md' | 'json'): string
  export function downloadTextFile(name: string, text: string, mime: string): void   // download.ts
  ```

- [ ] **Step 1: Write the failing test**

`src/engine/idea/rubric-export.test.ts`:
```ts
import { newHeader, newReview, reduceHeader, reduceReview } from './review'
import { RATING_LABEL, rubric1Filename, rubric1Json, rubric1Markdown, type Rubric1Context } from './rubric-export'

const ctx: Rubric1Context = {
  bookTitle: 'Human Biology',
  chapterTitle: '4: Nutrition',
  publisher: 'LibreTexts',
  sourceUrl: 'https://bio.libretexts.org/x',
  exportedAt: new Date('2026-09-11T17:30:00Z'),
}

function sample() {
  let h = newHeader()
  h = reduceHeader(h, { type: 'assessor', assessor: { name: 'A. Lee', title: 'Instructor', college: 'Foothill College' } })
  h = reduceHeader(h, { type: 'benchmark', bipocPercent: 62 })
  let r = newReview()
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'emerging' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.b', rating: 'exclusive' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.c', rating: 'inclusive' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'na' })
  r = reduceReview(r, { type: 'note', categoryId: '7.6', notes: 'No people are named | in this chapter.' })
  r = reduceReview(r, { type: 'check', categoryId: '7.6', elementId: '7.6.5', answer: 'yes' })
  r = reduceReview(r, { type: 'summary', text: 'Images are the weak point.' })
  r = reduceReview(r, { type: 'suggestions', text: 'Swap the two stock photos in 4.2.' })
  return { review: r, header: h }
}

test('the Markdown carries the header, one row per rubric row, notes, counts, summary, suggestions, and the attribution', () => {
  const { review, header } = sample()
  const md = rubric1Markdown(review, header, ctx)
  expect(md).toContain('# IDEA Framework — Rubric 1')
  expect(md).toContain('**Textbook/Publisher:** Human Biology (LibreTexts)')
  expect(md).toContain('**Chapter:** 4: Nutrition')
  expect(md).toContain('**Assessor:** A. Lee, Instructor, Foothill College')
  expect(md).toContain('**BIPOC benchmark used:** 62%')
  // Rubric 1's own category titles, which differ from the §7 headings.
  expect(md).toContain('| 7.1 Illustrations and Photos of People |')
  expect(md).toContain('| 7.8 Incorporating Diverse Perspectives |')
  // Three rows for 7.1, each with its own rating; one for 7.6.
  expect(md).toContain('| 7.1.a | Emerging Inclusive |')
  expect(md).toContain('| 7.1.b | Exclusive |')
  expect(md).toContain('| 7.1.c | Inclusive |')
  expect(md).toContain('| 7.6.a | Not Applicable |')
  // Unrated rows are stated as such, never blank.
  expect(md).toContain('| 7.2.a | Not rated |')
  // A pipe in notes must not break the table.
  expect(md).toContain('No people are named \\| in this chapter.')
  expect(md).toContain('7.6.5: yes')
  // Rubric 1's footer blocks.
  expect(md).toContain('## Category count')
  expect(md).toContain('- Exclusive: 1')
  expect(md).toContain('- Emerging Inclusive: 1')
  expect(md).toContain('- Inclusive: 1')
  expect(md).toContain('- Not Applicable: 1')
  expect(md).toContain('- Not rated: 6')
  expect(md).toContain('## Summary\n\nImages are the weak point.')
  expect(md).toContain('## Suggestions\n\nSwap the two stock photos in 4.2.')
  expect(md).toContain('CC BY 4.0')
  expect(md).toContain('asccc-oeri.org')
})

test('the JSON mirrors the table and is stable in shape', () => {
  const { review, header } = sample()
  const j = rubric1Json(review, header, ctx)
  expect(j.format).toBe('oer2canvas-idea-rubric1')
  expect(j.version).toBe(1)
  expect(j.framework.license).toBe('CC BY 4.0')
  expect(j.textbook).toEqual({ title: 'Human Biology', publisher: 'LibreTexts', url: 'https://bio.libretexts.org/x' })
  expect(j.chapter).toBe('4: Nutrition')
  expect(j.assessor).toEqual({ name: 'A. Lee', title: 'Instructor', college: 'Foothill College' })
  expect(j.benchmark.bipocPercent).toBe(62)
  expect(j.exportedAt).toBe('2026-09-11T17:30:00.000Z')
  expect(j.areas).toHaveLength(8)
  const first = j.areas[0]
  expect(first.id).toBe('7.1')
  expect(first.title).toBe('Illustrations and Photos of People')
  expect(first.rows.map((r) => r.rating)).toEqual(['emerging', 'exclusive', 'inclusive'])
  expect(first.rows[0].label).toBe(RATING_LABEL.emerging)
  const terms = j.areas.find((a) => a.id === '7.6')!
  expect(terms.notes).toBe('No people are named | in this chapter.')
  expect(terms.checklist).toEqual([{ id: '7.6.5', answer: 'yes' }])
  expect(j.areas.find((a) => a.id === '7.2')!.rows[0].rating).toBeNull()
  expect(j.counts).toEqual({ na: 1, exclusive: 1, emerging: 1, inclusive: 1, notRated: 6 })
  expect(j.summary).toBe('Images are the weak point.')
  expect(j.suggestions).toBe('Swap the two stock photos in 4.2.')
})

test('the filename is safe, dated, and carries the chapter', () => {
  const now = new Date('2026-09-11T17:30:00Z')
  expect(rubric1Filename('4: Nutrition / Vitamins', now, 'md')).toBe('idea-rubric1-4-nutrition-vitamins-2026-09-11.md')
  expect(rubric1Filename('', now, 'json')).toBe('idea-rubric1-chapter-2026-09-11.json')
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/engine/idea/rubric-export.test.ts`
Expected: FAIL — `Cannot find module './rubric-export'`.

- [ ] **Step 3: Write the export module**

`src/engine/idea/rubric-export.ts`:
```ts
/**
 * Rubric 1 as a file the instructor can keep or submit.
 *
 * Markdown for reading, JSON for machines; both carry the same content in the
 * same order Appendix A does — header, one row per rubric row with notes
 * under each category, the Category Count block, Summary, Suggestions — so a
 * future OERI submission form has something it can consume. Area titles are
 * Rubric 1's own, not the §7 headings, for the same reason.
 *
 * Edition is not exported: the app does not know it. The header line reads
 * "Textbook/Publisher" and the instructor adds an edition by hand if OERI
 * wants one.
 *
 * DOWNLOAD ONLY. Nothing here is ever packaged into the cartridge: the rubric
 * is about the material, not for the students who will read it.
 */
import { FRAMEWORK_ATTRIBUTION, IDEA_FRAMEWORK } from './framework'
import { ratingCounts, type ChecklistAnswer, type IdeaHeader, type IdeaReview, type Rating } from './review'

export interface Rubric1Context {
  bookTitle: string
  chapterTitle: string
  publisher?: string
  sourceUrl?: string
  exportedAt: Date
}

export const RATING_LABEL: Readonly<Record<Rating, string>> = {
  na: 'Not Applicable',
  exclusive: 'Exclusive',
  emerging: 'Emerging Inclusive',
  inclusive: 'Inclusive',
}

const NOT_RATED = 'Not rated'

export interface Rubric1Json {
  format: 'oer2canvas-idea-rubric1'
  version: 1
  framework: { title: string; url: string; license: string }
  textbook: { title: string; publisher?: string; url?: string }
  chapter: string
  assessor: { name: string; title: string; college: string }
  benchmark: { bipocPercent: number }
  exportedAt: string
  areas: {
    id: string
    title: string
    rows: { id: string; rating: Rating | null; label: string }[]
    notes: string
    checklist: { id: string; answer: ChecklistAnswer }[]
  }[]
  counts: Readonly<Record<Rating | 'notRated', number>>
  summary: string
  suggestions: string
}

export function rubric1Json(review: IdeaReview, header: IdeaHeader, ctx: Rubric1Context): Rubric1Json {
  return {
    format: 'oer2canvas-idea-rubric1',
    version: 1,
    framework: {
      title: FRAMEWORK_ATTRIBUTION.title,
      url: FRAMEWORK_ATTRIBUTION.url,
      license: FRAMEWORK_ATTRIBUTION.license.name,
    },
    textbook: {
      title: ctx.bookTitle,
      ...(ctx.publisher ? { publisher: ctx.publisher } : {}),
      ...(ctx.sourceUrl ? { url: ctx.sourceUrl } : {}),
    },
    chapter: ctx.chapterTitle,
    assessor: { ...header.assessor },
    benchmark: { ...header.benchmark },
    exportedAt: ctx.exportedAt.toISOString(),
    areas: IDEA_FRAMEWORK.map((c) => {
      const r = review.categories[c.id]
      return {
        id: c.id,
        title: c.rubricTitle,
        rows: c.rows.map((row) => {
          const rating = r.ratings.get(row.id) ?? null
          return { id: row.id, rating, label: rating ? RATING_LABEL[rating] : NOT_RATED }
        }),
        notes: r.notes,
        checklist: c.elements
          .filter((e) => r.checklist.has(e.id))
          .map((e) => ({ id: e.id, answer: r.checklist.get(e.id)! })),
      }
    }),
    counts: ratingCounts(review),
    summary: review.summary,
    suggestions: review.suggestions,
  }
}

/** A cell must not carry a bare pipe or a newline, or the table falls apart. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

export function rubric1Markdown(review: IdeaReview, header: IdeaHeader, ctx: Rubric1Context): string {
  const j = rubric1Json(review, header, ctx)
  const lines: string[] = []
  lines.push('# IDEA Framework — Rubric 1')
  lines.push('')
  lines.push(`**Textbook/Publisher:** ${cell(ctx.bookTitle)}${ctx.publisher ? ` (${cell(ctx.publisher)})` : ''}`)
  if (ctx.sourceUrl) lines.push(`**Source:** ${ctx.sourceUrl}`)
  lines.push(`**Chapter:** ${cell(ctx.chapterTitle)}`)
  const a = header.assessor
  const who = [a.name, a.title, a.college].map((s) => s.trim()).filter(Boolean).join(', ')
  lines.push(`**Assessor:** ${who || '—'}`)
  lines.push(`**BIPOC benchmark used:** ${header.benchmark.bipocPercent}%`)
  lines.push(`**Exported:** ${j.exportedAt}`)
  lines.push('')
  lines.push('| Area | Row | Rating | Notes |')
  lines.push('| --- | --- | --- | --- |')
  for (const area of j.areas) {
    area.rows.forEach((row, i) => {
      const areaCell = i === 0 ? `${area.id} ${cell(area.title)}` : ''
      const notes = i === 0 ? cell(area.notes) : ''
      lines.push(`| ${areaCell} | ${row.id} | ${row.label} | ${notes} |`)
    })
  }
  lines.push('')
  lines.push('## Category count')
  lines.push('')
  lines.push(`- ${RATING_LABEL.exclusive}: ${j.counts.exclusive}`)
  lines.push(`- ${RATING_LABEL.emerging}: ${j.counts.emerging}`)
  lines.push(`- ${RATING_LABEL.inclusive}: ${j.counts.inclusive}`)
  lines.push(`- ${RATING_LABEL.na}: ${j.counts.na}`)
  lines.push(`- ${NOT_RATED}: ${j.counts.notRated}`)
  lines.push('')
  lines.push('## Summary')
  lines.push('')
  lines.push(j.summary.trim() || '—')
  lines.push('')
  lines.push('## Suggestions')
  lines.push('')
  lines.push(j.suggestions.trim() || '—')
  lines.push('')
  lines.push('## Elements for consideration')
  lines.push('')
  for (const area of j.areas) {
    if (area.checklist.length === 0) continue
    lines.push(`- ${area.id} ${cell(area.title)}: ${area.checklist.map((c) => `${c.id}: ${c.answer}`).join('; ')}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('')
  lines.push(
    `Rubric and category text from "${FRAMEWORK_ATTRIBUTION.title}" by ${FRAMEWORK_ATTRIBUTION.author}, ` +
      `${FRAMEWORK_ATTRIBUTION.url}, licensed ${FRAMEWORK_ATTRIBUTION.license.name} (${FRAMEWORK_ATTRIBUTION.license.url}). ` +
      'Ratings, notes, checklist answers, summary, and suggestions were entered by the assessor named above; none were produced by software.',
  )
  lines.push('')
  return lines.join('\n')
}

export function rubric1Filename(chapterTitle: string, now: Date, ext: 'md' | 'json'): string {
  const slug = chapterTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  const date = now.toISOString().slice(0, 10)
  return `idea-rubric1-${slug || 'chapter'}-${date}.${ext}`
}
```

`src/engine/idea/download.ts`:
```ts
/**
 * Hand a text file to the browser as a download.
 *
 * The same anchor-and-revoke pattern as `engine/export/download.ts`, kept
 * separate because that module is typed to cartridges and this one is not.
 * Revoked on a timeout rather than immediately, because revoking before the
 * browser has started the download cancels it in some engines.
 */
export function downloadTextFile(name: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit src/engine/idea/rubric-export.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/idea/rubric-export.ts src/engine/idea/download.ts src/engine/idea/rubric-export.test.ts
git commit -m "feat: export Rubric 1 as Markdown and JSON, in Rubric 1's own shape

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 5: The sixth phase in the shell

**Files:**
- Modify: `src/shell/phases.ts`
- Modify: `src/shell/AppShell.tsx` (icon map ~line 24; `PhaseButton` ~line 353)
- Test: `src/shell/phases.test.ts` (append), `src/shell/AppShell.test.tsx` (append)

**Interfaces:**
- Produces:
  ```ts
  export type PhaseId = 'destination' | 'chapters' | 'review' | 'idea' | 'plan' | 'result'
  export interface ShellState { …existing; ideaRated: number; ideaTotal: number }
  export type PhaseAvailability = { state: 'done' } | { state: 'available'; detail?: string } | { state: 'unavailable'; reason: string }
  export function ideaSummary(rated: number, total: number): string   // 'optional' | '3 of 8 rated'
  ```

- [ ] **Step 1: Write the failing tests**

Append to `src/shell/phases.test.ts`:
```ts
import { PHASE_ORDER, ideaSummary } from './phases'

test('IDEA sits between Review and Plan', () => {
  expect(PHASE_ORDER).toEqual(['destination', 'chapters', 'review', 'idea', 'plan', 'result'])
})

test('IDEA is shut until the selection is prepared, then open, and never done', () => {
  expect(phaseAvailability(state()).idea).toEqual({ state: 'unavailable', reason: 'select chapters first' })
  expect(phaseAvailability(state({ destination: CANVAS, selectedCount: 3, preparedCount: 1 })).idea)
    .toEqual({ state: 'unavailable', reason: 'checks are still running' })
  expect(phaseAvailability(state({ destination: CANVAS, selectedCount: 3, preparedCount: 3 })).idea)
    .toEqual({ state: 'available', detail: 'optional' })
  expect(phaseAvailability(state({ destination: CANVAS, selectedCount: 1, preparedCount: 1, ideaRated: 3, ideaTotal: 8 })).idea)
    .toEqual({ state: 'available', detail: '3 of 8 rated' })
  expect(phaseAvailability(state({ destination: CANVAS, selectedCount: 1, preparedCount: 1, ideaRated: 8, ideaTotal: 8, committed: true })).idea)
    .toEqual({ state: 'available', detail: '8 of 8 rated' })
})

// The spec's whole stance: IDEA is reflective, the accessibility queue is the
// legal gate. Plan reads nothing IDEA-shaped.
test('Plan ignores the IDEA review entirely', () => {
  const base = { destination: CANVAS, selectedCount: 2, preparedCount: 2 }
  expect(phaseAvailability(state({ ...base, ideaRated: 0, ideaTotal: 16 })).plan).toEqual({ state: 'available' })
  expect(phaseAvailability(state({ ...base, ideaRated: 16, ideaTotal: 16 })).plan).toEqual({ state: 'available' })
})

test('the IDEA summary reads optional until something is rated', () => {
  expect(ideaSummary(0, 8)).toBe('optional')
  expect(ideaSummary(0, 0)).toBe('optional')
  expect(ideaSummary(1, 8)).toBe('1 of 8 rated')
})
```

Append to `src/shell/AppShell.test.tsx`:
```ts
test('an available phase with a detail says it beside its name', () => {
  render(
    <AppShell
      active="review"
      onNavigate={vi.fn()}
      shell={{ ...EMPTY_SHELL, destination: { kind: 'cartridge' }, selectedCount: 1, preparedCount: 1, ideaRated: 2, ideaTotal: 8 }}
    >
      <p>content</p>
    </AppShell>,
  )
  expect(screen.getByRole('button', { name: /IDEA.*2 of 8 rated/ })).not.toHaveAttribute('aria-disabled', 'true')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project unit src/shell/phases.test.ts src/shell/AppShell.test.tsx`
Expected: FAIL — `ideaSummary` not exported; `PHASE_ORDER` has five entries; the `ideaRated` property does not exist on `ShellState`.

- [ ] **Step 3: Change `phases.ts`**

In `src/shell/phases.ts`:

Replace the `PhaseId`/`PHASE_ORDER`/`PHASE_LABEL` block with:
```ts
/**
 * Every phase is named for what the USER does, not what the machine does.
 *
 * Compiling and auditing is the app's work; the user's work is confirming the
 * handful of things only a human can decide — is this image decorative, does
 * this table have headers. When there is nothing to confirm, this phase asks
 * for nothing and says so.
 *
 * IDEA is the one OPTIONAL phase. It is a reflective review against the ASCCC
 * OERI IDEA Framework, and it never gates Plan: the accessibility queue is a
 * legal requirement, this is not, and a mandatory equity gate is how a tool
 * gets abandoned. It is always in the sidebar, and it never reads "done" on
 * its own — an instructor decides when their review is finished.
 */
export type PhaseId = 'destination' | 'chapters' | 'review' | 'idea' | 'plan' | 'result'

export const PHASE_ORDER: readonly PhaseId[] = [
  'destination', 'chapters', 'review', 'idea', 'plan', 'result',
] as const

export const PHASE_LABEL: Readonly<Record<PhaseId, string>> = {
  destination: 'Destination',
  chapters: 'Content',
  review: 'Review',
  idea: 'IDEA',
  plan: 'Plan',
  result: 'Result',
}
```

Add to `ShellState` (after `unansweredCount`):
```ts
  /** IDEA categories with a complete rating, across the selection. Never gates anything. */
  ideaRated: number
  /** IDEA categories in the selection: 8 per prepared chapter. */
  ideaTotal: number
```

Change `PhaseAvailability`:
```ts
export type PhaseAvailability =
  | { state: 'done' }
  /** `detail` is read after the name — "IDEA, optional" — and shown beside it. */
  | { state: 'available'; detail?: string }
  /** `reason` completes the sentence "Plan — <reason>", and is read aloud. */
  | { state: 'unavailable'; reason: string }
```

Add to `EMPTY_SHELL`: `ideaRated: 0, ideaTotal: 0,`.

Add, before `phaseAvailability`:
```ts
/** What the IDEA phase says beside its name. Never empty — absence is information. */
export function ideaSummary(rated: number, total: number): string {
  if (rated === 0) return 'optional'
  return `${rated} of ${total} rated`
}
```

Inside `phaseAvailability`'s returned object, insert between `review` and `plan`:
```ts
    // Never `done`: a rated review is a review the instructor considers
    // finished, and only they know that. `available` with a detail instead.
    idea: !hasSelection
      ? { state: 'unavailable', reason: 'select chapters first' }
      : !prepared
        ? { state: 'unavailable', reason: 'checks are still running' }
        : { state: 'available', detail: ideaSummary(s.ideaRated, s.ideaTotal) },
```

- [ ] **Step 4: Change `AppShell.tsx`**

Add `Scale` to the lucide import list (`import { BookOpen, Check, CheckCircle2, ClipboardList, Compass, ListChecks, Monitor, Moon, PanelLeft, Scale, Settings, Sun, type LucideIcon } from 'lucide-react'`) and add to `PHASE_ICON`:
```ts
  idea: Scale,
```

In `PhaseButton`, after the `{availability.state === 'done' && (…)}` block, add:
```tsx
      {availability.state === 'available' && availability.detail && (
        <span className="ml-auto hidden truncate text-xs text-neutral-600 md:inline dark:text-neutral-400">
          <span className="sr-only">, </span>
          {availability.detail}
        </span>
      )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/shell/`
Expected: PASS. If `screens.test.tsx` or `PlanScreen.test.tsx` construct a `ShellState` literal, add `ideaRated: 0, ideaTotal: 0` to them; `App.test.tsx` uses `App`, which Task 9 updates.

- [ ] **Step 6: Typecheck; fix every `ShellState` literal the compiler names**

Run: `npm run typecheck`
Expected: errors only in `src/App.tsx` (`ideaRated` missing) — Task 9 fixes that. If the error list is longer, add the two fields where named. Do NOT stub them in `App.tsx` yet; leave that to Task 9 so the count is derived there, never hard-coded.

- [ ] **Step 7: Commit**

```bash
git add src/shell/phases.ts src/shell/phases.test.ts src/shell/AppShell.tsx src/shell/AppShell.test.tsx
git commit -m "feat: an optional IDEA phase in the sidebar that never gates Plan

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

(The typecheck is red between this commit and Task 9's. That is acceptable for the intervening commits on a feature branch; do not push between them.)

---

### Task 6: Copy and the category panel

**Files:**
- Create: `src/components/idea/copy.ts`
- Create: `src/components/idea/CategoryPanel.tsx`
- Test: `src/components/idea/CategoryPanel.test.tsx`

**Interfaces:**
- Consumes: `IdeaCategory`, `RUBRIC_NA_TEXT` (Task 1); `CategoryReview`, `IdeaReviewEvent`, `Rating`, `ChecklistAnswer` (Task 2).
- Produces:
  ```ts
  export const IDEA_COPY   // copy.ts, shape below
  export function CategoryPanel(props: {
    category: IdeaCategory
    review: CategoryReview
    open: boolean
    onToggle: () => void
    onEvent: (event: IdeaReviewEvent) => void
  }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test**

`src/components/idea/CategoryPanel.test.tsx`:
```tsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import { CategoryPanel } from './CategoryPanel'
import { categoryById } from '../../engine/idea/framework'
import { newReview, reduceReview, type IdeaReviewEvent } from '../../engine/idea/review'

function renderPanel(id: '7.1' | '7.2' | '7.6' = '7.6', open = true) {
  const onEvent = vi.fn<(e: IdeaReviewEvent) => void>()
  const review = newReview().categories[id]
  const utils = render(
    <CategoryPanel category={categoryById(id)} review={review} open={open} onToggle={vi.fn()} onEvent={onEvent} />,
  )
  return { ...utils, onEvent }
}

test('the header is a button that reports expanded state and the category title', () => {
  renderPanel('7.6', false)
  const header = screen.getByRole('button', { name: /7\.6 Appropriate Terminology/ })
  expect(header).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('group', { name: /Rubric 1/ })).not.toBeInTheDocument()
})

test('open, it shows the restorative requirement, the checklist, the rubric rows, and notes', () => {
  renderPanel('7.6')
  expect(screen.getByText(/References to people, groups, populations/)).toBeInTheDocument()
  const checklist = screen.getByRole('group', { name: 'Elements for consideration' })
  expect(within(checklist).getAllByRole('radiogroup')).toHaveLength(categoryById('7.6').elements.length)
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  expect(within(rubric).getAllByRole('radiogroup')).toHaveLength(1)
  expect(screen.getByRole('textbox', { name: 'Notes' })).toBeInTheDocument()
})

test('7.1 renders three rubric rows, each its own radio group', () => {
  renderPanel('7.1')
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  expect(within(rubric).getAllByRole('radiogroup')).toHaveLength(3)
})

test('clicking a rating dispatches a rate event for that row and nothing else', () => {
  const { onEvent } = renderPanel('7.6')
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  fireEvent.click(within(rubric).getByRole('radio', { name: /^Emerging Inclusive/ }))
  expect(onEvent).toHaveBeenCalledTimes(1)
  expect(onEvent).toHaveBeenCalledWith({ type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'emerging' })
})

test('each rating radio carries the Rubric 1 wording for its column', () => {
  renderPanel('7.2')
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  expect(within(rubric).getByRole('radio', { name: /Less than 30% of names reflect BIPOC culture/ })).toBeInTheDocument()
  expect(within(rubric).getByRole('radio', { name: /Not Applicable/ })).toBeInTheDocument()
})

test('a checklist answer dispatches a check event', () => {
  const { onEvent } = renderPanel('7.6')
  const checklist = screen.getByRole('group', { name: 'Elements for consideration' })
  const first = within(checklist).getAllByRole('radiogroup')[0]
  fireEvent.click(within(first).getByRole('radio', { name: 'Unsure' }))
  expect(onEvent).toHaveBeenCalledWith({ type: 'check', categoryId: '7.6', elementId: '7.6.1', answer: 'unsure' })
})

test('typing notes dispatches a note event with the full text', () => {
  const { onEvent } = renderPanel('7.6')
  fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'p. 12' } })
  expect(onEvent).toHaveBeenCalledWith({ type: 'note', categoryId: '7.6', notes: 'p. 12' })
})

test('the current review is reflected as checked state', () => {
  let review = newReview()
  review = reduceReview(review, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'inclusive' })
  review = reduceReview(review, { type: 'check', categoryId: '7.6', elementId: '7.6.2', answer: 'no' })
  render(
    <CategoryPanel category={categoryById('7.6')} review={review.categories['7.6']} open onToggle={vi.fn()} onEvent={vi.fn()} />,
  )
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  expect(within(rubric).getByRole('radio', { name: /^Inclusive/ })).toBeChecked()
  const groups = within(screen.getByRole('group', { name: 'Elements for consideration' })).getAllByRole('radiogroup')
  expect(within(groups[1]).getByRole('radio', { name: 'No' })).toBeChecked()
})

test('the header summary reads "rated" for a one-row category and counts rows otherwise', () => {
  let review = newReview()
  review = reduceReview(review, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'inclusive' })
  review = reduceReview(review, { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'inclusive' })
  const { unmount } = render(
    <CategoryPanel category={categoryById('7.6')} review={review.categories['7.6']} open={false} onToggle={vi.fn()} onEvent={vi.fn()} />,
  )
  expect(screen.getByRole('button', { name: /7\.6 .*rated$/ })).toBeInTheDocument()
  expect(screen.queryByText(/1 of 1/)).not.toBeInTheDocument()
  unmount()
  render(
    <CategoryPanel category={categoryById('7.1')} review={review.categories['7.1']} open={false} onToggle={vi.fn()} onEvent={vi.fn()} />,
  )
  expect(screen.getByRole('button', { name: /1 of 3 rows rated/ })).toBeInTheDocument()
})

test('the one string that argues sits above the rubric', () => {
  renderPanel('7.6')
  expect(screen.getByText('Rate what you observed, not what the tool counted. The counts and drafts are evidence; the judgment is yours.')).toBeInTheDocument()
})

test('resources are links that open in a new tab and say so', () => {
  renderPanel('7.6')
  const link = screen.getByRole('link', { name: /Disability Language Style Guide \(NCDJ\)/ })
  expect(link).toHaveAttribute('href', 'https://ncdj.org/style-guide/')
  expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/components/idea/CategoryPanel.test.tsx`
Expected: FAIL — `Cannot find module './CategoryPanel'`.

- [ ] **Step 3: Write the copy module**

`src/components/idea/copy.ts`:
```ts
/**
 * Every user-facing string on the IDEA screen. STRINGS ONLY, in one place, so
 * the panel, the screen, and the live region never drift apart, and so the
 * one string that argues is quoted from the spec rather than paraphrased.
 */
import type { ChecklistAnswer, Rating } from '../../engine/idea/review'

export const IDEA_COPY = {
  heading: 'IDEA review',
  intro:
    'Apply the ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism Framework to this chapter. ' +
    'This review is optional and never blocks publishing.',
  storage:
    'Reviews, the assessor, and the benchmark are saved in this browser on this device until you forget them. ' +
    'Nothing about a review is sent anywhere.',
  restorativeHeading: 'Restorative requirements',
  checklistHeading: 'Elements for consideration',
  rubricHeading: 'Rubric 1',
  /** The one string in this feature that argues. Spec §5.3, verbatim. */
  rubricArgument:
    'Rate what you observed, not what the tool counted. The counts and drafts are evidence; the judgment is yours.',
  notesLabel: 'Notes',
  notesHint: 'Page references, examples, and anything the rating needs explaining.',
  resourcesHeading: 'Additional resources',
  opensNewTab: 'opens in a new tab',
  ratedSummary: (rated: number, total: number) => {
    if (total === 1) return rated === 1 ? 'rated' : 'not rated'
    return rated === 0 ? 'not rated' : `${rated} of ${total} rows rated`
  },
  assessor: {
    legend: 'Assessor',
    hint: 'Entered once; stamped into every chapter’s Rubric 1.',
    name: 'Name',
    title: 'Title',
    college: 'College',
  },
  benchmark: {
    label: 'BIPOC benchmark',
    hint:
      '77% of California Community College students are BIPOC (CCCCO Data Mart, Fall 2022). ' +
      'The Framework says colleges may adjust this to their own demographics.',
  },
  chapterLevel: {
    legend: 'Chapter summary',
    summary: 'Summary',
    suggestions: 'Suggestions',
  },
  export: {
    legend: 'Export Rubric 1',
    markdown: 'Download Markdown',
    json: 'Download JSON',
    done: (name: string) => `Downloaded ${name}.`,
  },
  forget: {
    button: 'Forget all IDEA reviews',
    confirm:
      'This removes every chapter’s review, the assessor, and the benchmark from this browser. ' +
      'Files you have already downloaded are unaffected.',
    yes: 'Forget',
    no: 'Keep',
    done: 'IDEA reviews forgotten.',
  },
  chapterSwitcher: 'Chapter under review',
  renderLabel: 'Chapter as it will be published',
  attribution: (title: string, author: string, license: string) =>
    `Framework text from "${title}" by ${author}, licensed ${license}.`,
  empty: 'Nothing to review yet. Prepare chapters first.',
} as const

export const RATING_COPY: Readonly<Record<Rating, string>> = {
  na: 'Not Applicable',
  exclusive: 'Exclusive',
  emerging: 'Emerging Inclusive',
  inclusive: 'Inclusive',
}

export const RATING_ORDER: readonly Rating[] = ['na', 'exclusive', 'emerging', 'inclusive']

export const CHECKLIST_COPY: Readonly<Record<ChecklistAnswer, string>> = {
  yes: 'Yes',
  no: 'No',
  unsure: 'Unsure',
  skip: 'Skip',
}

export const CHECKLIST_ORDER: readonly ChecklistAnswer[] = ['yes', 'no', 'unsure', 'skip']
```

- [ ] **Step 4: Write the panel**

`src/components/idea/CategoryPanel.tsx`:
```tsx
/**
 * One Framework category: restorative requirement, checklist, Rubric 1 rows,
 * notes, resources. STRINGS ONLY — no publisher html reaches this component.
 *
 * The rubric radios carry Rubric 1's own wording as their accessible name,
 * because "Emerging Inclusive" alone tells an assessor nothing about what the
 * row is asking; the column text is the question.
 *
 * Slice 2 adds a "What a rule found" zone between the requirement and the
 * checklist; slice 4 adds "Ask the model" after it. Both are zones inside this
 * panel, which is why the panel and not the screen owns the category.
 */
import { useId } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import type { IdeaCategory, RubricRow } from '../../engine/idea/framework'
import { RUBRIC_NA_TEXT } from '../../engine/idea/framework'
import type { CategoryReview, IdeaReviewEvent, Rating } from '../../engine/idea/review'
import {
  CHECKLIST_COPY, CHECKLIST_ORDER, IDEA_COPY, RATING_COPY, RATING_ORDER,
} from './copy'

const TARGET = 'min-h-9 min-w-9'
const PANEL =
  'rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900'
const CHOICE =
  'flex cursor-pointer items-start gap-2 rounded-md border border-neutral-300 px-3 py-2 text-sm ' +
  'has-[:checked]:border-brand-700 has-[:checked]:bg-brand-50 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 ' +
  'dark:border-neutral-700 dark:has-[:checked]:bg-neutral-800'

export function CategoryPanel({
  category, review, open, onToggle, onEvent,
}: {
  category: IdeaCategory
  review: CategoryReview
  open: boolean
  onToggle: () => void
  onEvent: (event: IdeaReviewEvent) => void
}) {
  const bodyId = useId()
  const rated = category.rows.filter((r) => review.ratings.has(r.id)).length
  return (
    <section className={PANEL} aria-labelledby={`${bodyId}-h`}>
      <h3 id={`${bodyId}-h`} className="m-0">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={onToggle}
          className={`${TARGET} flex w-full items-center gap-2 px-4 py-3 text-left text-base font-semibold`}
        >
          {open
            ? <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
            : <ChevronRight className="size-4 shrink-0" aria-hidden="true" />}
          <span className="min-w-0 flex-1">{category.id} {category.title}</span>
          <span className="text-xs font-normal text-neutral-600 dark:text-neutral-400">
            {IDEA_COPY.ratedSummary(rated, category.rows.length)}
          </span>
        </button>
      </h3>

      {open && (
        <div id={bodyId} className="flex flex-col gap-5 border-t border-neutral-200 px-4 py-4 dark:border-neutral-800">
          <div>
            <h4 className="mb-1 text-sm font-semibold">{IDEA_COPY.restorativeHeading}</h4>
            <p className="text-sm text-neutral-800 dark:text-neutral-200">{category.restorative}</p>
          </div>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-2 text-sm font-semibold">{IDEA_COPY.checklistHeading}</legend>
            <ol className="m-0 flex list-none flex-col gap-3 p-0">
              {category.elements.map((el) => (
                <li key={el.id}>
                  <div role="radiogroup" aria-labelledby={`${bodyId}-${el.id}`} className="flex flex-col gap-2">
                    <p id={`${bodyId}-${el.id}`} className="m-0 text-sm">{el.text}</p>
                    <div className="flex flex-wrap gap-2">
                      {CHECKLIST_ORDER.map((answer) => (
                        <label key={answer} className={`${CHOICE} ${TARGET}`}>
                          <input
                            type="radio"
                            name={`${bodyId}-${el.id}`}
                            checked={review.checklist.get(el.id) === answer}
                            onChange={() => onEvent({ type: 'check', categoryId: category.id, elementId: el.id, answer })}
                            className="mt-0.5"
                          />
                          <span>{CHECKLIST_COPY[answer]}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </fieldset>

          <fieldset className="m-0 border-0 p-0">
            <legend className="mb-1 text-sm font-semibold">{IDEA_COPY.rubricHeading}</legend>
            <p className="mb-3 text-sm text-neutral-700 dark:text-neutral-300">{IDEA_COPY.rubricArgument}</p>
            <div className="flex flex-col gap-4">
              {category.rows.map((row) => (
                <RubricRowChoice
                  key={row.id}
                  row={row}
                  rowsInCategory={category.rows.length}
                  value={review.ratings.get(row.id)}
                  onChoose={(rating) => onEvent({ type: 'rate', categoryId: category.id, rowId: row.id, rating })}
                />
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1">
            <label htmlFor={`${bodyId}-notes`} className="text-sm font-semibold">{IDEA_COPY.notesLabel}</label>
            <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.notesHint}</p>
            <textarea
              id={`${bodyId}-notes`}
              value={review.notes}
              onChange={(e) => onEvent({ type: 'note', categoryId: category.id, notes: e.target.value })}
              rows={3}
              className="rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
            />
          </div>

          {category.resources.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-semibold">{IDEA_COPY.resourcesHeading}</h4>
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {category.resources.map((r) => (
                  <li key={r.url}>
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-brand-700 underline dark:text-brand-300"
                    >
                      {r.label}
                      <ExternalLink className="size-3" aria-hidden="true" />
                      <span className="sr-only">({IDEA_COPY.opensNewTab})</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * One Rubric 1 row as a radio group. The accessible name of each radio is the
 * rating label followed by the row's column text, so a screen-reader user
 * hears the question with the answer.
 */
function RubricRowChoice({
  row, rowsInCategory, value, onChoose,
}: {
  row: RubricRow
  rowsInCategory: number
  value: Rating | undefined
  onChoose: (rating: Rating) => void
}) {
  const id = useId()
  const text: Record<Rating, string> = {
    na: RUBRIC_NA_TEXT,
    exclusive: row.exclusive,
    emerging: row.emerging,
    inclusive: row.inclusive,
  }
  const label = rowsInCategory > 1 ? `Row ${row.id.slice(-1)}` : 'Rating'
  return (
    <div role="radiogroup" aria-labelledby={`${id}-l`} className="flex flex-col gap-2">
      <p id={`${id}-l`} className="m-0 text-xs font-semibold uppercase tracking-wide text-neutral-600 dark:text-neutral-400">
        {label}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {RATING_ORDER.map((rating) => (
          <label key={rating} className={`${CHOICE} ${TARGET}`}>
            <input
              type="radio"
              name={id}
              checked={value === rating}
              onChange={() => onChoose(rating)}
              className="mt-0.5"
            />
            <span>
              <span className="font-semibold">{RATING_COPY[rating]}</span>
              <span className="block text-neutral-700 dark:text-neutral-300">{text[rating]}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --project unit src/components/idea/CategoryPanel.test.tsx`
Expected: PASS (11 tests). If the radio-name assertions fail because the accessible name concatenates both spans, the regexes are anchored on the label (`/^Emerging Inclusive/`) — keep the label span first inside the `<span>`.

- [ ] **Step 6: Typecheck (App.tsx error from Task 5 still expected) and commit**

```bash
npm run typecheck
git add src/components/idea/copy.ts src/components/idea/CategoryPanel.tsx src/components/idea/CategoryPanel.test.tsx
git commit -m "feat: one IDEA category as checklist, Rubric 1 rows, and notes

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 7: The reviews hook, with persistence

**Files:**
- Create: `src/components/idea/useIdeaReviews.ts`
- Test: `src/components/idea/useIdeaReviews.test.ts`

**Interfaces:**
- Consumes: `IdeaReview`, `IdeaHeader`, `IdeaReviewEvent`, `IdeaHeaderEvent`, `newReview`, `newHeader`, `reduceReview`, `reduceHeader` (Task 2); `IDEA_STORAGE_KEY`, `toPersisted`, `restore` (Task 3); `KeyValueStore` from `src/canvas/credentials`; `Chapter` from `src/sources/types`.
- Produces:
  ```ts
  export const SAVE_DELAY_MS = 400
  export function reviewKeyOf(chapter: Chapter): string          // `${source}::${bookId}::${title}`
  export function useIdeaReviews(store?: KeyValueStore): {
    header: IdeaHeader
    reviews: ReadonlyMap<string, IdeaReview>
    loaded: boolean                                               // false until the store has been read (or there is no store)
    reviewFor: (key: string) => IdeaReview                        // newReview() when absent
    dispatch: (key: string, event: IdeaReviewEvent) => void
    dispatchHeader: (event: IdeaHeaderEvent) => void
    forgetAll: () => void                                         // empties state and removes the stored document
  }
  ```

- [ ] **Step 1: Write the failing hook test**

`src/components/idea/useIdeaReviews.test.ts`:
```ts
import { act, renderHook, waitFor } from '@testing-library/react'
import { SAVE_DELAY_MS, reviewKeyOf, useIdeaReviews } from './useIdeaReviews'
import { IDEA_STORAGE_KEY, restore, toPersisted } from '../../engine/idea/store'
import { newHeader, newReview, reduceReview } from '../../engine/idea/review'
import type { KeyValueStore } from '../../canvas/credentials'
import type { Chapter } from '../../sources/types'

const chapter = (title: string): Chapter => ({
  source: 'openstax',
  bookId: 'book-1',
  title,
  sections: [],
  attribution: { bookTitle: 'B', publisher: 'P', authors: [] },
  xrefs: new Map(),
})

/** An in-memory KeyValueStore: what IndexedDB is to the app, a Map is to this test. */
function memoryStore(initial?: unknown) {
  const map = new Map<string, unknown>()
  if (initial !== undefined) map.set(IDEA_STORAGE_KEY, initial)
  const store: KeyValueStore = {
    get: async (key) => map.get(key),
    set: async (key, value) => { map.set(key, value) },
    remove: async (key) => { map.delete(key) },
  }
  return { map, store }
}

test('the key is stable for a chapter and distinct across chapters', () => {
  expect(reviewKeyOf(chapter('4: Nutrition'))).toBe(reviewKeyOf(chapter('4: Nutrition')))
  expect(reviewKeyOf(chapter('4: Nutrition'))).not.toBe(reviewKeyOf(chapter('5: Digestion')))
})

test('with no store, a review is created on first dispatch and kept per key', () => {
  const { result } = renderHook(() => useIdeaReviews())
  const k = reviewKeyOf(chapter('4: Nutrition'))
  expect(result.current.loaded).toBe(true)
  expect(result.current.reviews.size).toBe(0)
  expect(result.current.reviewFor(k).summary).toBe('')
  act(() => result.current.dispatch(k, { type: 'rate', categoryId: '7.2', rowId: '7.2.a', rating: 'inclusive' }))
  expect(result.current.reviews.get(k)?.categories['7.2'].ratings.get('7.2.a')).toBe('inclusive')
  act(() => result.current.dispatch(reviewKeyOf(chapter('5: Digestion')), { type: 'note', categoryId: '7.1', notes: 'x' }))
  expect(result.current.reviews.size).toBe(2)
  expect(result.current.reviews.get(k)?.categories['7.1'].notes).toBe('')
})

test('the header is one per session, not per chapter', () => {
  const { result } = renderHook(() => useIdeaReviews())
  expect(result.current.header.benchmark.bipocPercent).toBe(77)
  act(() => result.current.dispatchHeader({ type: 'assessor', assessor: { name: 'A. Lee' } }))
  act(() => result.current.dispatchHeader({ type: 'benchmark', bipocPercent: 62 }))
  expect(result.current.header).toEqual({ assessor: { name: 'A. Lee', title: '', college: '' }, benchmark: { bipocPercent: 62 } })
})

test('a saved document is restored on mount', async () => {
  const k = reviewKeyOf(chapter('4: Nutrition'))
  const saved = reduceReview(newReview(), { type: 'note', categoryId: '7.6', notes: 'from last week' })
  const { store } = memoryStore(toPersisted(newHeader(), new Map([[k, saved]])))
  const { result } = renderHook(() => useIdeaReviews(store))
  expect(result.current.loaded).toBe(false)
  await waitFor(() => expect(result.current.loaded).toBe(true))
  expect(result.current.reviews.get(k)?.categories['7.6'].notes).toBe('from last week')
})

test('a change is written to the store after the save delay, in the persisted shape', async () => {
  const { map, store } = memoryStore()
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  const k = reviewKeyOf(chapter('4: Nutrition'))
  act(() => result.current.dispatch(k, { type: 'note', categoryId: '7.1', notes: 'a' }))
  act(() => result.current.dispatch(k, { type: 'note', categoryId: '7.1', notes: 'ab' }))
  expect(map.has(IDEA_STORAGE_KEY)).toBe(false)
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(true), { timeout: SAVE_DELAY_MS * 5 })
  const back = restore(map.get(IDEA_STORAGE_KEY))!
  expect(back.reviews.get(k)?.categories['7.1'].notes).toBe('ab')
})

// A keystroke that lands before the read returns must not overwrite last
// week's reviews with one note.
test('nothing is written before the load has settled', async () => {
  let release!: () => void
  const gate = new Promise<void>((r) => { release = r })
  const { map, store } = memoryStore()
  const slow: KeyValueStore = { ...store, get: async (key) => { await gate; return store.get(key) } }
  const { result } = renderHook(() => useIdeaReviews(slow))
  act(() => result.current.dispatch('k', { type: 'summary', text: 'early' }))
  await new Promise((r) => setTimeout(r, SAVE_DELAY_MS * 2))
  expect(map.has(IDEA_STORAGE_KEY)).toBe(false)
  release()
  await waitFor(() => expect(result.current.loaded).toBe(true))
  expect(result.current.reviews.get('k')?.summary).toBe('early')
})

test('forgetAll empties every review and the header and removes the stored document', async () => {
  const { map, store } = memoryStore(toPersisted(newHeader(), new Map([['a', newReview()]])))
  const { result } = renderHook(() => useIdeaReviews(store))
  await waitFor(() => expect(result.current.reviews.size).toBe(1))
  act(() => result.current.dispatchHeader({ type: 'benchmark', bipocPercent: 50 }))
  act(() => result.current.forgetAll())
  expect(result.current.reviews.size).toBe(0)
  expect(result.current.header.benchmark.bipocPercent).toBe(77)
  await waitFor(() => expect(map.has(IDEA_STORAGE_KEY)).toBe(false))
  // And the pending debounce from the benchmark change does not resurrect it.
  await new Promise((r) => setTimeout(r, SAVE_DELAY_MS * 2))
  expect(map.has(IDEA_STORAGE_KEY)).toBe(false)
})

test('a store that fails leaves the hook usable and unsaved', async () => {
  const broken: KeyValueStore = {
    get: async () => { throw new Error('no indexedDB here') },
    set: async () => { throw new Error('no indexedDB here') },
    remove: async () => { throw new Error('no indexedDB here') },
  }
  const { result } = renderHook(() => useIdeaReviews(broken))
  await waitFor(() => expect(result.current.loaded).toBe(true))
  act(() => result.current.dispatch('k', { type: 'summary', text: 'still works' }))
  expect(result.current.reviews.get('k')?.summary).toBe('still works')
  await new Promise((r) => setTimeout(r, SAVE_DELAY_MS * 2))
  act(() => result.current.forgetAll())
  expect(result.current.reviews.size).toBe(0)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/components/idea/useIdeaReviews.test.ts`
Expected: FAIL — `Cannot find module './useIdeaReviews'`.

- [ ] **Step 3: Write the hook**

`src/components/idea/useIdeaReviews.ts`:
```ts
/**
 * A React shell over `reduceReview` and `reduceHeader`: one review per
 * prepared chapter, one header, and the disk.
 *
 * Plumbing, deliberately: every rule lives in `engine/idea/review.ts`. This
 * owns only what a pure function cannot — creating a review the first time a
 * chapter is touched, reading the saved document once on mount, writing it
 * back after each change, and throwing everything away on request.
 *
 * PERSISTED, because a review is hours of a person's judgment. A reload, a
 * closed tab, or a re-prepare of the same chapter must find it again. The
 * store is the app's IndexedDB (`createIdbStore`), injected so a test can hand
 * in a Map; the key is `IDEA_STORAGE_KEY`. It is NOT cleared by
 * `clearDerivedOutput`: reviews are keyed by chapter identity, so a
 * re-prepared chapter finds its own review and a different book starts blank.
 *
 * Three rules keep the disk honest:
 *  - nothing is written until the read has settled, or a keystroke that lands
 *    before the read returns would overwrite last week's reviews with one note;
 *  - writes are debounced (`SAVE_DELAY_MS`), because notes arrive a keystroke
 *    at a time and each write is a whole document;
 *  - `forgetAll` clears the dirty flag BEFORE it empties state, so a debounce
 *    already scheduled cannot write the old document back after the remove.
 *
 * A write pending at unmount is dropped. The hook lives in `App`, which never
 * unmounts, so this costs nothing in practice; it is noted so nobody moves it.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyValueStore } from '../../canvas/credentials'
import type { Chapter } from '../../sources/types'
import {
  newHeader, newReview, reduceHeader, reduceReview,
  type IdeaHeader, type IdeaHeaderEvent, type IdeaReview, type IdeaReviewEvent,
} from '../../engine/idea/review'
import { IDEA_STORAGE_KEY, restore, toPersisted } from '../../engine/idea/store'

export const SAVE_DELAY_MS = 400

/**
 * Source + book + title, because a chapter's identity here must survive a
 * recompile (which replaces the `CompiledChapter` object) and must NOT survive
 * choosing a different book that happens to have a chapter of the same name.
 */
export function reviewKeyOf(chapter: Chapter): string {
  return `${chapter.source}::${chapter.bookId}::${chapter.title}`
}

interface State {
  header: IdeaHeader
  reviews: ReadonlyMap<string, IdeaReview>
}

const empty = (): State => ({ header: newHeader(), reviews: new Map() })

export function useIdeaReviews(store?: KeyValueStore) {
  const [state, setState] = useState<State>(empty)
  const [loaded, setLoaded] = useState(store === undefined)
  const dirty = useRef(false)

  useEffect(() => {
    if (!store) return
    let cancelled = false
    store.get(IDEA_STORAGE_KEY)
      .then((value) => {
        if (cancelled) return
        const found = restore(value)
        // Merge under anything dispatched while the read was in flight: the
        // in-flight edits are newer than the disk by definition. `dirty` is
        // true exactly when something was dispatched before the read settled
        // (nothing is written, so nothing resets it, until `loaded`).
        if (found) {
          setState((s) => (dirty.current
            ? { header: s.header, reviews: new Map([...found.reviews, ...s.reviews]) }
            : found))
        }
      })
      .catch(() => { /* unreadable storage degrades to an unsaved session */ })
      .finally(() => { if (!cancelled) setLoaded(true) })
    return () => { cancelled = true }
  }, [store])

  useEffect(() => {
    if (!store || !loaded || !dirty.current) return
    const timer = setTimeout(() => {
      dirty.current = false
      void store.set(IDEA_STORAGE_KEY, toPersisted(state.header, state.reviews)).catch(() => {})
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [store, loaded, state])

  const reviewFor = useCallback((key: string) => state.reviews.get(key) ?? newReview(), [state.reviews])

  const dispatch = useCallback((key: string, event: IdeaReviewEvent) => {
    dirty.current = true
    setState((s) => {
      const reviews = new Map(s.reviews)
      reviews.set(key, reduceReview(s.reviews.get(key) ?? newReview(), event))
      return { ...s, reviews }
    })
  }, [])

  const dispatchHeader = useCallback((event: IdeaHeaderEvent) => {
    dirty.current = true
    setState((s) => ({ ...s, header: reduceHeader(s.header, event) }))
  }, [])

  const forgetAll = useCallback(() => {
    dirty.current = false
    setState(empty())
    if (store) void store.remove(IDEA_STORAGE_KEY).catch(() => {})
  }, [store])

  return { header: state.header, reviews: state.reviews, loaded, reviewFor, dispatch, dispatchHeader, forgetAll }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit src/components/idea/useIdeaReviews.test.ts`
Expected: PASS (8 tests). The "nothing is written before the load has settled" test relies on the dirty flag surviving until `loaded` flips; if it fails, check that the save effect lists `loaded` in its dependencies so it re-runs once the read returns.

- [ ] **Step 5: Typecheck (App.tsx error from Task 5 still expected) and commit**

```bash
npm run typecheck
git add src/components/idea/useIdeaReviews.ts src/components/idea/useIdeaReviews.test.ts
git commit -m "feat: hold IDEA reviews per chapter and keep them in the browser

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 8: The IDEA screen, with the chapter beside the panels

**Files:**
- Modify: `src/components/ChapterView.tsx` (add `audit?: boolean`)
- Test: `src/components/ChapterView.test.tsx` (append)
- Create: `src/components/idea/IdeaScreen.tsx`
- Test: `src/components/idea/IdeaScreen.test.tsx`

**Interfaces:**
- Consumes: `CategoryPanel`, `IDEA_COPY` (Task 6); `IdeaReview`, `IdeaHeader`, `IdeaReviewEvent`, `IdeaHeaderEvent`, `newReview` (Task 2); `IDEA_FRAMEWORK`, `FRAMEWORK_ATTRIBUTION`, `RUBRIC_SUMMARY_HINT`, `RUBRIC_SUGGESTIONS_HINT` (Task 1); `reviewKeyOf` (Task 7); `ChapterView`; `CompiledChapter` from `src/contracts/index`.
- Produces:
  ```ts
  // ChapterView gains:
  export function ChapterView(props: { compiled: CompiledChapter; audit?: boolean }): JSX.Element   // audit defaults to true

  export function IdeaScreen(props: {
    chapters: readonly CompiledChapter[]
    reviews: ReadonlyMap<string, IdeaReview>
    header: IdeaHeader
    onEvent: (key: string, event: IdeaReviewEvent) => void
    onHeaderEvent: (event: IdeaHeaderEvent) => void
    onForget: () => void
    onExport: (key: string, format: 'md' | 'json') => string     // returns the filename it produced
  }): JSX.Element
  ```

- [ ] **Step 1: Write the failing ChapterView test**

Append to `src/components/ChapterView.test.tsx`, inside the existing `describe('ChapterView', …)` block, using its `compiledWith` and `gate` helpers:
```tsx
  // The IDEA screen shows the chapter so the instructor can read what they are
  // rating. The accessibility verdicts belong to Review and would be noise
  // there — but the body must be the SAME gated bytes, never `s.html`.
  it('with audit off, renders the gated body and no accessibility panel', () => {
    render(<ChapterView compiled={compiledWith(gate('<p>gated</p>'), [{} as CompiledChapter['queue'][number]])} audit={false} />)
    expect(screen.getByText('gated')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Accessibility' })).not.toBeInTheDocument()
    expect(screen.queryByText(/need review before/)).not.toBeInTheDocument()
    expect(screen.queryByText('compiled but unaudited')).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Write the failing screen test**

`src/components/idea/IdeaScreen.test.tsx`:
```tsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IdeaScreen } from './IdeaScreen'
import { reviewKeyOf } from './useIdeaReviews'
import { newHeader, newReview, reduceHeader, reduceReview, type IdeaHeader, type IdeaHeaderEvent, type IdeaReview, type IdeaReviewEvent } from '../../engine/idea/review'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'

const chapter = (title: string): Chapter => ({
  source: 'openstax',
  bookId: 'book-1',
  title,
  sections: [],
  attribution: { bookTitle: 'Human Biology', publisher: 'LibreTexts', authors: [] },
  xrefs: new Map(),
})

/** A passed verdict, the way `PlanScreen.test.tsx` builds one. */
const GATE = {
  html: '<h2>Nutrients</h2><p>The body needs six major nutrients.</p>',
  conformance: { blockers: [], issues: [] },
  badgeWithheld: false,
} as unknown as CompiledSection['gate']

const section = (id: string, title: string): CompiledSection => ({
  id, title, html: '<p>compiled but unaudited</p>', notes: [], queue: [], gate: GATE,
})

const compiled = (title: string): CompiledChapter => ({
  chapter: chapter(title), sections: [section(`${title}-s1`, 'Nutrients')], queue: [],
})

function renderScreen({
  chapters = [compiled('4: Nutrition'), compiled('5: Digestion')],
  reviews = new Map<string, IdeaReview>(),
  header = newHeader(),
}: { chapters?: CompiledChapter[]; reviews?: Map<string, IdeaReview>; header?: IdeaHeader } = {}) {
  const onEvent = vi.fn<(key: string, e: IdeaReviewEvent) => void>()
  const onHeaderEvent = vi.fn<(e: IdeaHeaderEvent) => void>()
  const onForget = vi.fn()
  const onExport = vi.fn<(key: string, f: 'md' | 'json') => string>().mockReturnValue('idea-rubric1-x.md')
  render(
    <IdeaScreen chapters={chapters} reviews={reviews} header={header} onEvent={onEvent} onHeaderEvent={onHeaderEvent} onForget={onForget} onExport={onExport} />,
  )
  return { onEvent, onHeaderEvent, onForget, onExport }
}

test('with nothing prepared it says so', () => {
  renderScreen({ chapters: [] })
  expect(screen.getByText('Nothing to review yet. Prepare chapters first.')).toBeInTheDocument()
})

test('the eight categories render in order with only the first open', () => {
  renderScreen()
  const headers = screen.getAllByRole('button', { name: /^7\.\d / })
  expect(headers.map((h) => h.textContent?.slice(0, 3))).toEqual(['7.1', '7.2', '7.3', '7.4', '7.5', '7.6', '7.7', '7.8'])
  expect(headers[0]).toHaveAttribute('aria-expanded', 'true')
  expect(headers[1]).toHaveAttribute('aria-expanded', 'false')
})

test('opening a panel closes the one that was open', () => {
  renderScreen()
  fireEvent.click(screen.getByRole('button', { name: /^7\.6 / }))
  expect(screen.getByRole('button', { name: /^7\.6 / })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('button', { name: /^7\.1 / })).toHaveAttribute('aria-expanded', 'false')
})

// The instructor reads what they rate, on the same screen.
test('the chapter is readable beside the panels, without the accessibility verdicts', () => {
  renderScreen()
  const render = screen.getByRole('complementary', { name: 'Chapter as it will be published' })
  expect(within(render).getByText('The body needs six major nutrients.')).toBeInTheDocument()
  expect(within(render).queryByRole('heading', { name: 'Accessibility' })).not.toBeInTheDocument()
})

test('the chapter switcher changes which review and which chapter the screen shows', () => {
  const k5 = reviewKeyOf(chapter('5: Digestion'))
  const reviews = new Map([[k5, reduceReview(newReview(), { type: 'note', categoryId: '7.1', notes: 'digestion note' })]])
  renderScreen({ reviews })
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('')
  fireEvent.change(screen.getByRole('combobox', { name: 'Chapter under review' }), { target: { value: '1' } })
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('digestion note')
  expect(screen.getByRole('heading', { name: '5: Digestion' })).toBeInTheDocument()
})

test('events are dispatched with the current chapter key', () => {
  const { onEvent } = renderScreen()
  fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'hi' } })
  expect(onEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'note', categoryId: '7.1', notes: 'hi' })
})

test('summary and suggestions are chapter-level and dispatch with the current key', () => {
  const { onEvent } = renderScreen()
  fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'ok' } })
  expect(onEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'summary', text: 'ok' })
  fireEvent.change(screen.getByRole('textbox', { name: 'Suggestions' }), { target: { value: 'more' } })
  expect(onEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'suggestions', text: 'more' })
})

test('assessor and benchmark dispatch header events, not chapter events', () => {
  const { onEvent, onHeaderEvent } = renderScreen()
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'A. Lee' } })
  expect(onHeaderEvent).toHaveBeenCalledWith({ type: 'assessor', assessor: { name: 'A. Lee' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'BIPOC benchmark' }), { target: { value: '62' } })
  expect(onHeaderEvent).toHaveBeenCalledWith({ type: 'benchmark', bipocPercent: 62 })
  expect(onEvent).not.toHaveBeenCalled()
})

// Clearing the field to retype must not snap it to a number under the cursor.
test('an emptied benchmark field dispatches nothing and restores on blur', () => {
  const header = reduceHeader(newHeader(), { type: 'benchmark', bipocPercent: 62 })
  const { onHeaderEvent } = renderScreen({ header })
  const field = screen.getByRole('spinbutton', { name: 'BIPOC benchmark' })
  expect(field).toHaveValue(62)
  fireEvent.change(field, { target: { value: '' } })
  expect(onHeaderEvent).not.toHaveBeenCalled()
  expect(field).toHaveValue(null)
  fireEvent.blur(field)
  expect(field).toHaveValue(62)
})

test('export is two plain buttons and announces the file produced', () => {
  const { onExport } = renderScreen()
  const group = screen.getByRole('group', { name: 'Export Rubric 1' })
  fireEvent.click(within(group).getByRole('button', { name: 'Download JSON' }))
  expect(onExport).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), 'json')
  expect(screen.getByRole('status')).toHaveTextContent('Downloaded idea-rubric1-x.md.')
  fireEvent.click(within(group).getByRole('button', { name: 'Download Markdown' }))
  expect(onExport).toHaveBeenLastCalledWith(reviewKeyOf(chapter('4: Nutrition')), 'md')
})

test('forgetting asks first, then forgets and announces', () => {
  const { onForget } = renderScreen()
  fireEvent.click(screen.getByRole('button', { name: 'Forget all IDEA reviews' }))
  expect(onForget).not.toHaveBeenCalled()
  const confirm = screen.getByRole('group', { name: 'Forget all IDEA reviews' })
  expect(within(confirm).getByText(/removes every chapter/)).toBeInTheDocument()
  fireEvent.click(within(confirm).getByRole('button', { name: 'Keep' }))
  expect(onForget).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Forget all IDEA reviews' }))
  fireEvent.click(within(screen.getByRole('group', { name: 'Forget all IDEA reviews' })).getByRole('button', { name: 'Forget' }))
  expect(onForget).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('status')).toHaveTextContent('IDEA reviews forgotten.')
})

test('the storage rule and the Framework attribution are on screen', () => {
  renderScreen()
  expect(screen.getByText(/saved in this browser on this device/)).toBeInTheDocument()
  expect(screen.getByText(/Framework text from "ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism \(IDEA\) Framework/)).toBeInTheDocument()
  expect(screen.getByText(/licensed CC BY 4\.0/)).toBeInTheDocument()
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run --project unit src/components/ChapterView.test.tsx src/components/idea/IdeaScreen.test.tsx`
Expected: FAIL — `audit` is not a prop; `Cannot find module './IdeaScreen'`.

- [ ] **Step 4: Change `ChapterView.tsx`**

Change the signature and the two audit-only renders:
```tsx
/**
 * `audit` (default true) shows the per-section accessibility verdict and the
 * "items need review" line. The IDEA screen turns it off: it shows the chapter
 * so the instructor can READ what they are rating, and the verdicts belong to
 * Review. What it does not turn off is the body's source — `s.gate.html`,
 * always, for the reason the comment below gives.
 */
export function ChapterView({ compiled, audit = true }: { compiled: CompiledChapter; audit?: boolean }) {
```
and wrap the two audit-only elements: `{audit && compiled.queue.length > 0 && (…)}` and `{audit && s.gate && <AuditPanel result={s.gate} />}`. Everything else, including the `!s.gate` fallback and the `resolve(s.gate.html)` body, is unchanged.

- [ ] **Step 5: Write the screen**

`src/components/idea/IdeaScreen.tsx`:
```tsx
/**
 * The IDEA phase: one chapter at a time, eight category panels, the chapter's
 * own repaired HTML beside them, a header that carries what Rubric 1's header
 * carries (assessor, benchmark), the rubric's chapter-level Summary and
 * Suggestions, the export, and the forget control.
 *
 * THE CHAPTER IS ON THIS SCREEN. An instructor rating "Appropriate
 * Terminology" has to be reading the terminology; sending them back to Review
 * to look is how a review gets done from memory. `ChapterView` with `audit`
 * off renders exactly the bytes Review approved, no verdicts.
 *
 * One panel open at a time by default. Eight open panels of checklist radios
 * is a wall; one open panel with the other seven headers visible is a table of
 * contents. The instructor can always open the next one.
 *
 * Export is two plain buttons, not a menu: a `role="menu"` owes arrow-key and
 * Escape handling it would not get here, and two buttons need neither.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import type { CompiledChapter } from '../../contracts/index'
import { ChapterView } from '../ChapterView'
import {
  FRAMEWORK_ATTRIBUTION, IDEA_FRAMEWORK, RUBRIC_SUGGESTIONS_HINT, RUBRIC_SUMMARY_HINT, type CategoryId,
} from '../../engine/idea/framework'
import {
  newReview, type IdeaHeader, type IdeaHeaderEvent, type IdeaReview, type IdeaReviewEvent,
} from '../../engine/idea/review'
import { CategoryPanel } from './CategoryPanel'
import { IDEA_COPY } from './copy'
import { reviewKeyOf } from './useIdeaReviews'

const TARGET = 'min-h-9 min-w-9'
const FIELD =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const AREA =
  'rounded-md border border-neutral-300 bg-white p-2 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const CARD =
  'flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'
const BUTTON =
  `${TARGET} inline-flex items-center gap-2 rounded-md border px-3 text-sm`
const PRIMARY = `${BUTTON} border-brand-700 bg-brand-700 text-white`
const QUIET = `${BUTTON} border-neutral-300 text-neutral-800 hover:bg-stone-100 dark:border-neutral-700 dark:text-neutral-200 dark:hover:bg-neutral-800`

export function IdeaScreen({
  chapters, reviews, header, onEvent, onHeaderEvent, onForget, onExport,
}: {
  chapters: readonly CompiledChapter[]
  reviews: ReadonlyMap<string, IdeaReview>
  header: IdeaHeader
  onEvent: (key: string, event: IdeaReviewEvent) => void
  onHeaderEvent: (event: IdeaHeaderEvent) => void
  onForget: () => void
  /** Produces the download and returns its filename, which the status line announces. */
  onExport: (key: string, format: 'md' | 'json') => string
}) {
  const ids = useId()
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState<CategoryId>('7.1')
  const [status, setStatus] = useState('')
  const [confirmForget, setConfirmForget] = useState(false)
  // The benchmark field holds its own text so it can be emptied to retype;
  // only a finite number is dispatched, and blur restores the stored value.
  const [benchText, setBenchText] = useState(String(header.benchmark.bipocPercent))
  const forgetButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setBenchText(String(header.benchmark.bipocPercent))
  }, [header.benchmark.bipocPercent])

  // A shorter selection after a re-prepare must not leave the index pointing
  // past the end.
  useEffect(() => {
    if (index >= chapters.length) setIndex(0)
  }, [chapters.length, index])

  if (chapters.length === 0) {
    return <p className="text-sm text-neutral-700 dark:text-neutral-300">{IDEA_COPY.empty}</p>
  }

  const current = chapters[Math.min(index, chapters.length - 1)]
  const key = reviewKeyOf(current.chapter)
  const review = reviews.get(key) ?? newReview()
  const dispatch = (event: IdeaReviewEvent) => onEvent(key, event)

  const exportAs = (format: 'md' | 'json') => {
    const name = onExport(key, format)
    setStatus(IDEA_COPY.export.done(name))
  }

  const onBenchmarkChange = (text: string) => {
    setBenchText(text)
    const n = Number(text)
    if (text.trim() !== '' && Number.isFinite(n)) onHeaderEvent({ type: 'benchmark', bipocPercent: n })
  }

  const forget = () => {
    onForget()
    setConfirmForget(false)
    setStatus(IDEA_COPY.forget.done)
    forgetButton.current?.focus()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{IDEA_COPY.intro}</p>

      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <div className={CARD}>
            <div className="flex flex-wrap items-end gap-3">
              {chapters.length > 1 && (
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold">{IDEA_COPY.chapterSwitcher}</span>
                  <select
                    className={`${FIELD} ${TARGET}`}
                    value={index}
                    onChange={(e) => setIndex(Number(e.target.value))}
                  >
                    {chapters.map((c, i) => (
                      <option key={reviewKeyOf(c.chapter)} value={i}>{c.chapter.title}</option>
                    ))}
                  </select>
                </label>
              )}
              {chapters.length === 1 && (
                <p className="m-0 text-sm"><span className="font-semibold">{IDEA_COPY.chapterSwitcher}:</span> {current.chapter.title}</p>
              )}

              <div role="group" aria-label={IDEA_COPY.export.legend} className="ml-auto flex flex-wrap gap-2">
                <button type="button" onClick={() => exportAs('md')} className={PRIMARY}>
                  <Download className="size-4" aria-hidden="true" />
                  {IDEA_COPY.export.markdown}
                </button>
                <button type="button" onClick={() => exportAs('json')} className={PRIMARY}>
                  <Download className="size-4" aria-hidden="true" />
                  {IDEA_COPY.export.json}
                </button>
              </div>
            </div>

            <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
              <legend className="mb-1 text-sm font-semibold">{IDEA_COPY.assessor.legend}</legend>
              <p className="m-0 w-full text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.assessor.hint}</p>
              {(['name', 'title', 'college'] as const).map((field) => (
                <label key={field} className="flex flex-col gap-1 text-sm">
                  <span>{IDEA_COPY.assessor[field]}</span>
                  <input
                    type="text"
                    className={`${FIELD} ${TARGET}`}
                    value={header.assessor[field]}
                    onChange={(e) => onHeaderEvent({ type: 'assessor', assessor: { [field]: e.target.value } })}
                  />
                </label>
              ))}
            </fieldset>

            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-bench`} className="text-sm font-semibold">{IDEA_COPY.benchmark.label}</label>
              <div className="flex items-center gap-2">
                <input
                  id={`${ids}-bench`}
                  type="number"
                  min={0}
                  max={100}
                  className={`${FIELD} ${TARGET} w-24`}
                  value={benchText}
                  onChange={(e) => onBenchmarkChange(e.target.value)}
                  onBlur={() => setBenchText(String(header.benchmark.bipocPercent))}
                />
                <span className="text-sm">%</span>
              </div>
              <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.benchmark.hint}</p>
            </div>

            <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.storage}</p>
            {/*
              The button stays mounted while the confirmation shows, so focus
              has somewhere to return to after Forget or Keep, and so the
              disclosure reads as one: aria-expanded on the trigger, the
              question beneath it.
            */}
            <div>
              <button
                ref={forgetButton}
                type="button"
                aria-expanded={confirmForget}
                aria-controls={`${ids}-forget`}
                onClick={() => setConfirmForget((c) => !c)}
                className={QUIET}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                {IDEA_COPY.forget.button}
              </button>
            </div>
            {confirmForget && (
              <div id={`${ids}-forget`} role="group" aria-label={IDEA_COPY.forget.button} className="flex flex-col gap-2">
                <p className="m-0 text-sm">{IDEA_COPY.forget.confirm}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={forget} className={QUIET}>{IDEA_COPY.forget.yes}</button>
                  <button type="button" onClick={() => { setConfirmForget(false); forgetButton.current?.focus() }} className={PRIMARY}>{IDEA_COPY.forget.no}</button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            {IDEA_FRAMEWORK.map((category) => (
              <CategoryPanel
                key={`${key}:${category.id}`}
                category={category}
                review={review.categories[category.id]}
                open={open === category.id}
                onToggle={() => setOpen((o) => (o === category.id ? o : category.id))}
                onEvent={dispatch}
              />
            ))}
          </div>

          <fieldset className={`${CARD} m-0`}>
            <legend className="text-sm font-semibold">{IDEA_COPY.chapterLevel.legend}</legend>
            <label htmlFor={`${ids}-summary`} className="text-sm font-semibold">{IDEA_COPY.chapterLevel.summary}</label>
            <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{RUBRIC_SUMMARY_HINT}</p>
            <textarea
              id={`${ids}-summary`}
              rows={3}
              className={AREA}
              value={review.summary}
              onChange={(e) => dispatch({ type: 'summary', text: e.target.value })}
            />
            <label htmlFor={`${ids}-suggestions`} className="text-sm font-semibold">{IDEA_COPY.chapterLevel.suggestions}</label>
            <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{RUBRIC_SUGGESTIONS_HINT}</p>
            <textarea
              id={`${ids}-suggestions`}
              rows={3}
              className={AREA}
              value={review.suggestions}
              onChange={(e) => dispatch({ type: 'suggestions', text: e.target.value })}
            />
          </fieldset>

          <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">
            {IDEA_COPY.attribution(FRAMEWORK_ATTRIBUTION.title, FRAMEWORK_ATTRIBUTION.author, FRAMEWORK_ATTRIBUTION.license.name)}{' '}
            <a href={FRAMEWORK_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer" className="underline">
              asccc-oeri.org<span className="sr-only"> ({IDEA_COPY.opensNewTab})</span>
            </a>
          </p>
        </div>

        {/*
          Sticky on wide screens so the text stays in view while the panels
          scroll; a plain block below the panels on narrow ones. The region has
          its own scroll so a long chapter does not push the panels off screen.
        */}
        <aside
          aria-label={IDEA_COPY.renderLabel}
          className={`${CARD} min-w-0 lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto`}
        >
          <ChapterView compiled={current} audit={false} />
        </aside>
      </div>

      {/* Mounted empty rather than conditionally, so the announcement lands in a region that already exists. */}
      <p role="status" aria-live="polite" className="m-0 text-sm">{status}</p>
    </div>
  )
}
```

Note on `onToggle`: a click on the open panel's header leaves it open (`o === category.id ? o : category.id`). The spec says one open at a time; collapsing to zero open panels would hide every checklist and is not offered. Test 'opening a panel closes the one that was open' covers the switch.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/components/ChapterView.test.tsx src/components/idea/`
Expected: PASS (ChapterView's existing tests plus 1; 8 hook tests; 12 screen tests; 11 panel tests). `ChapterView` renders a `<section aria-labelledby="chapter-heading">` with the chapter title as its `h2`; the switcher test's `getByRole('heading', { name: '5: Digestion' })` finds that heading.

- [ ] **Step 7: Typecheck (App.tsx error from Task 5 still expected) and commit**

```bash
npm run typecheck
git add src/components/ChapterView.tsx src/components/ChapterView.test.tsx src/components/idea/IdeaScreen.tsx src/components/idea/IdeaScreen.test.tsx
git commit -m "feat: the IDEA screen, with the chapter readable beside the rubric

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 9: Wire the phase into the app and the Plan screen

**Files:**
- Modify: `src/App.tsx` (imports ~lines 6–39; module-level `disk` ~line 73; state near line 281; `clearDerivedOutput` near line 358 — NOT changed, see below; `shell` literal near line 667; screen switch near line 777–834)
- Modify: `src/shell/PlanScreen.tsx` (props near line 45; body — add one line above the commit control)
- Test: `src/App.test.tsx` (append), `src/shell/PlanScreen.test.tsx` (append)

**Interfaces:**
- Consumes: `IdeaScreen` (Task 8); `useIdeaReviews`, `reviewKeyOf` (Task 7); `ratedCount` (Task 2); `rubric1Markdown`, `rubric1Json`, `rubric1Filename`, `downloadTextFile` (Task 4); `ideaSummary` (Task 5); `IDEA_CATEGORY_IDS` (Task 1); the existing module-level `disk` (`createIdbStore()`).
- Produces: `PlanScreen` gains an optional prop `ideaSummary?: string`.

- [ ] **Step 1: Write the failing tests**

Append to `src/shell/PlanScreen.test.tsx`, using the file's own `CHAPTERS` fixture (the screen returns early with "Nothing to plan" on an empty list, so an empty list can never show the line):
```tsx
test('the plan states the IDEA review status above the commit control', () => {
  render(<PlanScreen destination={{ kind: 'cartridge' }} chapters={CHAPTERS} unansweredCount={0} ideaSummary="3 of 8 rated" />)
  expect(screen.getByText('IDEA review — 3 of 8 rated')).toBeInTheDocument()
})

test('with no IDEA summary the plan says nothing about it', () => {
  render(<PlanScreen destination={{ kind: 'cartridge' }} chapters={CHAPTERS} unansweredCount={0} />)
  expect(screen.queryByText(/IDEA review —/)).not.toBeInTheDocument()
})
```

Append to `src/App.test.tsx` (this file already renders `App`; the module-level IndexedDB store rejects under jsdom, which the hook swallows):
```tsx
test('the sidebar carries an IDEA phase that is shut before chapters are prepared', () => {
  render(<App />)
  const idea = screen.getByRole('button', { name: /IDEA/ })
  expect(idea).toHaveAttribute('aria-disabled', 'true')
  expect(idea).toHaveTextContent('select chapters first')
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --project unit src/shell/PlanScreen.test.tsx src/App.test.tsx`
Expected: FAIL — `ideaSummary` is not a prop; the IDEA button is absent (`App.tsx` does not compile until the shell literal gains the fields).

- [ ] **Step 3: `PlanScreen.tsx`**

Add to the props type:
```ts
  /** What the sidebar says about the optional IDEA review; absent before any chapter is prepared. */
  ideaSummary?: string
```
and destructure `ideaSummary`. In the non-empty branch, immediately above the element that renders the commit control (`commitLabel(...)` — search for `onCommit` in the JSX), add:
```tsx
      {ideaSummary && (
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {`IDEA review — ${ideaSummary}`}
        </p>
      )}
```

- [ ] **Step 4: `App.tsx`**

Imports (add near the other component/engine imports):
```ts
import { IdeaScreen } from './components/idea/IdeaScreen'
import { reviewKeyOf, useIdeaReviews } from './components/idea/useIdeaReviews'
import { ratedCount } from './engine/idea/review'
import { IDEA_CATEGORY_IDS } from './engine/idea/framework'
import { rubric1Filename, rubric1Json, rubric1Markdown } from './engine/idea/rubric-export'
import { downloadTextFile } from './engine/idea/download'
import { ideaSummary } from './shell/phases'
```

State — after `const [prepared, setPrepared] = …` add:
```ts
  /**
   * One IDEA review per prepared chapter, keyed by `reviewKeyOf`, plus the
   * session's assessor and benchmark, all kept in the same IndexedDB the
   * credential store uses. Lives here rather than in the screen so it survives
   * a visit to Review or Plan. NOT reset by `clearDerivedOutput`: a review is
   * the instructor's, not derived from the output, and a re-prepared chapter
   * must find it again. It is keyed by chapter identity, so a different book
   * starts blank on its own.
   */
  const ideaReviews = useIdeaReviews(disk)
```

`clearDerivedOutput()` is unchanged. Do not add a reset there.

Below `commitCartridge`, add:
```ts
  /** Rubric 1 as a file. Download only — never packaged into the cartridge. */
  function exportRubric(key: string, format: 'md' | 'json'): string {
    const compiled = prepared.find((c) => reviewKeyOf(c.chapter) === key)
    const review = ideaReviews.reviewFor(key)
    const chapterTitle = compiled?.chapter.title ?? ''
    const ctx = {
      bookTitle: compiled?.chapter.attribution.bookTitle ?? '',
      chapterTitle,
      ...(compiled?.chapter.attribution.publisher ? { publisher: compiled.chapter.attribution.publisher } : {}),
      ...(compiled?.chapter.attribution.url ? { sourceUrl: compiled.chapter.attribution.url } : {}),
      exportedAt: new Date(),
    }
    const name = rubric1Filename(chapterTitle, ctx.exportedAt, format)
    if (format === 'md') downloadTextFile(name, rubric1Markdown(review, ideaReviews.header, ctx), 'text/markdown')
    else downloadTextFile(name, JSON.stringify(rubric1Json(review, ideaReviews.header, ctx), null, 2), 'application/json')
    return name
  }
```

The `shell` literal — add:
```ts
    ideaRated: prepared.reduce((n, c) => n + ratedCount(ideaReviews.reviewFor(reviewKeyOf(c.chapter))), 0),
    ideaTotal: prepared.length * IDEA_CATEGORY_IDS.length,
```

Screen switch — insert between the last `phase === 'review'` block and `phase === 'plan'`:
```tsx
      {phase === 'idea' && (
        <IdeaScreen
          chapters={prepared}
          reviews={ideaReviews.reviews}
          header={ideaReviews.header}
          onEvent={ideaReviews.dispatch}
          onHeaderEvent={ideaReviews.dispatchHeader}
          onForget={ideaReviews.forgetAll}
          onExport={exportRubric}
        />
      )}
```

`PlanScreen` — add the prop:
```tsx
          {...(prepared.length > 0 ? { ideaSummary: ideaSummary(shell.ideaRated, shell.ideaTotal) } : {})}
```

- [ ] **Step 5: Run the tests and the full unit project**

Run: `npm run typecheck && npx vitest run --project unit`
Expected: typecheck clean (the Task 5 red is closed); all unit tests pass. `docs-claims.test.ts` still passes here because Task 11 adds its obligations together with the docs that satisfy them.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/shell/PlanScreen.tsx src/shell/PlanScreen.test.tsx
git commit -m "feat: mount the IDEA phase, derive its sidebar count, export Rubric 1

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 10: Browser tests — accessibility and forced colours

**Files:**
- Create: `src/components/idea/IdeaScreen.browser.test.tsx`
- Create: `src/components/idea/idea.forced-colors.browser.test.tsx`

**Interfaces:**
- Consumes: `IdeaScreen` (Task 8); the WCAG tag list and duplicate-id check modeled on `src/App.a11y.browser.test.tsx`.

- [ ] **Step 1: Write the a11y browser test**

`src/components/idea/IdeaScreen.browser.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { IdeaScreen } from './IdeaScreen'
import { newHeader } from '../../engine/idea/review'
import type { CompiledChapter, CompiledSection } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import '../../App.css'

/**
 * The IDEA screen is held to the rule set the rest of the app's own UI is
 * held to (`App.a11y.browser.test.tsx`): full WCAG A/AA tags, nothing
 * removed, in a real browser where axe has layout. Radios inside labels with
 * two spans of text is exactly the construction that reads fine in jsdom and
 * fails a real label-content check. The chapter render is included, with a
 * real section body, because publisher html beside app chrome is where
 * heading-order and landmark rules actually bite.
 */
const WCAG_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

const chapter: Chapter = {
  source: 'openstax',
  bookId: 'book-1',
  title: '4: Nutrition',
  sections: [],
  attribution: { bookTitle: 'Human Biology', publisher: 'LibreTexts', authors: [] },
  xrefs: new Map(),
}
const GATE = {
  html: '<h2>Nutrients</h2><p>The body needs six major nutrients.</p>',
  conformance: { blockers: [], issues: [] },
  badgeWithheld: false,
} as unknown as CompiledSection['gate']
const compiled: CompiledChapter = {
  chapter,
  sections: [{ id: 's1', title: 'Nutrients', html: '<p>x</p>', notes: [], queue: [], gate: GATE }],
  queue: [],
}
const props = { reviews: new Map(), header: newHeader(), onEvent: () => {}, onHeaderEvent: () => {}, onForget: () => {}, onExport: () => 'x.md' }

async function violationsIn(container: Element): Promise<string[]> {
  const results = await axe.run(container, { runOnly: { type: 'tag', values: WCAG_AA } })
  return results.violations.map((v) => `${v.id}: ${v.description}`)
}

function duplicateIds(container: Element): string[] {
  const seen = new Map<string, number>()
  for (const el of container.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
}

test('the IDEA screen has no WCAG A/AA violations and no duplicate ids, with a panel open, the chapter rendered, and the forget confirmation showing', async () => {
  const { container } = render(
    <IdeaScreen chapters={[compiled, { ...compiled, chapter: { ...chapter, title: '5: Digestion' } }]} {...props} />,
  )
  expect(duplicateIds(container)).toEqual([])
  expect(await violationsIn(container)).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: /^7\.6 / }))
  fireEvent.click(screen.getByRole('button', { name: 'Forget all IDEA reviews' }))
  expect(duplicateIds(container)).toEqual([])
  expect(await violationsIn(container)).toEqual([])
})

// WCAG 2.2 SC 2.5.8. Inline links in running text (the resource list, the
// attribution) are exempt under the criterion's inline exception and are not
// measured; every other control is. Radios sit inside a label that is the
// real target, so the label is what is measured for them.
test('every non-inline control meets the 24x24 target floor', () => {
  const { container } = render(<IdeaScreen chapters={[compiled]} {...props} />)
  for (const el of container.querySelectorAll('button, input, select, textarea')) {
    const target = el instanceof HTMLInputElement && el.type === 'radio' ? el.closest('label')! : el
    const box = target.getBoundingClientRect()
    expect(Math.min(box.width, box.height), (el as HTMLElement).outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(24)
  }
})
```

- [ ] **Step 2: Write the forced-colours test**

`src/components/idea/idea.forced-colors.browser.test.tsx`:
```tsx
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { IdeaScreen } from './IdeaScreen'
import { newHeader } from '../../engine/idea/review'
import type { CompiledChapter } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import '../../App.css'

/**
 * With forced colours ON, a checked rating must still be distinguishable from
 * an unchecked one by something other than a background tint — the browser
 * strips backgrounds in that mode. The native radio's checked state survives;
 * this asserts the mode is really on and that the radio, not a styled span,
 * is what carries the state.
 */
afterEach(cleanup)

const chapter: Chapter = {
  source: 'openstax', bookId: 'b', title: '4: Nutrition', sections: [],
  attribution: { bookTitle: 'B', publisher: 'P', authors: [] }, xrefs: new Map(),
}
const compiled: CompiledChapter = { chapter, sections: [], queue: [] }
const props = { reviews: new Map(), header: newHeader(), onEvent: () => {}, onHeaderEvent: () => {}, onForget: () => {}, onExport: () => 'x.md' }

test('forced colours is active for this project', () => {
  expect(window.matchMedia('(forced-colors: active)').matches).toBe(true)
})

test('a rating is a native radio whose checked state does not depend on colour', () => {
  render(<IdeaScreen chapters={[compiled]} {...props} />)
  const rubric = screen.getByRole('group', { name: /Rubric 1/ })
  const radio = within(rubric).getAllByRole('radio')[0]
  expect(radio).toBeInstanceOf(HTMLInputElement)
  expect((radio as HTMLInputElement).type).toBe('radio')
  const label = radio.closest('label')!
  const style = getComputedStyle(label)
  // A border is what survives forced colours; a background does not.
  expect(parseFloat(style.borderTopWidth)).toBeGreaterThan(0)
})
```

- [ ] **Step 3: Run both browser projects**

Run: `npx vitest run --project browser src/components/idea/ && npx vitest run --project browser-forced-colors src/components/idea/`
Expected: PASS. If the a11y run reports `label` or `label-content-name-mismatch`, the fix is in `CategoryPanel.tsx`: keep the visible label text as the first child span of the `<label>` (it already is). If it reports `heading-order`, the chapter render's `h2` (chapter title) sits inside an `<aside>` beside `h3` panel headers; axe's heading-order rule is per document order, and an `h2` after `h3`s is allowed — but if it fires, wrap the panels column in a `<section aria-label>` and confirm the report names the real offender before changing markup. If it reports `landmark-complementary-is-top-level`, that rule is not in the WCAG tag set and should not run; confirm `runOnly` is being honoured.

- [ ] **Step 4: Commit**

```bash
git add src/components/idea/IdeaScreen.browser.test.tsx src/components/idea/idea.forced-colors.browser.test.tsx
git commit -m "test: hold the IDEA screen to WCAG AA and forced colours

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

### Task 11: Documentation and the acceptance scenario

**Files:**
- Modify: `README.md` (add a section after "## Accessibility and content integrity", ~line 353)
- Modify: `PRIVACY.md` (a paragraph after "Small workflow values remain browser-local…")
- Modify: `THIRD-PARTY-NOTICES.md` (after the model paragraph at the end)
- Create: `docs/IDEA.md`
- Modify: `docs/RELEASE-ACCEPTANCE.md` (append one scenario)
- Test: `src/docs-claims.test.ts` (append three obligations)

- [ ] **Step 1: Add the obligation tests**

In `src/docs-claims.test.ts`, inside the `obligations` array, add:
```ts
    ['idea framework attribution', /IDEA Framework[^.\n]*CC BY 4\.0/i],
    ['idea never gates', /IDEA[^.\n]*(optional|never (blocks|gates))/i],
    ['idea reviews stay in this browser', /IDEA[^.\n]*(IndexedDB|in (this|your) browser)/i],
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit src/docs-claims.test.ts`
Expected: FAIL on all three new obligations.

- [ ] **Step 3: README**

Add after the "Accessibility and content integrity" section:
```markdown
## IDEA review (optional)

After the accessibility review, an optional **IDEA** phase applies the ASCCC OERI Inclusion,
Diversity, Equity, and Anti-Racism (IDEA) Framework to each prepared chapter, with the chapter's
own pages shown beside the rubric so you read what you rate. It offers the Framework's eight
categories as checklists, its Rubric 1 rows rated by the instructor, notes, the rubric's Summary
and Suggestions, an editable BIPOC benchmark (77% by default, per the Framework's §9.0), and a
Rubric 1 download as Markdown or JSON. The IDEA review is optional and never blocks publishing;
ratings are entered by a person and are never computed by the app. The rubric file is a download
only and is never packaged into the cartridge.

IDEA reviews, the assessor, and the benchmark are saved in this browser on this device (the app's
IndexedDB database) so a reload or a re-prepare does not lose them; **Forget all IDEA reviews**
removes them, and clearing site data does too. Nothing about a review is sent anywhere; nothing in
this phase makes a network request. Framework text is reproduced in full from the ASCCC OERI IDEA
Framework and Implementation Guide (March 2025), licensed CC BY 4.0, and is attributed on screen
and in `THIRD-PARTY-NOTICES.md`.
```

- [ ] **Step 4: PRIVACY.md**

After the paragraph beginning "Small workflow values remain browser-local.", add:
```markdown
The optional IDEA review keeps its ratings, checklist answers, notes, assessor name and title, and
BIPOC benchmark in this browser's IndexedDB database on this device, so that a reload does not
lose them. They are never sent to the relay, to a publisher, or to any other host, and are removed
by **Forget all IDEA reviews** on the IDEA screen or by clearing site data. On a shared computer,
forget them when you are done.
```

- [ ] **Step 5: THIRD-PARTY-NOTICES**

Append:
```markdown
The IDEA phase reproduces, in full, the category descriptions ("Restorative Requirements"),
"Elements for Consideration", Rubric 1 rows and instructions, and the Additional Resources links
from the "ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism (IDEA) Framework and
Implementation Guide, March 2025" by the ASCCC Open Educational Resources Initiative
(https://asccc-oeri.org/asccc-oeri-inclusion-diversity-equity-and-anti-racism-idea-audit-framework/),
licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The text is vendored in
`src/engine/idea/framework.ts`, where the one editorial choice (an unbulleted example paragraph
kept with its bullet) is recorded; element and row ids there are ours, stable, and never
renumbered.
```

- [ ] **Step 6: `docs/IDEA.md`**

```markdown
# IDEA review — data boundary and licensing

This file states, in one place, what the IDEA phase does with data. It is kept current slice by
slice; the design is in `IDEA_REVIEW_SPEC.md`.

## Slice 1 (this release)

- **Network:** none. The Framework text is vendored; the Rubric 1 export is built in the browser
  and handed to the browser's download.
- **Storage:** the review (ratings, checklist answers, notes, summary, suggestions, per chapter),
  the assessor, and the benchmark are written to the app's IndexedDB database
  (`oer2canvas`, key `idea.reviews`) on this device, debounced after each change. They are read
  back on load through a validating restore that replays them through the reducers, so a stale or
  edited document degrades to "nothing recorded", never to a rating nobody clicked. *Forget all
  IDEA reviews* removes the document. Clearing the prepared output does not: reviews are keyed by
  chapter identity, so a re-prepared chapter finds its own review and a different book starts
  blank.
- **Inference:** none. The app never infers race, ethnicity, gender, or disability from anything.
  Every rating and checklist answer is entered by the instructor.
- **Gate:** none. `phaseAvailability(...).plan` reads no IDEA field. IDEA never blocks Plan.
- **What is shown:** the chapter's gated, repaired HTML — the same bytes Review approved — beside
  the rubric. Nothing from the raw or un-audited compile is rendered there.

## Licensing of what ships

- Framework text: CC BY 4.0, ASCCC OERI, reproduced in full, attributed in the panel footer and
  THIRD-PARTY-NOTICES.md.
- The ASCCC-hosted Culturally Responsive Curriculum Assessment Tool is CC BY-NC-SA and is
  linked, never embedded.

## Later slices (not yet shipped)

- Rule checks and inventories run in the browser with no network.
- Model calls go browser → the chosen provider, on click only, with the user's key stored in
  the user's browser on the user's device and nowhere else. No key ever transits the relay.
- Image search goes browser → Wikimedia Commons / Openverse, query text only.
```

- [ ] **Step 7: RELEASE-ACCEPTANCE scenario**

Append to `docs/RELEASE-ACCEPTANCE.md`, matching the file's existing scenario format:
```markdown
## 4. IDEA review — slice 1

1. Prepare one OpenStax chapter through Review until the queue is clear.
2. Sidebar: **IDEA — optional** is enabled; **Plan** is enabled regardless.
3. Open IDEA. The chapter's pages are readable beside the panels, with no accessibility panels
   in them. Only 7.1 is expanded. Rate all three 7.1 rows; the header reads "3 of 3 rows rated"
   and the sidebar reads **IDEA — 1 of 8 rated**. Plan shows "IDEA review — 1 of 8 rated".
4. Answer two checklist items and type a note under 7.6. Rate 7.6 "Not Applicable"; its header
   reads "rated".
5. Set the benchmark to 62 and the assessor name. Type a Summary and a Suggestion.
6. **Reload the tab.** Prepare the same chapter again. Open IDEA: every rating, note, the
   summary, the benchmark, and the assessor are still there.
7. Download Markdown. The status line names the file. Open it: header carries the textbook,
   chapter, assessor, and "62%"; the table has 10 rows (3 + 7) under Rubric 1's own area titles;
   7.6 reads "Not Applicable" with the note; unrated rows read "Not rated"; the Category count
   block sums to 10; Summary and Suggestions carry what was typed; the CC BY 4.0 attribution is
   at the foot.
8. Download JSON. `areas[0].rows` has three entries with ratings; `areas[5].rows[0].rating` is
   `"na"`; `counts` sums to 10; `summary` and `suggestions` are present.
9. Prepare a second chapter of the same book. Its review starts blank; the assessor and
   benchmark are already filled in.
10. **Forget all IDEA reviews** → confirm. Both reviews, the assessor, and the benchmark reset.
    Reload: still empty.
11. Build the cartridge. Confirm no `idea-rubric1-*` file is inside it.
```

- [ ] **Step 8: Run the docs test and the full suite**

Run: `npx vitest run --project unit src/docs-claims.test.ts && npm run test && npm run typecheck`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add README.md PRIVACY.md THIRD-PARTY-NOTICES.md docs/IDEA.md docs/RELEASE-ACCEPTANCE.md src/docs-claims.test.ts
git commit -m "docs: state the IDEA phase's obligations, storage, attribution, and acceptance

Co-Authored-By: Claude <model name> <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (slice 1 = spec §8.1):**
- §2.1 `IdeaReview` per chapter with row-level ratings, notes, checklist, Summary, Suggestions; `IdeaHeader` once per session → Task 2.
- §2.1 "no code path writes the rating" → Task 2 reducer; only `CategoryPanel`'s radio dispatches `rate`; Task 3's restore replays stored `rate` events and drops anything that is not one.
- §2.5 export: Rubric 1 header, area/row/rating/notes table under Rubric 1's own titles, Category Count, Summary, Suggestions, checklist, JSON mirror, download-only, filename → Task 4; wired in Task 9; cartridge exclusion verified in the acceptance scenario (Task 11).
- §2.7 storage: IndexedDB through the app's `KeyValueStore`, debounced, validated on read, forget control, not cleared with derived output → Tasks 3, 7, 8, 9; disclosed in Task 11.
- §5.1 shell: `PhaseId 'idea'`, order, `ideaRated/ideaTotal`, never `done`, Plan ignores it, Plan shows the line → Tasks 5, 9.
- §5.2/§5.3 screen: eight panels, one open at a time, header with assessor/benchmark/export/forget, chapter switcher, the chapter render beside the panels, the argument string, attribution footer, live region → Tasks 6, 8.
- §5.3 WCAG 2.2 AA on the screen, forced-colours → Task 10.
- §7.2 data boundary and licensing in `docs/IDEA.md` + README + PRIVACY + notices → Task 11.
- §7.3 unit tests (framework, reducers, store, export, hook, panel, screen), browser tests, acceptance scenario → Tasks 1–4, 6–8, 10, 11.
- Not in slice 1 by design: findings, highlight-on-focus, Applied/Undo, model, images, `applyIdeaEdits`, attribution change note. Slice 2 plan — which must be updated for the `IdeaScreen` props this plan adds (`header`, `onHeaderEvent`, `onForget`) and for the hook's `forgetAll` replacing `reset`.

**Defects closed from the 2026-09-11 review:** PlanScreen test now renders a non-empty chapter list (Task 9); the target-size test no longer measures inline links (Task 10); the Framework text is quoted in full with the one editorial act recorded, and pinned by test (Task 1); the export carries Rubric 1's Category Count, Summary, and Suggestions (Tasks 2, 4). Also folded in because the same files were rewritten: the export menu became two buttons (Task 8); the benchmark field can be emptied (Tasks 2, 8); a one-row category's header reads "rated" (Task 6); the sidebar detail uses the shell's secondary-text palette (Task 5).

**Still open, deliberately (small, and not asked for):** no UI to clear a rating once set; a header click on the open panel does not collapse it; the typecheck is red between Tasks 5 and 9; the review key is source/book/title rather than an outline id.

**Placeholder scan:** none of "TBD/TODO/similar to/add validation" appear. Every code step shows the code.

**Type consistency:** `reviewKeyOf(chapter: Chapter)` used identically in Tasks 7, 8, 9; `onExport(key, format) => string` in Tasks 8, 9, 10; `IdeaReviewEvent` and `IdeaHeaderEvent` unions identical across Tasks 2, 3, 6, 7, 8; `useIdeaReviews(store?)` return shape identical in Tasks 7 and 9; `ideaSummary(rated, total)` in Tasks 5, 9; `ShellState.ideaRated/ideaTotal` in Tasks 5, 9; `rubric1Markdown(review, header, ctx)` / `rubric1Json(review, header, ctx)` in Tasks 4, 9; `ChapterView({ compiled, audit })` in Tasks 8 and 10; `RATING_LABEL` (engine) and `RATING_COPY` (component) deliberately separate — the export must not import component copy; both are asserted to the same four strings in Tasks 4 and 6.
