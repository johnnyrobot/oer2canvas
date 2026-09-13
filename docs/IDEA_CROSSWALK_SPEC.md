# IDEA review — completing the Gen-AI Crosswalk

Date: 2026-09-13. Status: approved in brainstorming. Extends `docs/IDEA_REVIEW_SPEC.md` §4;
does not change anything that spec decided.

## 1. What this is

Slice 4 built the IDEA phase's model runs on OERI's *IDEA Framework Gen-AI Crosswalk
Instructions* (ASCCC OERI, April 2026, treated as CC BY 4.0 like the Framework): Appendix C's
habits in the system prompt, Appendix A's prompts for 7.1, 7.2, 7.4, 7.5, 7.7, and 7.8, and
Appendix B's single-chapter Rubric 1 review. This work adds what the Crosswalk has that the app
does not:

1. **Prompt gaps** — Appendix A's 7.3 and 7.6 prompts, its 7.7.1 chapter-summaries prompt, the
   two "alternative/additional" elements of 7.4, and a citation of the Crosswalk itself.
2. **Book-level review** — Appendix B's "Full OER Review (chapter-level patterns)".
3. **Restorative revision planning** — Step 5, as an instructor-facing plan and copy-only
   student-facing drafts.

Everything in `IDEA_REVIEW_SPEC.md` §1 still holds: suggest, never auto-apply; no demographic
inference; the Rubric 1 rating is never machine-written; IDEA never gates publishing; model
output is a draft by construction and is never stored.

Decisions made in brainstorming, recorded so nobody relitigates them by accident:

- The book-level send carries **each prepared chapter's full section text**, not only its Rubric 1
  results. Size is stated before Send and refused above a per-provider ceiling; never truncated.
- Student-facing drafts are **copy-only**: no Place button. Model text reaches a page only through
  the instructor pasting it into the existing edit path.
- Neither new result is persisted. The download is the persistence.

## 2. Prompt gaps

### 2.1 7.3 and 7.6 become draftable

`DRAFTABLE` gains `'7.3'` and `'7.6'`. The rule zone for each is unchanged; the Ask-the-model
zone appears beneath it as it does for the other categories.

- **7.6 task** (Crosswalk 7.6): identify terms related to race, indigeneity, gender, sexuality,
  disability, and mental health; flag any that are outdated, pathologizing, or inconsistent with
  equity-oriented language; suggest alternatives, naming the category's resource links; and
  **note any terms that need explicit historical contextualization**. Output is `ITEM_SHAPE`.
  An item with a verbatim `original` becomes an `edit` finding through `draftsToFindings` as
  today; one without stays an observation. Drafts whose key matches a rule finding are dropped.
- **7.3 task** (Crosswalk 7.3): review for gendered language and pronoun use; identify where the
  language is inclusive of gender (including gender-nonconforming pronouns) and where it is
  binary or stereotypical; evaluate against the 7.3 rubric rows (area / rating / notes, as text
  in `summary`); propose where inclusive rewrites would best be incorporated. Output is
  `ITEM_SHAPE`, but **`draftsToFindings` ignores `original`/`replacement` for 7.3** so every 7.3
  draft is an observation. Spec §3.1 leaves pronoun rewrites to the author; a model draft does
  not change that.

### 2.2 7.7.1 chapter summaries

A second button under 7.7: *Draft: chapter summaries and key concepts*. Run key
`<chapterKey>::<sectionId>::7.7.1`; `DraftableCategory` gains `'7.7.1'` as a sub-category that
files its findings under `'7.7'`.

Input: the metadata inventory filtered to `kind ∈ {heading, key-block}` plus the section's first
and last two blocks of text (`sectionText` split on blank lines). Task (Crosswalk 7.7.1): evaluate
whether the summaries and key concepts use the IDEA-related terms the chapter's content warrants;
list summaries where such terms are missing or lacking and suggest additions. Output: `ITEM_SHAPE`
observations; no edits (summaries are the publisher's structural text).

### 2.3 7.4 alternative elements

The 7.4 task text gains the Crosswalk's two additional elements:

- name alternative researchers or studies that could diversify the sources, each with a primary
  link (the model names it; the app never fetches) and one line on how it could replace what is
  there;
- ways to centre historically marginalized scholars or communities **in the region this course
  serves**, when a region is given.

`IdeaHeader` gains `region: string` (default `''`), entered once beside the assessor as *Region
served* (free text; hint: "e.g. California Central Valley — used only to focus the model's
suggestions"). `reduceHeader` gets a `region` event; `store.ts` restores it as a string and an
older document without it restores as `''`. It is included in the 7.4, book, and plan prompts
when non-empty; never in any export header (it is not a Rubric 1 field).

### 2.4 Citation

- The system prompt's attribution sentence names both documents: the Framework (CC BY 4.0) and
  the Crosswalk (CC BY 4.0).
- `LlmSettingsPanel` gains one sentence under the data-use line: "Prompts follow OERI's *IDEA
  Framework Gen-AI Crosswalk Instructions* (CC BY 4.0)." with the link, opening in a new tab.
- `THIRD-PARTY-NOTICES.md` gains the Crosswalk entry beside the Framework's, stating what is
  quoted (its prompt shapes and stance sentences) and its licence.

## 3. Book-level review

### 3.1 Where

One card at the top of the IDEA screen, above the chapter picker, headed *Across the chapters*.
Rendered only when two or more chapters are prepared; with one, the card is a single sentence
saying the per-chapter Rubric 1 draft is the whole book. The card carries the `AskModel`
disclosure (provider data-use sentence, terms link, Crosswalk sentence), the size sentence
(§3.3), the Send/Cancel button, and `RunFailure` on failure.

### 3.2 What is sent — one call

In order:

1. The eight category lenses (`lens('7.1')` … `lens('7.8')`) and the Rubric 1 rows, as
   `rubricPrompt` sends them.
2. Region served, if set.
3. Per prepared chapter, in book order: title; the instructor's row ratings (`RATING_LABEL` or
   "not rated") and per-area notes; the model's Rubric 1 draft for that chapter if one exists this
   session, labelled *model draft, unverified*; then every section's text (`sectionText`) and
   image alt/captions, as the rubric prompt formats them.
4. The task, in OERI's words: identify which areas are consistently strong, inconsistently
   applied, and mostly unmet across the chapters; rate each area for the book as a whole on the
   Rubric 1 scale with concrete notes citing chapters; then a prioritized list of revisions or
   supplements as *chapter or section / revision or supplementation required / rationale*.

Response shape, JSON only:

```ts
interface BookDraft {
  summary: string
  areas: { area: CategoryId; rating: Rating | null; notes: string }[]   // one per 7.1–7.8
  revisions: { where: string; revision: string; rationale: string }[]   // in priority order
}
```

`parseBookResponse` is tolerant in the way `parseRubricResponse` is: fenced JSON accepted,
unknown areas dropped, unparseable rating → `null`, missing arrays → empty, non-JSON → throws so
the run fails with the existing *could not read the reply* failure.

### 3.3 Size guard and timeout

- `estimateTokens(text) = Math.ceil(text.length / 4)`, over the full request body.
- `LlmProvider.contextTokens`: Gemini `900_000`; OpenRouter `100_000` (model unknown at build
  time; conservative). Ollama Cloud unchanged (not offered).
- The size sentence reads: "This sends the text of N chapters (about W words) and each chapter's
  Rubric 1 ratings and notes to <provider>." Above the ceiling the button is disabled and the
  sentence becomes: "This is about T tokens; <provider> accepts C. Deselect chapters on Content to
  bring it under." Nothing is truncated, ever.
- `complete()` gains `opts.timeoutMs` (default `LLM_TIMEOUT_MS`, 60 s); the book call passes
  `180_000`. The timeout message names the number it used.

### 3.4 Result, export, state

- Rendered in the card: the summary; a table *Area / Rating / Notes* with the draft chip and no
  radios (there is no book-level rating to copy into, by construction); a table *Where / Revision
  / Rationale*.
- Download Markdown and JSON from the card: `idea-book-patterns-<book-slug>-<date>.{md,json}`,
  built by `book-export.ts` (shares `cell()` and the slug helper with `rubric-export.ts`). Footer:
  both attributions and the provenance sentence (§5.1).
- Run key `book::<bookTitle>`; results in `useModelRuns` as
  `bookDrafts: ReadonlyMap<bookTitle, BookDraft>`. Prepared chapters are grouped by
  `chapter.attribution.bookTitle`; one card per book with two or more chapters (a mixed
  selection — an OpenStax book plus an imported document — gets one card per group that
  qualifies, and the single-chapter sentence for the rest). Not stored; never in any chapter's
  Rubric 1 file; never in the cartridge. Leaving the IDEA phase aborts an in-flight run, as today.

## 4. Restorative revision planning

### 4.1 Where

One card per chapter at the bottom of the IDEA screen, after the chapter-level Summary and
Suggestions, headed *Plan the revisions*. Same disclosure and Send shape. The button is disabled
with a sentence ("Rate, note, accept, or draft something first — the plan is built from your
review.") when the chapter has no rating, no note, no accepted edit, and no draft this session.

### 4.2 What is sent — this chapter only

- Ratings (label or "not rated") and notes per area.
- The Applied list: per edit, category, section title, and `original → replacement` or
  "kept as written (+ context)". Image edits: "image added: <alt>, <credit>".
- Model drafts from this session neither accepted nor dismissed: category, evidence, suggestion.
- The source licence name (`chapter.attribution.license`, or "not stated"), so the plan can say
  what a change is allowed to be.
- Region served, if set.
- **No section text.** The plan is about decisions already made.

Task (Crosswalk Step 5 and Appendix C's chain): first identify the issues this review surfaced,
second propose the revisions, third write them up two ways — instructor-facing notes, and
student-facing text where a passage needs framing rather than replacement. Note for each
instructor item whether the source licence permits it as an in-page change or only as course-level
supplement (Step 5.B).

```ts
interface PlanDraft {
  plan: { priority: 1 | 2 | 3; where: string; issue: string; revision: string; rationale: string; licence: string }[]
  studentText: { where: string; purpose: string; text: string }[]
}
```

`parsePlanResponse`: same tolerance as §3.2; `priority` coerced to 1–3 (default 2).

### 4.3 Result, copy, export, state

- Plan rendered as a table with the draft chip, sorted by priority.
- Student-facing drafts rendered as a list: *where*, *purpose*, the text, and one **Copy** button
  per item (`navigator.clipboard.writeText`; the status line announces "Copied."). No Place, no
  Replace. A sentence under the list says how to use one: paste it through Edit… on a finding, or
  through the Text tab on a re-import.
- Export: (a) the `plan` array becomes a *Revision plan* section in the chapter's Rubric 1
  Markdown and JSON when a plan exists at export time, after the §2.5 appendix — the student
  drafts do not go there; (b) its own download `idea-revision-plan-<chapter-slug>-<date>.{md,json}`
  with both lists. Footer: attributions and the provenance sentence.
- Run key `<chapterKey>::plan`; `planDrafts: ReadonlyMap<chapterKey, PlanDraft>` in
  `useModelRuns`. Not stored.

## 5. Exports, docs, statements

### 5.1 Provenance sentence

Every file that carries model output ends: "Ratings, notes, checklist answers, summary, and
suggestions were entered by the assessor named above. The <pattern review | revision plan> was
drafted by <provider label> on <date> and has not been verified; it is a draft in the sense of
OERI's Gen-AI Crosswalk Instructions." The Rubric 1 file keeps its existing sentence and adds the
second only when it carries a plan.

### 5.2 Documents that state an obligation

- `docs/IDEA.md`: the network line lists the two new call shapes — a whole-book send (every
  prepared chapter's text plus the instructor's ratings and notes) and a per-chapter plan send
  (ratings, notes, accepted edits, session drafts; no text) — and that these two clicks are the
  only ones that send the instructor's own words.
- `PRIVACY.md`: one sentence stating the same.
- `SECURITY.md`: one clause — the per-provider size ceiling means the app cannot build a request
  larger than the provider accepts; no new host, no new storage.
- `THIRD-PARTY-NOTICES.md`: the Crosswalk entry (§2.4).
- `docs/IDEA_REVIEW_SPEC.md`: a §4.4 *Crosswalk completion* pointing here and recording the three
  additions and the two decisions in §1.
- `README.md`: one sentence each for the book review and the plan in the IDEA paragraph.
- `docs/RELEASE-ACCEPTANCE.md`: §9, a walkthrough of the three features in the style of §4–8.

### 5.3 Copy

All new strings under `IDEA_COPY.llm.book`, `IDEA_COPY.llm.plan`, `IDEA_COPY.llm.crosswalk`,
and `IDEA_COPY.assessor.region`. The disclosure sentences are the ones the docs quote.

## 6. Components and files

| Piece | Files |
|---|---|
| Prompts | `src/engine/idea/llm/prompts.ts` (7.3, 7.6, 7.7.1, 7.4 elements, `bookPrompt`, `planPrompt`), `size.ts` (new: `estimateTokens`, `overCeiling`) |
| Parsing | `src/engine/idea/llm/parse.ts` (7.3 gating, `parseBookResponse`, `parsePlanResponse`) |
| Client / providers | `client.ts` (`timeoutMs`), `providers.ts` (`contextTokens`) |
| Header | `review.ts` (`region`), `store.ts` |
| Runs | `src/components/idea/useModelRuns.ts` (`runBook`, `runPlan`, `bookDraft`, `planDrafts`) |
| UI | `BookPatterns.tsx` (new), `RevisionPlan.tsx` (new), `CategoryPanel.tsx` (7.7 second button), `IdeaScreen.tsx`, `LlmSettingsPanel.tsx`, `copy.ts` |
| Export | `book-export.ts` (new), `plan-export.ts` (new), `rubric-export.ts` (plan section), `App.tsx` |
| Docs | as §5.2 |

## 7. Testing

Unit (jsdom):

- `prompts.test.ts`: snapshots for 7.3, 7.6, 7.7.1, 7.4 with and without region; `bookPrompt`
  with two chapters (one rated, one not, one with a draft) asserting order and the "not rated"
  marker; `planPrompt` asserting no section text and the licence name present.
- `parse.test.ts`: `parseBookResponse`/`parsePlanResponse` — valid, fenced, malformed (throws),
  missing arrays, priority coercion; 7.3 items with `original`/`replacement` come back as
  observations.
- `size.test.ts`: `estimateTokens`; under/at/over the ceiling; the over-message names the numbers.
- `book-export.test.ts`, `plan-export.test.ts`, `rubric-export.test.ts`: shapes, `cell()`
  escaping, provenance footer; the Rubric 1 plan section present only when a plan exists.
- `review.test.ts`, `store.test.ts`: `region` round-trips; an old document restores as `''`.
- `client.test.ts`: `timeoutMs` honoured; `key-containment.test.ts`: the key never appears in the
  body of the two new prompts.
- `BookPatterns.test.tsx`: hidden with one chapter; size sentence; disabled over the ceiling;
  Send calls `runBook` once with every prepared chapter; result renders two tables, the draft
  chip, and no radio; failure renders `RunFailure`.
- `RevisionPlan.test.tsx`: disabled with nothing to plan; Send calls `runPlan` with this
  chapter's key only; Copy writes to a stubbed clipboard and announces; no Place/Replace button.
- `CategoryPanel.test.tsx`: 7.3 and 7.6 show the Ask-the-model zone below the rule zone; 7.7
  shows two buttons; a 7.3 draft never renders Replace.
- `useModelRuns.test.ts`: `runBook`/`runPlan` keys, one in flight per key, abort on unmount.

Browser (axe and forced colours): the IDEA screen with both cards mounted and results rendered,
added to `IdeaScreen.browser.test.tsx` and `idea.forced-colors.browser.test.tsx`.

Acceptance: `RELEASE-ACCEPTANCE.md` §9. No live-provider test in CI; `.scratch/gemini-live.test.ts`
remains the hand-run seam and is not committed.

## 8. Out of scope

- Persisting book or plan results (decision, §1).
- A Place button for student-facing text (decision, §1).
- Chunked or map-reduce book sends. If a selection exceeds the ceiling, the instructor deselects
  chapters; revisit if that proves common.
- Verbatim reproduction of the Crosswalk's full text in the app. The Framework is reproduced
  because the assessor reads it while rating; the Crosswalk is a method, cited and linked.
