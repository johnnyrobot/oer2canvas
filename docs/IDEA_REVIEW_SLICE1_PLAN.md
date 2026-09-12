# IDEA Review — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the optional IDEA phase to oer2canvas with the Framework's eight categories as checklists, a human-only Rubric 1 rating per rubric row, notes, an editable BIPOC benchmark, assessor fields, and a Markdown + JSON Rubric 1 download — no findings, no model, no image search yet.

**Architecture:** A pure `(review, event) => review` reducer in `src/engine/idea/review.ts` holds every rule, with a thin React hook over it; the vendored Framework text lives in a typed constant module; a pure export module turns a review into Markdown and JSON; the shell gains a sixth `PhaseId` that is always reachable once chapters are prepared and never affects Plan. The screen is eight collapsible panels per chapter, rendered from the Framework constant, so adding findings in slice 2 is adding a zone inside a panel, not a new screen.

**Tech Stack:** TypeScript, React 19, Vite, Vitest 4 (jsdom `unit` project + Playwright `browser` and `browser-forced-colors` projects), Testing Library, axe-core, lucide-react, Tailwind.

**Spec:** `docs/IDEA_REVIEW_SPEC.md` (§2.1, §2.5, §2.6-excluded, §5, §7.3, §8 slice 1). One refinement to §2.1 is made by this plan and committed in Task 1: `CategoryReview.rating` becomes `ratings: ReadonlyMap<rowId, Rating>` because Rubric 1's category 7.1 has three rubric rows and the other seven have one; a category is "rated" when every one of its rows is.

## Global Constraints

- **The rating is never machine-written.** No code path outside a user event dispatches a `rate` event. (Spec §1, §2.1.)
- **IDEA never gates Plan.** `phaseAvailability(s).plan` must not read any IDEA field. (Spec §5.1.)
- **IDEA never reaches `done` on its own.** Its availability is `'available'` with a detail string, never `'done'`. (Spec §5.1.)
- **No network in tests.** `src/test/setup.ts` throws on any `fetch`; nothing in this slice fetches.
- **User-facing strings live in one constants object per component** (`src/components/idea/copy.ts`), quoted from the spec, never re-derived. (Spec §5.3.)
- **The Framework text is CC BY 4.0** and must be attributed in the panel footer and in `THIRD-PARTY-NOTICES.md`. (Spec §2.1, §7.2.)
- **Rubric 1 is download-only, never packaged into the cartridge.** (Spec §2.5.)
- **Every control clears 24×24** — use the shell's `min-h-9 min-w-9` pattern. **`aria-disabled`, never `disabled`**, on anything that carries a reason.
- **Tailwind classes follow the shell's palette** (`bg-white dark:bg-neutral-900`, `border-neutral-200 dark:border-neutral-800`, `text-brand-700 dark:text-brand-300`); no new colours.
- Copy for the one string that argues, verbatim: *"Rate what you observed, not what the tool counted. The counts and drafts are evidence; the judgment is yours."*
- Run `npm run typecheck` before every commit; the `build` script runs it and CI refuses type errors.
- Commit messages: imperative, lower-case type prefix (`feat:`, `test:`, `docs:`), ending with the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`. No session links of any kind.

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/engine/idea/framework.ts` | The vendored Framework: category ids, titles, restorative requirement, elements for consideration (stable ids), Rubric 1 rows, resource links. Pure data + two lookups. |
| `src/engine/idea/review.ts` | `IdeaReview` types, `newReview()`, `reduceReview()`, `isCategoryRated()`, `ratedCount()`. Pure. |
| `src/engine/idea/rubric-export.ts` | `rubric1Markdown()`, `rubric1Json()`, `rubric1Filename()`. Pure. |
| `src/engine/idea/download.ts` | `downloadTextFile()` — the same anchor-click pattern as `engine/export/download.ts`, for text. |
| `src/shell/phases.ts` | Add `'idea'` to `PhaseId`/`PHASE_ORDER`/`PHASE_LABEL`; `ShellState.ideaRated/ideaTotal`; `ideaSummary()`; availability with a `detail`. |
| `src/shell/AppShell.tsx` | Icon for the new phase; render `detail` on an available phase. |
| `src/shell/PlanScreen.tsx` | Show the IDEA summary line above the commit control. |
| `src/components/idea/copy.ts` | Every user-facing string on the IDEA screen. |
| `src/components/idea/CategoryPanel.tsx` | One category: restorative requirement, checklist, rubric rows, notes. |
| `src/components/idea/IdeaScreen.tsx` | Header (assessor, benchmark, export), chapter switcher, eight panels. |
| `src/components/idea/useIdeaReviews.ts` | Hook: a `Map<reviewKey, IdeaReview>` with `dispatch(key, event)` and `reset()`. |
| `src/App.tsx` | Mount the phase, derive shell counts, reset reviews with derived output, wire export. |
| `README.md`, `THIRD-PARTY-NOTICES.md`, `docs/IDEA.md`, `docs/RELEASE-ACCEPTANCE.md` | Obligations, attribution, data boundary, acceptance scenario. |

---

### Task 1: The vendored Framework module

**Files:**
- Create: `src/engine/idea/framework.ts`
- Test: `src/engine/idea/framework.test.ts`
- Modify: `docs/IDEA_REVIEW_SPEC.md` (§2.1 refinement, see Global Constraints)

**Interfaces:**
- Produces:
  ```ts
  export type CategoryId = '7.1' | '7.2' | '7.3' | '7.4' | '7.5' | '7.6' | '7.7' | '7.8'
  export const IDEA_CATEGORY_IDS: readonly CategoryId[]
  export interface FrameworkElement { id: string; text: string }         // id like '7.6.3'
  export interface RubricRow { id: string; exclusive: string; emerging: string; inclusive: string }  // id like '7.1.a'
  export interface FrameworkResource { label: string; url: string }
  export interface IdeaCategory {
    id: CategoryId; title: string; restorative: string
    elements: readonly FrameworkElement[]; rows: readonly RubricRow[]; resources: readonly FrameworkResource[]
  }
  export const IDEA_FRAMEWORK: readonly IdeaCategory[]
  export const FRAMEWORK_ATTRIBUTION: { title: string; author: string; url: string; license: { name: string; url: string } }
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

test('no category is empty of guidance', () => {
  for (const c of IDEA_FRAMEWORK) {
    expect(c.title, c.id).not.toBe('')
    expect(c.restorative.length, c.id).toBeGreaterThan(80)
    expect(c.elements.length, c.id).toBeGreaterThanOrEqual(3)
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

`src/engine/idea/framework.ts`:
```ts
/**
 * The ASCCC OERI IDEA Framework, vendored.
 *
 * Text is quoted from the "ASCCC OERI Inclusion, Diversity, Equity, and
 * Anti-Racism (IDEA) Framework and Implementation Guide, March 2025", which is
 * licensed CC BY 4.0. Every screen that shows this text shows
 * `FRAMEWORK_ATTRIBUTION` beside it; THIRD-PARTY-NOTICES.md carries it too.
 *
 * Ids are STABLE and are what the review map keys on. Renumbering an element
 * is a data migration, not an edit: a saved checklist answer for '7.6.3' must
 * still mean "insert context, attribution, or quotations for historical
 * references" next year. Append; never renumber.
 *
 * Rubric rows come from Appendix A (Rubric 1). Category 7.1 has three rows
 * there; every other category has one. That asymmetry is the document's and
 * is preserved rather than flattened, because an assessor filling in Rubric 1
 * by hand answers all three.
 */
export type CategoryId = '7.1' | '7.2' | '7.3' | '7.4' | '7.5' | '7.6' | '7.7' | '7.8'

export interface FrameworkElement {
  /** `<category>.<n>`, e.g. `7.6.3`. */
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
  title: string
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

const NA_NOTE = 'This category does not apply to this resource. Explain in notes.'
export const RUBRIC_NA_TEXT = NA_NOTE

export const IDEA_FRAMEWORK: readonly IdeaCategory[] = [
  {
    id: '7.1',
    title: 'Illustrations and Photos',
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
      { id: '7.1.a', exclusive: 'Less than 30% of photos and illustrations include BIPOC', emerging: '30–70% of photos and illustrations include BIPOC', inclusive: 'More than 70% of photos and illustrations include BIPOC' },
      { id: '7.1.b', exclusive: 'Very few to no examples of diversity beyond race and ethnicity.', emerging: '1–2 examples of diversity beyond race and ethnicity.', inclusive: 'More than 2 examples of diversity beyond race and ethnicity.' },
      { id: '7.1.c', exclusive: 'Many examples of illustrations and photos that are not culturally sensitive or appropriate. Include examples in notes.', emerging: 'Some examples of illustrations and photos that are not culturally sensitive or appropriate. Include examples in notes.', inclusive: 'Very few to no examples of illustrations and photos that are not culturally sensitive or appropriate. Include examples in notes.' },
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
      { id: '7.2.a', exclusive: 'Less than 30% of names reflect BIPOC culture', emerging: '30–70% of names reflect BIPOC culture', inclusive: 'More than 70% of names reflect BIPOC culture' },
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
    restorative:
      'Gender inclusivity is important because all students should be able to see themselves represented. Gender inclusive language can refer to the use of gender-neutral pronouns or language that intentionally dispels gender stereotypes.',
    elements: [
      { id: '7.3.1', text: 'Pay attention to connotations and make sure that gender stereotypes are not perpetuated. If in doubt, ask for another opinion.' },
      { id: '7.3.2', text: 'Use pronouns clearly. If using traditionally plural pronouns (such as them or they) confuses the context, change the wording to reflect the situation clearly.' },
      { id: '7.3.3', text: 'Explicitly state what pronouns an individual uses, if appropriate.' },
      { id: '7.3.4', text: 'Consider reducing the use of pronouns and rewriting sentences to eliminate pronouns.' },
      { id: '7.3.5', text: "Avoid making assumptions about an individual's gender." },
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
    restorative:
      'Referencing discipline contributors—e.g., researchers, scholars, academics—with backgrounds like those of students both validates and affirms the students as student-scholars and invites them into the academic conversation. Recognize that all people carry around biases that affect what they include and exclude. Counteract these biases by actively seeking out achievements and discipline contributions from all cultures and countries. Note that diversity may not be perceptible in some of the references. Consider the use of open-source articles and diversify research by using diverse resources.',
    elements: [
      { id: '7.4.1', text: 'Examine the diversity of included contributors in the discipline. If diversity is lacking, seek diversity in the contributions mentioned.' },
      { id: '7.4.2', text: 'If the contributions are dominated by cis-hetero white men, discuss this with the class and include some of the historical and structural explanations for the lack of diversity, i.e., lack of educational opportunities for minoritized groups.' },
      { id: '7.4.3', text: 'Include current, more diverse contributors when possible and relevant where historical contributors are not diverse. Keep in mind that your goal is to ensure the inclusion of forgotten perspectives.' },
      { id: '7.4.4', text: 'Avoid isolating diverse contributors to specific sections, e.g., "multicultural impacts on psychology."' },
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
    restorative:
      'When using real-world examples, one should include diverse and relatable examples for students and avoid stereotypes. This should be done on a chapter or section basis in the resource as well as holistically. Examples that rely on cultural knowledge will not be understandable by everyone and should be appropriately explained.',
    elements: [
      { id: '7.5.1', text: 'Review, and potentially have students review, problems and exercises, giving special consideration to their context and inclusivity.' },
      { id: '7.5.2', text: 'Analyze terminology, contexts, and situations presented in problems and applications to ensure that they are comprehensible by all populations.' },
      { id: '7.5.3', text: 'Write and use examples that include diverse people, organizations, geographies, and situations.' },
      { id: '7.5.4', text: 'Avoid negative stereotypes or sensitive subjects in problems and applications unless the subject matter demands it.' },
      { id: '7.5.5', text: 'Be mindful when creating exercises that require specific knowledge, context, or frame of reference.' },
      { id: '7.5.6', text: 'Examine and adjust assumptions and expectations about prior knowledge, especially regarding knowledge from different subjects or cultural contexts. Even very common cultural elements such as Harry Potter, Disney, or popular game shows are not universal.' },
    ],
    rows: [
      { id: '7.5.a', exclusive: 'Very few to no examples of applications, examples and scenarios reflect BIPOC culture', emerging: 'Some examples of applications, examples and scenarios reflect BIPOC culture', inclusive: 'Many examples of applications, examples and scenarios reflect BIPOC culture' },
    ],
    resources: [],
  },
  {
    id: '7.6',
    title: 'Appropriate Terminology',
    restorative:
      'References to people, groups, populations, categories, conditions, and disabilities should use appropriate verbiage and not contain derogatory, colloquial, inappropriate, or otherwise incorrect language. For historical uses that must remain in place, consider adding context, such as "a widely-used term at the time." Ensure that quotations or paraphrases using outdated terms are attributed, contextualized, and limited. As language is not static, it is important to keep in mind that what terms are deemed "acceptable" is ever-changing.',
    elements: [
      { id: '7.6.1', text: 'Identify any outmoded or incorrect terminology and replace or reframe the terminology.' },
      { id: '7.6.2', text: 'Insert context, attribution, or quotations for historical references as needed.' },
      { id: '7.6.3', text: 'Identify and use the best terminology at the time. Consult style guides as necessary; note they may conflict. Do not feel obligated to use the latest term if it is not widely used or is controversial.' },
      { id: '7.6.4', text: 'Define outmoded terminology in historical situations—e.g., court cases, laws, or articles—using quotations or annotated with contextual information.' },
      { id: '7.6.5', text: 'Avoid ableist language. This includes using words like "psycho" and "crazy" or phrases like "blind spot" or "falling on deaf ears".' },
      { id: '7.6.6', text: 'Avoid or limit idioms or colloquialisms that may lead to misconceptions among those who natively speak other languages or who may not have the educational or cultural context to understand them. Clarify the context and use of common idioms when they appear.' },
    ],
    rows: [
      { id: '7.6.a', exclusive: 'Many examples of terminology that is derogatory or inappropriate. Include examples in notes.', emerging: 'Some examples of terminology that is derogatory or inappropriate. Include examples in notes.', inclusive: 'Very few to no examples of terminology that is derogatory or inappropriate. Include examples in notes.' },
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
    title: 'Keyword, Glossary, and Other Types of Metadata Representation',
    restorative:
      "Quite often textbooks include metadata sections like chapter outlines/summaries, key takeaways, keywords, glossaries, indexes, etc. What's included in these sections signal high priority to students, and, as such, one should ensure that diverse topics, scholars, perspectives and terms are appropriately represented in these sections.",
    elements: [
      { id: '7.7.1', text: 'Analyze keyword lists and glossaries and identify core terms that reflect diverse scholars and perspectives that are not represented or highlighted.' },
      { id: '7.7.2', text: "Assess whether software is negatively impacting the resource's index. Book indexes are usually not fully representative of book content; they are often built by software, and search capabilities do not always lend themselves to inclusivity." },
      { id: '7.7.3', text: 'Add keywords, perspectives and key takeaways that specifically highlight issues important to underrepresented groups.' },
    ],
    rows: [
      { id: '7.7.a', exclusive: 'Very few to no examples of keywords or glossary terms reflect diverse topics and/or folks', emerging: 'Some examples of keywords or glossary terms reflect diverse topics and/or folks', inclusive: 'Many examples of keywords or glossary terms reflect diverse topics and/or folks' },
    ],
    resources: [],
  },
  {
    id: '7.8',
    title: 'Incorporating Diverse Perspectives on Issues, Events, and Concepts',
    restorative:
      'Diverse populations experience issues such as social problems, health, politics, business practices, and economic conditions that may differ from the mainstream. Purposefully incorporating perspectives from populations that are commonly not included allows for how—and why—perspectives may vary to be examined.',
    elements: [
      { id: '7.8.1', text: 'Include diverse perspectives when presenting controversies, arguments, and opinions for each topic or concept covered. Do not avoid the inclusion of a perspective due to the discomfort it might create.' },
      { id: '7.8.2', text: 'Do not stigmatize individuals having a specific condition, occupation, experience, or background.' },
      { id: '7.8.3', text: 'Be aware that certain controversial topics, when necessary to include, should be described in an academic manner that recognizes the existing controversy and provides an analysis of the relevant facts or data.' },
      { id: '7.8.4', text: 'If a discipline has accepted a specific position on a topic, describe that position. Consider alternative points of view in relation to the discipline-adopted position and explain the rationale for the position.' },
      { id: '7.8.5', text: 'If a sociopolitical issue without a consensus must be described, include a balanced viewpoint by providing differing perspectives on the issue.' },
      { id: '7.8.6', text: 'Avoid characterizations that lead to generalization. If a generalization must be stated, provide a reference to support it and additional context for understanding, and include any counterpoints from within that generalization.' },
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
Expected: PASS (5 tests).

- [ ] **Step 5: Record the §2.1 refinement in the spec**

In `docs/IDEA_REVIEW_SPEC.md` §2.1, replace the `CategoryReview` block with:
```ts
interface CategoryReview {
  ratings: ReadonlyMap<string, Rating>              // by Rubric 1 row id ('7.1.a', '7.1.b', '7.1.c', '7.2.a', …); human-set only
  notes: string
  checklist: ReadonlyMap<string, ChecklistAnswer>   // keyed by stable bullet id, e.g. '7.6.3'
}
```
and add the sentence after the code block: *"Rubric 1 gives category 7.1 three rows and every other category one; a category is rated when every one of its rows is."*

- [ ] **Step 6: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/idea/framework.ts src/engine/idea/framework.test.ts docs/IDEA_REVIEW_SPEC.md
git commit -m "feat: vendor the IDEA Framework as typed data

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: The review reducer

**Files:**
- Create: `src/engine/idea/review.ts`
- Test: `src/engine/idea/review.test.ts`

**Interfaces:**
- Consumes: `CategoryId`, `IDEA_CATEGORY_IDS`, `categoryById` from Task 1.
- Produces:
  ```ts
  export type Rating = 'na' | 'exclusive' | 'emerging' | 'inclusive'
  export type ChecklistAnswer = 'yes' | 'no' | 'unsure' | 'skip'
  export interface Assessor { name: string; title: string; college: string }
  export interface CategoryReview { ratings: ReadonlyMap<string, Rating>; notes: string; checklist: ReadonlyMap<string, ChecklistAnswer> }
  export interface IdeaReview { categories: Readonly<Record<CategoryId, CategoryReview>>; benchmark: { bipocPercent: number }; assessor: Assessor }
  export const DEFAULT_BIPOC_PERCENT = 77
  export type IdeaReviewEvent =
    | { type: 'rate'; categoryId: CategoryId; rowId: string; rating: Rating }
    | { type: 'clear-rating'; categoryId: CategoryId; rowId: string }
    | { type: 'note'; categoryId: CategoryId; notes: string }
    | { type: 'check'; categoryId: CategoryId; elementId: string; answer: ChecklistAnswer }
    | { type: 'benchmark'; bipocPercent: number }
    | { type: 'assessor'; assessor: Partial<Assessor> }
  export function newReview(): IdeaReview
  export function reduceReview(review: IdeaReview, event: IdeaReviewEvent): IdeaReview
  export function isCategoryRated(review: IdeaReview, id: CategoryId): boolean
  export function ratedCount(review: IdeaReview): number
  ```

- [ ] **Step 1: Write the failing test**

`src/engine/idea/review.test.ts`:
```ts
import {
  DEFAULT_BIPOC_PERCENT, isCategoryRated, newReview, ratedCount, reduceReview, type IdeaReview,
} from './review'
import { IDEA_CATEGORY_IDS } from './framework'

test('a new review has every category, nothing rated, the 77% benchmark, and an empty assessor', () => {
  const r = newReview()
  expect(Object.keys(r.categories)).toEqual(IDEA_CATEGORY_IDS)
  for (const id of IDEA_CATEGORY_IDS) {
    expect(r.categories[id].ratings.size).toBe(0)
    expect(r.categories[id].notes).toBe('')
    expect(r.categories[id].checklist.size).toBe(0)
  }
  expect(r.benchmark.bipocPercent).toBe(DEFAULT_BIPOC_PERCENT)
  expect(r.assessor).toEqual({ name: '', title: '', college: '' })
  expect(ratedCount(r)).toBe(0)
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

// Framework §9.0: colleges may adjust the standard to their own demographics.
test('the benchmark is editable and clamped to a percentage', () => {
  expect(reduceReview(newReview(), { type: 'benchmark', bipocPercent: 62 }).benchmark.bipocPercent).toBe(62)
  expect(reduceReview(newReview(), { type: 'benchmark', bipocPercent: 140 }).benchmark.bipocPercent).toBe(100)
  expect(reduceReview(newReview(), { type: 'benchmark', bipocPercent: -3 }).benchmark.bipocPercent).toBe(0)
  expect(reduceReview(newReview(), { type: 'benchmark', bipocPercent: Number.NaN }).benchmark.bipocPercent).toBe(DEFAULT_BIPOC_PERCENT)
})

test('assessor fields merge', () => {
  let r = reduceReview(newReview(), { type: 'assessor', assessor: { name: 'A. Lee' } })
  r = reduceReview(r, { type: 'assessor', assessor: { college: 'Foothill College' } })
  expect(r.assessor).toEqual({ name: 'A. Lee', title: '', college: 'Foothill College' })
})

test('the reducer never mutates its input', () => {
  const before: IdeaReview = newReview()
  const snapshot = JSON.stringify(before, (_k, v) => (v instanceof Map ? [...v] : v))
  reduceReview(before, { type: 'rate', categoryId: '7.3', rowId: '7.3.a', rating: 'inclusive' })
  reduceReview(before, { type: 'note', categoryId: '7.3', notes: 'x' })
  expect(JSON.stringify(before, (_k, v) => (v instanceof Map ? [...v] : v))).toBe(snapshot)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project unit src/engine/idea/review.test.ts`
Expected: FAIL — `Cannot find module './review'`.

- [ ] **Step 3: Write the reducer**

`src/engine/idea/review.ts`:
```ts
/**
 * The IDEA review: what the HUMAN decided about a chapter.
 *
 * A pure `(review, event) => review`, for the same reason `session.ts` is one:
 * every rule in this screen is testable with nothing rendered. The hook in
 * `useIdeaReviews.ts` is plumbing over this.
 *
 * THE RATING IS NEVER MACHINE-WRITTEN. The only way a `Rating` enters this
 * structure is a `rate` event, and the only thing that dispatches one is a
 * radio the instructor clicked. Slice 4's model draft renders BESIDE the
 * rating column and has no path to it — the spec's one deliberate friction.
 *
 * Rows and elements are validated against the Framework: an event naming a
 * row that is not in its category is dropped. Not an error — a stale id from
 * a renumbered Framework should degrade to "nothing recorded", not crash the
 * screen — but never stored, because the export keys on these ids.
 */
import { IDEA_CATEGORY_IDS, categoryById, type CategoryId } from './framework'

export type Rating = 'na' | 'exclusive' | 'emerging' | 'inclusive'
export type ChecklistAnswer = 'yes' | 'no' | 'unsure' | 'skip'

export interface Assessor {
  name: string
  title: string
  college: string
}

export interface CategoryReview {
  /** By Rubric 1 row id. A category is rated when every one of its rows is. */
  ratings: ReadonlyMap<string, Rating>
  notes: string
  /** By Framework element id. */
  checklist: ReadonlyMap<string, ChecklistAnswer>
}

export interface IdeaReview {
  categories: Readonly<Record<CategoryId, CategoryReview>>
  /** Framework §9.0: 77% by default (CCCCO Data Mart, Fall 2022), adjustable per college. */
  benchmark: { bipocPercent: number }
  assessor: Assessor
}

export const DEFAULT_BIPOC_PERCENT = 77

export type IdeaReviewEvent =
  | { type: 'rate'; categoryId: CategoryId; rowId: string; rating: Rating }
  | { type: 'clear-rating'; categoryId: CategoryId; rowId: string }
  | { type: 'note'; categoryId: CategoryId; notes: string }
  | { type: 'check'; categoryId: CategoryId; elementId: string; answer: ChecklistAnswer }
  | { type: 'benchmark'; bipocPercent: number }
  | { type: 'assessor'; assessor: Partial<Assessor> }

const emptyCategory = (): CategoryReview => ({ ratings: new Map(), notes: '', checklist: new Map() })

export function newReview(): IdeaReview {
  const categories = {} as Record<CategoryId, CategoryReview>
  for (const id of IDEA_CATEGORY_IDS) categories[id] = emptyCategory()
  return {
    categories,
    benchmark: { bipocPercent: DEFAULT_BIPOC_PERCENT },
    assessor: { name: '', title: '', college: '' },
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
    case 'benchmark': {
      const n = event.bipocPercent
      const bipocPercent = Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : DEFAULT_BIPOC_PERCENT
      return { ...review, benchmark: { bipocPercent } }
    }
    case 'assessor':
      return { ...review, assessor: { ...review.assessor, ...event.assessor } }
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project unit src/engine/idea/review.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Typecheck and commit**

```bash
npm run typecheck
git add src/engine/idea/review.ts src/engine/idea/review.test.ts
git commit -m "feat: the IDEA review reducer, with the rating human-only by construction

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Rubric 1 export (Markdown, JSON, filename) and the text download

**Files:**
- Create: `src/engine/idea/rubric-export.ts`
- Create: `src/engine/idea/download.ts`
- Test: `src/engine/idea/rubric-export.test.ts`

**Interfaces:**
- Consumes: `IdeaReview`, `Rating`, `ChecklistAnswer` (Task 2); `IDEA_FRAMEWORK`, `FRAMEWORK_ATTRIBUTION`, `RUBRIC_NA_TEXT` (Task 1).
- Produces:
  ```ts
  export interface Rubric1Context { bookTitle: string; chapterTitle: string; publisher?: string; sourceUrl?: string; exportedAt: Date }
  export interface Rubric1Json { /* shape below */ }
  export const RATING_LABEL: Readonly<Record<Rating, string>>   // 'Not Applicable' | 'Exclusive' | 'Emerging Inclusive' | 'Inclusive'
  export function rubric1Markdown(review: IdeaReview, ctx: Rubric1Context): string
  export function rubric1Json(review: IdeaReview, ctx: Rubric1Context): Rubric1Json
  export function rubric1Filename(chapterTitle: string, now: Date, ext: 'md' | 'json'): string
  export function downloadTextFile(name: string, text: string, mime: string): void   // download.ts
  ```

- [ ] **Step 1: Write the failing test**

`src/engine/idea/rubric-export.test.ts`:
```ts
import { newReview, reduceReview } from './review'
import { RATING_LABEL, rubric1Filename, rubric1Json, rubric1Markdown, type Rubric1Context } from './rubric-export'

const ctx: Rubric1Context = {
  bookTitle: 'Human Biology',
  chapterTitle: '4: Nutrition',
  publisher: 'LibreTexts',
  sourceUrl: 'https://bio.libretexts.org/x',
  exportedAt: new Date('2026-09-11T17:30:00Z'),
}

function sample() {
  let r = newReview()
  r = reduceReview(r, { type: 'assessor', assessor: { name: 'A. Lee', title: 'Instructor', college: 'Foothill College' } })
  r = reduceReview(r, { type: 'benchmark', bipocPercent: 62 })
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.a', rating: 'emerging' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.b', rating: 'exclusive' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.1', rowId: '7.1.c', rating: 'inclusive' })
  r = reduceReview(r, { type: 'rate', categoryId: '7.6', rowId: '7.6.a', rating: 'na' })
  r = reduceReview(r, { type: 'note', categoryId: '7.6', notes: 'No people are named | in this chapter.' })
  r = reduceReview(r, { type: 'check', categoryId: '7.6', elementId: '7.6.5', answer: 'yes' })
  return r
}

test('the Markdown carries the header, one row per rubric row, notes, and the Framework attribution', () => {
  const md = rubric1Markdown(sample(), ctx)
  expect(md).toContain('# IDEA Framework — Rubric 1')
  expect(md).toContain('**Textbook/Publisher:** Human Biology (LibreTexts)')
  expect(md).toContain('**Chapter:** 4: Nutrition')
  expect(md).toContain('**Assessor:** A. Lee, Instructor, Foothill College')
  expect(md).toContain('**BIPOC benchmark used:** 62%')
  expect(md).toContain('| 7.1 Illustrations and Photos |')
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
  expect(md).toContain('CC BY 4.0')
  expect(md).toContain('asccc-oeri.org')
})

test('the JSON mirrors the table and is stable in shape', () => {
  const j = rubric1Json(sample(), ctx)
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
  expect(first.rows.map((r) => r.rating)).toEqual(['emerging', 'exclusive', 'inclusive'])
  expect(first.rows[0].label).toBe(RATING_LABEL.emerging)
  const terms = j.areas.find((a) => a.id === '7.6')!
  expect(terms.notes).toBe('No people are named | in this chapter.')
  expect(terms.checklist).toEqual([{ id: '7.6.5', answer: 'yes' }])
  expect(j.areas.find((a) => a.id === '7.2')!.rows[0].rating).toBeNull()
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
 * Markdown for reading, JSON for machines; both carry the same table in the
 * same order — area, rating, notes — which is the shape OERI's own Gen-AI
 * crosswalk guide uses for a Rubric 1 review, so a future OERI submission form
 * has something it can consume.
 *
 * DOWNLOAD ONLY. Nothing here is ever packaged into the cartridge: the rubric
 * is about the material, not for the students who will read it.
 */
import { FRAMEWORK_ATTRIBUTION, IDEA_FRAMEWORK } from './framework'
import type { ChecklistAnswer, IdeaReview, Rating } from './review'

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
}

export function rubric1Json(review: IdeaReview, ctx: Rubric1Context): Rubric1Json {
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
    assessor: { ...review.assessor },
    benchmark: { ...review.benchmark },
    exportedAt: ctx.exportedAt.toISOString(),
    areas: IDEA_FRAMEWORK.map((c) => {
      const r = review.categories[c.id]
      return {
        id: c.id,
        title: c.title,
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
  }
}

/** A cell must not carry a bare pipe or a newline, or the table falls apart. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()

export function rubric1Markdown(review: IdeaReview, ctx: Rubric1Context): string {
  const j = rubric1Json(review, ctx)
  const lines: string[] = []
  lines.push('# IDEA Framework — Rubric 1')
  lines.push('')
  lines.push(`**Textbook/Publisher:** ${cell(ctx.bookTitle)}${ctx.publisher ? ` (${cell(ctx.publisher)})` : ''}`)
  if (ctx.sourceUrl) lines.push(`**Source:** ${ctx.sourceUrl}`)
  lines.push(`**Chapter:** ${cell(ctx.chapterTitle)}`)
  const a = review.assessor
  const who = [a.name, a.title, a.college].map((s) => s.trim()).filter(Boolean).join(', ')
  lines.push(`**Assessor:** ${who || '—'}`)
  lines.push(`**BIPOC benchmark used:** ${review.benchmark.bipocPercent}%`)
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
      'Ratings, notes, and checklist answers were entered by the assessor named above; none were produced by software.',
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
git commit -m "feat: export Rubric 1 as Markdown and JSON

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The sixth phase in the shell

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
        <span className="ml-auto hidden truncate text-xs text-neutral-500 md:inline dark:text-neutral-400">
          <span className="sr-only">, </span>
          {availability.detail}
        </span>
      )}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/shell/`
Expected: PASS. If `screens.test.tsx` or `PlanScreen.test.tsx` construct a `ShellState` literal, add `ideaRated: 0, ideaTotal: 0` to them; `App.test.tsx` uses `App`, which Task 7 updates.

- [ ] **Step 6: Typecheck; fix every `ShellState` literal the compiler names**

Run: `npm run typecheck`
Expected: errors only in `src/App.tsx` (`ideaRated` missing) — Task 7 fixes that. If the error list is longer, add the two fields where named. Do NOT stub them in `App.tsx` yet; leave that to Task 7 so the count is derived there, never hard-coded.

- [ ] **Step 7: Commit**

```bash
git add src/shell/phases.ts src/shell/phases.test.ts src/shell/AppShell.tsx src/shell/AppShell.test.tsx
git commit -m "feat: an optional IDEA phase in the sidebar that never gates Plan

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

(The typecheck is red between this commit and Task 7's. That is acceptable for two commits on a feature branch; do not push between them.)

---

### Task 5: Copy and the category panel

**Files:**
- Create: `src/components/idea/copy.ts`
- Create: `src/components/idea/CategoryPanel.tsx`
- Test: `src/components/idea/CategoryPanel.test.tsx`

**Interfaces:**
- Consumes: `IdeaCategory`, `FRAMEWORK_ATTRIBUTION`, `RUBRIC_NA_TEXT` (Task 1); `CategoryReview`, `IdeaReviewEvent`, `Rating`, `ChecklistAnswer` (Task 2); `RATING_LABEL` (Task 3).
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

function renderPanel(id: '7.1' | '7.6' = '7.6', open = true) {
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
  ratedSummary: (rated: number, total: number) => (rated === 0 ? 'not rated' : `${rated} of ${total} rows rated`),
  assessor: {
    legend: 'Assessor',
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
  export: {
    button: 'Export Rubric 1',
    markdown: 'Markdown (.md)',
    json: 'JSON (.json)',
    done: (name: string) => `Downloaded ${name}.`,
  },
  chapterSwitcher: 'Chapter under review',
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
Expected: PASS (10 tests). If the radio-name assertions fail because the accessible name concatenates both spans, the regexes are anchored on the label (`/^Emerging Inclusive/`) — keep the label span first inside the `<span>`.

- [ ] **Step 6: Typecheck (App.tsx error from Task 4 still expected) and commit**

```bash
npm run typecheck
git add src/components/idea/copy.ts src/components/idea/CategoryPanel.tsx src/components/idea/CategoryPanel.test.tsx
git commit -m "feat: one IDEA category as checklist, Rubric 1 rows, and notes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: The IDEA screen and the reviews hook

**Files:**
- Create: `src/components/idea/useIdeaReviews.ts`
- Create: `src/components/idea/IdeaScreen.tsx`
- Test: `src/components/idea/useIdeaReviews.test.ts`, `src/components/idea/IdeaScreen.test.tsx`

**Interfaces:**
- Consumes: `CategoryPanel`, `IDEA_COPY` (Task 5); `IdeaReview`, `IdeaReviewEvent`, `newReview`, `reduceReview`, `ratedCount` (Task 2); `IDEA_FRAMEWORK`, `FRAMEWORK_ATTRIBUTION`, `IDEA_CATEGORY_IDS` (Task 1); `CompiledChapter` from `src/contracts/index`; `Chapter` from `src/sources/types`.
- Produces:
  ```ts
  export function reviewKeyOf(chapter: Chapter): string          // `${source}::${bookId}::${title}`
  export function useIdeaReviews(): {
    reviews: ReadonlyMap<string, IdeaReview>
    reviewFor: (key: string) => IdeaReview                        // newReview() when absent
    dispatch: (key: string, event: IdeaReviewEvent) => void
    reset: () => void
  }
  export function IdeaScreen(props: {
    chapters: readonly CompiledChapter[]
    reviews: ReadonlyMap<string, IdeaReview>
    onEvent: (key: string, event: IdeaReviewEvent) => void
    onExport: (key: string, format: 'md' | 'json') => string     // returns the filename it produced
  }): JSX.Element
  ```

- [ ] **Step 1: Write the failing hook test**

`src/components/idea/useIdeaReviews.test.ts`:
```ts
import { act, renderHook } from '@testing-library/react'
import { reviewKeyOf, useIdeaReviews } from './useIdeaReviews'
import type { Chapter } from '../../sources/types'

const chapter = (title: string): Chapter => ({
  source: 'openstax',
  bookId: 'book-1',
  title,
  sections: [],
  attribution: { bookTitle: 'B', publisher: 'P', authors: [] },
  xrefs: new Map(),
})

test('the key is stable for a chapter and distinct across chapters', () => {
  expect(reviewKeyOf(chapter('4: Nutrition'))).toBe(reviewKeyOf(chapter('4: Nutrition')))
  expect(reviewKeyOf(chapter('4: Nutrition'))).not.toBe(reviewKeyOf(chapter('5: Digestion')))
})

test('a review is created on first dispatch and kept per key', () => {
  const { result } = renderHook(() => useIdeaReviews())
  const k = reviewKeyOf(chapter('4: Nutrition'))
  expect(result.current.reviews.size).toBe(0)
  expect(result.current.reviewFor(k).benchmark.bipocPercent).toBe(77)
  act(() => result.current.dispatch(k, { type: 'rate', categoryId: '7.2', rowId: '7.2.a', rating: 'inclusive' }))
  expect(result.current.reviews.get(k)?.categories['7.2'].ratings.get('7.2.a')).toBe('inclusive')
  act(() => result.current.dispatch(reviewKeyOf(chapter('5: Digestion')), { type: 'note', categoryId: '7.1', notes: 'x' }))
  expect(result.current.reviews.size).toBe(2)
  expect(result.current.reviews.get(k)?.categories['7.1'].notes).toBe('')
})

test('reset empties every review', () => {
  const { result } = renderHook(() => useIdeaReviews())
  act(() => result.current.dispatch('a', { type: 'benchmark', bipocPercent: 50 }))
  act(() => result.current.reset())
  expect(result.current.reviews.size).toBe(0)
})
```

- [ ] **Step 2: Write the failing screen test**

`src/components/idea/IdeaScreen.test.tsx`:
```tsx
import { fireEvent, render, screen, within } from '@testing-library/react'
import { IdeaScreen } from './IdeaScreen'
import { reviewKeyOf } from './useIdeaReviews'
import { newReview, reduceReview, type IdeaReview, type IdeaReviewEvent } from '../../engine/idea/review'
import type { CompiledChapter } from '../../contracts/index'
import type { Chapter } from '../../sources/types'

const chapter = (title: string): Chapter => ({
  source: 'openstax',
  bookId: 'book-1',
  title,
  sections: [],
  attribution: { bookTitle: 'Human Biology', publisher: 'LibreTexts', authors: [] },
  xrefs: new Map(),
})
const compiled = (title: string): CompiledChapter => ({ chapter: chapter(title), sections: [], queue: [] })

function renderScreen(chapters = [compiled('4: Nutrition'), compiled('5: Digestion')], reviews = new Map<string, IdeaReview>()) {
  const onEvent = vi.fn<(key: string, e: IdeaReviewEvent) => void>()
  const onExport = vi.fn<(key: string, f: 'md' | 'json') => string>().mockReturnValue('idea-rubric1-x.md')
  render(<IdeaScreen chapters={chapters} reviews={reviews} onEvent={onEvent} onExport={onExport} />)
  return { onEvent, onExport }
}

test('with nothing prepared it says so', () => {
  renderScreen([])
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

test('the chapter switcher changes which review the panels show', () => {
  const k5 = reviewKeyOf(chapter('5: Digestion'))
  const reviews = new Map([[k5, reduceReview(newReview(), { type: 'note', categoryId: '7.1', notes: 'digestion note' })]])
  renderScreen(undefined, reviews)
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('')
  fireEvent.change(screen.getByRole('combobox', { name: 'Chapter under review' }), { target: { value: '1' } })
  expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('digestion note')
})

test('events are dispatched with the current chapter key', () => {
  const { onEvent } = renderScreen()
  fireEvent.change(screen.getByRole('textbox', { name: 'Notes' }), { target: { value: 'hi' } })
  expect(onEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'note', categoryId: '7.1', notes: 'hi' })
})

test('assessor and benchmark fields dispatch to the current chapter', () => {
  const { onEvent } = renderScreen()
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'A. Lee' } })
  expect(onEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'assessor', assessor: { name: 'A. Lee' } })
  fireEvent.change(screen.getByRole('spinbutton', { name: 'BIPOC benchmark' }), { target: { value: '62' } })
  expect(onEvent).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), { type: 'benchmark', bipocPercent: 62 })
})

test('export offers Markdown and JSON and announces the file it produced', () => {
  const { onExport } = renderScreen()
  fireEvent.click(screen.getByRole('button', { name: 'Export Rubric 1' }))
  const menu = screen.getByRole('menu')
  fireEvent.click(within(menu).getByRole('menuitem', { name: 'JSON (.json)' }))
  expect(onExport).toHaveBeenCalledWith(reviewKeyOf(chapter('4: Nutrition')), 'json')
  expect(screen.getByRole('status')).toHaveTextContent('Downloaded idea-rubric1-x.md.')
})

test('the Framework is attributed on screen', () => {
  renderScreen()
  expect(screen.getByText(/Framework text from "ASCCC OERI Inclusion, Diversity, Equity, and Anti-Racism \(IDEA\) Framework/)).toBeInTheDocument()
  expect(screen.getByText(/licensed CC BY 4\.0/)).toBeInTheDocument()
})
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run --project unit src/components/idea/`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write the hook**

`src/components/idea/useIdeaReviews.ts`:
```ts
/**
 * A React shell over `reduceReview`, one review per prepared chapter.
 *
 * Plumbing, deliberately: every rule lives in `engine/idea/review.ts`. This
 * owns only the map from chapter to review and the two things a pure function
 * cannot — creating a review the first time a chapter is touched, and
 * throwing all of them away when the prepared output is cleared.
 */
import { useCallback, useState } from 'react'
import type { Chapter } from '../../sources/types'
import { newReview, reduceReview, type IdeaReview, type IdeaReviewEvent } from '../../engine/idea/review'

/**
 * Source + book + title, because a chapter's identity here must survive a
 * recompile (which replaces the `CompiledChapter` object) and must NOT survive
 * choosing a different book that happens to have a chapter of the same name.
 */
export function reviewKeyOf(chapter: Chapter): string {
  return `${chapter.source}::${chapter.bookId}::${chapter.title}`
}

export function useIdeaReviews() {
  const [reviews, setReviews] = useState<ReadonlyMap<string, IdeaReview>>(new Map())

  const reviewFor = useCallback((key: string) => reviews.get(key) ?? newReview(), [reviews])

  const dispatch = useCallback((key: string, event: IdeaReviewEvent) => {
    setReviews((current) => {
      const next = new Map(current)
      next.set(key, reduceReview(current.get(key) ?? newReview(), event))
      return next
    })
  }, [])

  const reset = useCallback(() => setReviews(new Map()), [])

  return { reviews, reviewFor, dispatch, reset }
}
```

- [ ] **Step 5: Write the screen**

`src/components/idea/IdeaScreen.tsx`:
```tsx
/**
 * The IDEA phase: one chapter at a time, eight category panels, a header that
 * carries what Rubric 1's own header carries (assessor, benchmark), and the
 * export.
 *
 * One panel open at a time by default. Eight open panels of checklist radios
 * is a wall; one open panel with the other seven headers visible is a table of
 * contents. The instructor can always open the next one.
 */
import { useEffect, useId, useRef, useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import type { CompiledChapter } from '../../contracts/index'
import { FRAMEWORK_ATTRIBUTION, IDEA_FRAMEWORK, type CategoryId } from '../../engine/idea/framework'
import { newReview, type IdeaReview, type IdeaReviewEvent } from '../../engine/idea/review'
import { CategoryPanel } from './CategoryPanel'
import { IDEA_COPY } from './copy'
import { reviewKeyOf } from './useIdeaReviews'

const TARGET = 'min-h-9 min-w-9'
const FIELD =
  'rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950'
const CARD =
  'flex flex-col gap-3 rounded-lg border border-neutral-200 bg-white p-4 dark:border-neutral-800 dark:bg-neutral-900'

export function IdeaScreen({
  chapters, reviews, onEvent, onExport,
}: {
  chapters: readonly CompiledChapter[]
  reviews: ReadonlyMap<string, IdeaReview>
  onEvent: (key: string, event: IdeaReviewEvent) => void
  /** Produces the download and returns its filename, which the status line announces. */
  onExport: (key: string, format: 'md' | 'json') => string
}) {
  const ids = useId()
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState<CategoryId>('7.1')
  const [menuOpen, setMenuOpen] = useState(false)
  const [status, setStatus] = useState('')
  const exportButton = useRef<HTMLButtonElement>(null)

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
    setMenuOpen(false)
    setStatus(IDEA_COPY.export.done(name))
    exportButton.current?.focus()
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="m-0 text-sm text-neutral-700 dark:text-neutral-300">{IDEA_COPY.intro}</p>

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

          <div className="relative ml-auto">
            <button
              ref={exportButton}
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={`${ids}-menu`}
              onClick={() => setMenuOpen((o) => !o)}
              className={`${TARGET} inline-flex items-center gap-2 rounded-md border border-brand-700 bg-brand-700 px-3 text-sm text-white`}
            >
              <Download className="size-4" aria-hidden="true" />
              {IDEA_COPY.export.button}
              <ChevronDown className="size-4" aria-hidden="true" />
            </button>
            {menuOpen && (
              <ul
                id={`${ids}-menu`}
                role="menu"
                aria-label={IDEA_COPY.export.button}
                className="absolute right-0 z-10 mt-1 flex min-w-40 list-none flex-col rounded-md border border-neutral-200 bg-white p-1 shadow dark:border-neutral-800 dark:bg-neutral-900"
              >
                <li role="none">
                  <button type="button" role="menuitem" onClick={() => exportAs('md')} className={`${TARGET} w-full rounded px-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-neutral-800`}>
                    {IDEA_COPY.export.markdown}
                  </button>
                </li>
                <li role="none">
                  <button type="button" role="menuitem" onClick={() => exportAs('json')} className={`${TARGET} w-full rounded px-2 text-left text-sm hover:bg-stone-100 dark:hover:bg-neutral-800`}>
                    {IDEA_COPY.export.json}
                  </button>
                </li>
              </ul>
            )}
          </div>
        </div>

        <fieldset className="m-0 flex flex-wrap gap-3 border-0 p-0">
          <legend className="mb-1 text-sm font-semibold">{IDEA_COPY.assessor.legend}</legend>
          {(['name', 'title', 'college'] as const).map((field) => (
            <label key={field} className="flex flex-col gap-1 text-sm">
              <span>{IDEA_COPY.assessor[field]}</span>
              <input
                type="text"
                className={`${FIELD} ${TARGET}`}
                value={review.assessor[field]}
                onChange={(e) => dispatch({ type: 'assessor', assessor: { [field]: e.target.value } })}
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
              value={review.benchmark.bipocPercent}
              onChange={(e) => dispatch({ type: 'benchmark', bipocPercent: Number(e.target.value) })}
            />
            <span className="text-sm">%</span>
          </div>
          <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">{IDEA_COPY.benchmark.hint}</p>
        </div>
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

      <p className="m-0 text-xs text-neutral-600 dark:text-neutral-400">
        {IDEA_COPY.attribution(FRAMEWORK_ATTRIBUTION.title, FRAMEWORK_ATTRIBUTION.author, FRAMEWORK_ATTRIBUTION.license.name)}{' '}
        <a href={FRAMEWORK_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer" className="underline">
          asccc-oeri.org<span className="sr-only"> ({IDEA_COPY.opensNewTab})</span>
        </a>
      </p>

      {/* Mounted empty rather than conditionally, so the announcement lands in a region that already exists. */}
      <p role="status" aria-live="polite" className="m-0 text-sm">{status}</p>
    </div>
  )
}
```

Note on `onToggle`: a click on the open panel's header leaves it open (`o === category.id ? o : category.id`). The spec says one open at a time; collapsing to zero open panels would hide every checklist and is not offered. Test 'opening a panel closes the one that was open' covers the switch.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run --project unit src/components/idea/`
Expected: PASS (3 hook tests, 8 screen tests, 10 panel tests).

- [ ] **Step 7: Typecheck and commit**

```bash
npm run typecheck
git add src/components/idea/useIdeaReviews.ts src/components/idea/useIdeaReviews.test.ts src/components/idea/IdeaScreen.tsx src/components/idea/IdeaScreen.test.tsx
git commit -m "feat: the IDEA screen, one chapter and one open category at a time

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Wire the phase into the app and the Plan screen

**Files:**
- Modify: `src/App.tsx` (imports ~lines 6–39; state near line 276; `clearDerivedOutput` near line 355; `shell` literal near line 667; screen switch near line 777–834)
- Modify: `src/shell/PlanScreen.tsx` (props near line 45; body — add one line above the commit control)
- Test: `src/App.test.tsx` (append), `src/shell/PlanScreen.test.tsx` (append)

**Interfaces:**
- Consumes: `IdeaScreen`, `useIdeaReviews`, `reviewKeyOf` (Task 6); `ratedCount` (Task 2); `rubric1Markdown`, `rubric1Json`, `rubric1Filename`, `downloadTextFile` (Task 3); `ideaSummary`, `IDEA_CATEGORY_IDS` (Tasks 4, 1).
- Produces: `PlanScreen` gains an optional prop `ideaSummary?: string`.

- [ ] **Step 1: Write the failing tests**

Append to `src/shell/PlanScreen.test.tsx` (use the file's existing render helper if it has one; otherwise this minimal render):
```tsx
test('the plan states the IDEA review status above the commit control', () => {
  render(<PlanScreen destination={{ kind: 'cartridge' }} chapters={[]} unansweredCount={0} ideaSummary="3 of 8 rated" />)
  expect(screen.getByText('IDEA review — 3 of 8 rated')).toBeInTheDocument()
})

test('with no IDEA summary the plan says nothing about it', () => {
  render(<PlanScreen destination={{ kind: 'cartridge' }} chapters={[]} unansweredCount={0} />)
  expect(screen.queryByText(/IDEA review —/)).not.toBeInTheDocument()
})
```

Append to `src/App.test.tsx` (this file already renders `App` with injected clients; reuse its helper that reaches a prepared state — the test named for "Plan" or "cartridge" is the model. If no helper reaches a prepared state cheaply, the assertion on the sidebar alone is enough):
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
and destructure `ideaSummary`. Immediately above the element that renders the commit control (`commitLabel(...)` — search for `onCommit` in the JSX), add:
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
   * One IDEA review per prepared chapter, keyed by `reviewKeyOf`. Lives here
   * rather than in the screen so it survives a visit to Review or Plan, and so
   * `clearDerivedOutput` can throw it away with the output it describes.
   */
  const ideaReviews = useIdeaReviews()
```

In `clearDerivedOutput()`, add a line: `ideaReviews.reset()`.

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
    if (format === 'md') downloadTextFile(name, rubric1Markdown(review, ctx), 'text/markdown')
    else downloadTextFile(name, JSON.stringify(rubric1Json(review, ctx), null, 2), 'application/json')
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
          onEvent={ideaReviews.dispatch}
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
Expected: typecheck clean (the Task 4 red is closed); all unit tests pass, including `docs-claims.test.ts` (Task 9 touches docs; nothing here changes dependencies).

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.test.tsx src/shell/PlanScreen.tsx src/shell/PlanScreen.test.tsx
git commit -m "feat: mount the IDEA phase, derive its sidebar count, export Rubric 1

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Browser tests — accessibility and forced colours

**Files:**
- Create: `src/components/idea/IdeaScreen.browser.test.tsx`
- Create: `src/components/idea/idea.forced-colors.browser.test.tsx`

**Interfaces:**
- Consumes: `IdeaScreen` (Task 6); the WCAG tag list and duplicate-id check modeled on `src/App.a11y.browser.test.tsx`.

- [ ] **Step 1: Write the a11y browser test**

`src/components/idea/IdeaScreen.browser.test.tsx`:
```tsx
import { fireEvent, render, screen } from '@testing-library/react'
import axe from 'axe-core'
import { IdeaScreen } from './IdeaScreen'
import type { CompiledChapter } from '../../contracts/index'
import type { Chapter } from '../../sources/types'
import '../../App.css'

/**
 * The IDEA screen is held to the rule set the rest of the app's own UI is
 * held to (`App.a11y.browser.test.tsx`): full WCAG A/AA tags, nothing
 * removed, in a real browser where axe has layout. Radios inside labels with
 * two spans of text is exactly the construction that reads fine in jsdom and
 * fails a real label-content check.
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
const compiled: CompiledChapter = { chapter, sections: [], queue: [] }

async function violationsIn(container: Element): Promise<string[]> {
  const results = await axe.run(container, { runOnly: { type: 'tag', values: WCAG_AA } })
  return results.violations.map((v) => `${v.id}: ${v.description}`)
}

function duplicateIds(container: Element): string[] {
  const seen = new Map<string, number>()
  for (const el of container.querySelectorAll('[id]')) seen.set(el.id, (seen.get(el.id) ?? 0) + 1)
  return [...seen].filter(([, n]) => n > 1).map(([id]) => id)
}

test('the IDEA screen has no WCAG A/AA violations and no duplicate ids, with a panel open and the export menu open', async () => {
  const { container } = render(
    <IdeaScreen chapters={[compiled, { ...compiled, chapter: { ...chapter, title: '5: Digestion' } }]} reviews={new Map()} onEvent={() => {}} onExport={() => 'x.md'} />,
  )
  expect(duplicateIds(container)).toEqual([])
  expect(await violationsIn(container)).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: /^7\.1 / }))
  fireEvent.click(screen.getByRole('button', { name: 'Export Rubric 1' }))
  expect(duplicateIds(container)).toEqual([])
  expect(await violationsIn(container)).toEqual([])
})

test('every control meets the 24x24 target floor', () => {
  const { container } = render(
    <IdeaScreen chapters={[compiled]} reviews={new Map()} onEvent={() => {}} onExport={() => 'x.md'} />,
  )
  for (const el of container.querySelectorAll('button, input, select, textarea, a[href]')) {
    const r = (el as HTMLElement).getBoundingClientRect()
    // Radios sit inside a label that is the real target; the label is what is measured.
    const target = el instanceof HTMLInputElement && el.type === 'radio' ? el.closest('label')! : el
    const box = target.getBoundingClientRect()
    expect(Math.min(box.width, box.height), (el as HTMLElement).outerHTML.slice(0, 80)).toBeGreaterThanOrEqual(24)
    void r
  }
})
```

- [ ] **Step 2: Write the forced-colours test**

`src/components/idea/idea.forced-colors.browser.test.tsx`:
```tsx
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import { IdeaScreen } from './IdeaScreen'
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

test('forced colours is active for this project', () => {
  expect(window.matchMedia('(forced-colors: active)').matches).toBe(true)
})

test('a rating is a native radio whose checked state does not depend on colour', () => {
  render(<IdeaScreen chapters={[compiled]} reviews={new Map()} onEvent={() => {}} onExport={() => 'x.md'} />)
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
Expected: PASS. If the a11y run reports `label` or `label-content-name-mismatch`, the fix is in `CategoryPanel.tsx`: keep the visible label text as the first child span of the `<label>` (it already is). If it reports `color-contrast` on the `text-neutral-500` detail in the sidebar, that text is not in this component — it's `AppShell`; use `text-neutral-600 dark:text-neutral-400` there (the palette the shell already uses for secondary text).

- [ ] **Step 4: Commit**

```bash
git add src/components/idea/IdeaScreen.browser.test.tsx src/components/idea/idea.forced-colors.browser.test.tsx
git commit -m "test: hold the IDEA screen to WCAG AA and forced colours

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Documentation and the acceptance scenario

**Files:**
- Modify: `README.md` (add a section after the paragraph that describes the accessibility queue, ~line 356)
- Modify: `THIRD-PARTY-NOTICES.md` (after the model paragraph at the end)
- Create: `docs/IDEA.md`
- Modify: `docs/RELEASE-ACCEPTANCE.md` (append one scenario)
- Test: `src/docs-claims.test.ts` (append one obligation)

- [ ] **Step 1: Add the obligation test**

In `src/docs-claims.test.ts`, inside the `obligations` array, add:
```ts
    ['idea framework attribution', /IDEA Framework[^.\n]*CC BY 4\.0/i],
    ['idea never gates', /IDEA[^.\n]*(optional|never (blocks|gates))/i],
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run --project unit src/docs-claims.test.ts`
Expected: FAIL on both new obligations.

- [ ] **Step 3: README**

Add after the accessibility-queue paragraph:
```markdown
## IDEA review (optional)

After the accessibility review, an optional **IDEA** phase applies the ASCCC OERI Inclusion,
Diversity, Equity, and Anti-Racism (IDEA) Framework to each prepared chapter: the Framework's eight
categories as checklists, its Rubric 1 rows rated by the instructor, notes, an editable BIPOC
benchmark (77% by default, per the Framework's §9.0), and a Rubric 1 download as Markdown or
JSON. The IDEA review is optional and never blocks publishing; ratings are entered by a person
and are never computed by the app. The rubric file is a download only and is never packaged into
the cartridge. Framework text is reproduced from the ASCCC OERI IDEA Framework and Implementation
Guide (March 2025), licensed CC BY 4.0, and is attributed on screen and in
`THIRD-PARTY-NOTICES.md`. Nothing in this phase makes a network request.
```

- [ ] **Step 4: THIRD-PARTY-NOTICES**

Append:
```markdown
The IDEA phase reproduces category text, checklists, and Rubric 1 rows from the "ASCCC OERI
Inclusion, Diversity, Equity, and Anti-Racism (IDEA) Framework and Implementation Guide, March
2025" by the ASCCC Open Educational Resources Initiative
(https://asccc-oeri.org/asccc-oeri-inclusion-diversity-equity-and-anti-racism-idea-audit-framework/),
licensed CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/). The text is vendored in
`src/engine/idea/framework.ts`; ids there are stable and are never renumbered.
```

- [ ] **Step 5: `docs/IDEA.md`**

```markdown
# IDEA review — data boundary and licensing

This file states, in one place, what the IDEA phase does with data. It is kept current slice by
slice; the design is in `IDEA_REVIEW_SPEC.md`.

## Slice 1 (this release)

- **Network:** none. The Framework text is vendored; the review lives in React state; the
  Rubric 1 export is built in the browser and handed to the browser's download.
- **Storage:** none. A review is discarded when the prepared output is cleared or the tab closes.
- **Inference:** none. The app never infers race, ethnicity, gender, or disability from anything.
  Every rating and checklist answer is entered by the instructor.
- **Gate:** none. `phaseAvailability(...).plan` reads no IDEA field. IDEA never blocks Plan.

## Licensing of what ships

- Framework text: CC BY 4.0, ASCCC OERI, attributed in the panel footer and THIRD-PARTY-NOTICES.md.
- The ASCCC-hosted Culturally Responsive Curriculum Assessment Tool is CC BY-NC-SA and is
  linked, never embedded.

## Later slices (not yet shipped)

- Rule checks and inventories run in the browser with no network.
- Model calls go browser → the chosen provider, on click only, with the user's key stored in
  the user's browser on the user's device and nowhere else. No key ever transits the relay.
- Image search goes browser → Wikimedia Commons / Openverse, query text only.
```

- [ ] **Step 6: RELEASE-ACCEPTANCE scenario**

Append to `docs/RELEASE-ACCEPTANCE.md`, matching the file's existing scenario format:
```markdown
### IDEA review — slice 1

1. Prepare one OpenStax chapter through Review until the queue is clear.
2. Sidebar: **IDEA — optional** is enabled; **Plan** is enabled regardless.
3. Open IDEA. Only 7.1 is expanded. Rate all three 7.1 rows; the header reads "3 of 3 rows rated"
   and the sidebar reads **IDEA — 1 of 8 rated**. Plan shows "IDEA review — 1 of 8 rated".
4. Answer two checklist items and type a note under 7.6. Rate 7.6 "Not Applicable".
5. Set the benchmark to 62 and the assessor name.
6. Export Rubric 1 → Markdown. The status line names the file. Open it: header carries the
   textbook, chapter, assessor, and "62%"; the table has 10 rows (3 + 7); 7.6 reads
   "Not Applicable" with the note; unrated rows read "Not rated"; the CC BY 4.0 attribution is at
   the foot.
7. Export → JSON. `areas[0].rows` has three entries with ratings; `areas[5].rows[0].rating` is
   `"na"`.
8. Return to Content and clear the selection. Open IDEA: "Nothing to review yet."
9. Build the cartridge. Confirm no `idea-rubric1-*` file is inside it.
```

- [ ] **Step 7: Run the docs test and the full suite**

Run: `npx vitest run --project unit src/docs-claims.test.ts && npm run test && npm run typecheck`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add README.md THIRD-PARTY-NOTICES.md docs/IDEA.md docs/RELEASE-ACCEPTANCE.md src/docs-claims.test.ts
git commit -m "docs: state the IDEA phase's obligations, attribution, and acceptance

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (slice 1 = spec §8.1):**
- §2.1 `IdeaReview` with categories, benchmark, assessor → Tasks 1–2 (with the row-level `ratings` refinement recorded in the spec in Task 1).
- §2.1 "no code path writes the rating" → Task 2 reducer; only `CategoryPanel`'s radio dispatches `rate`.
- §2.5 export: header, area/rating/notes table, checklist, JSON mirror, download-only, filename → Task 3; wired in Task 7; cartridge exclusion verified in the acceptance scenario (Task 9).
- §5.1 shell: `PhaseId 'idea'`, order, `ideaRated/ideaTotal`, never `done`, Plan ignores it, Plan shows the line → Tasks 4, 7.
- §5.2/§5.3 screen: eight panels, one open at a time, header with assessor/benchmark/export, chapter switcher, the argument string, attribution footer, live region → Tasks 5–6.
- §5.3 WCAG 2.2 AA on the screen, forced-colours → Task 8.
- §7.2 data boundary and licensing in `docs/IDEA.md` + README + notices → Task 9.
- §7.3 unit tests (reducer, export, framework), browser tests, acceptance scenario → Tasks 1–3, 8, 9.
- Not in slice 1 by design: findings, highlight-on-focus, Applied/Undo, model, images, `applyIdeaEdits`, attribution change note. Slice 2 plan.

**Placeholder scan:** none of "TBD/TODO/similar to/add validation" appear. Every code step shows the code.

**Type consistency:** `reviewKeyOf(chapter: Chapter)` used identically in Tasks 6, 7; `onExport(key, format) => string` in Tasks 6, 7, 8; `IdeaReviewEvent` union identical across Tasks 2, 5, 6; `ideaSummary(rated, total)` in Tasks 4, 7; `ShellState.ideaRated/ideaTotal` in Tasks 4, 7; `RATING_LABEL` (engine) and `RATING_COPY` (component) deliberately separate — the export must not import component copy; both are asserted to the same four strings in Tasks 3 and 5.
