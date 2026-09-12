# IDEA review — design

Date: 2026-09-11. Status: approved in brainstorming; slice 1 plan written and reviewed the same day.
Revised after that review in four places, each marked *(revised)* below: ratings are per Rubric 1
row; the assessor and benchmark are entered once per session; reviews persist in the browser; the
chapter renders on the IDEA screen.

## 1. What this is

A sixth, optional phase in oer2canvas that helps an instructor apply the ASCCC OERI
**Inclusion, Diversity, Equity, and Anti-Racism (IDEA) Framework** (March 2025, CC BY 4.0) to a
chapter before it becomes Canvas pages. It does two things with equal weight:

1. **Improves the pages.** Concrete wording and image suggestions the instructor accepts, edits,
   or dismisses; accepted ones flow into the cartridge with a CC BY change note.
2. **Produces a Rubric 1 assessment.** The Framework's Appendix A rubric — eight categories, each
   rated Not Applicable / Exclusive / Emerging Inclusive / Inclusive with notes — filled in by the
   human and exportable in the table shape OERI's assessment program uses.

It is named **IDEA**, not IDEAA. The Framework deliberately treats accessibility as a baseline
rather than a category, the ASCCC "IDEAA Tools" page is a link hub with no accessibility
instrument, and this app already runs a WCAG audit with its own gate. Accessibility stays there.

### Principles (each one traces to a decision below)

- **Suggest, never auto-apply.** False positives are everywhere ("master's degree", "blind
  study"), CC BY requires indicating changes, and the Framework assigns judgment to the
  discipline expert. Every change is an explicit act by the instructor.
- **Rules fire only on what a machine can be sure about; everything else is a draft or a
  checklist.** Same stance as `alt-text.ts`.
- **The app never infers race, ethnicity, gender, or disability** from faces, names, or text.
  Every count of that kind is human-entered.
- **The Rubric 1 rating is never machine-written.** Not from counts, not from the model.
- **IDEA never gates publishing.** The accessibility queue is a legal gate; this is a reflective
  tool, and a mandatory equity gate is how a tool gets abandoned.
- **Model output is labeled a draft by construction**, matching OERI's own April 2026 *IDEA
  Framework Gen-AI Crosswalk Instructions*, which sanction generative-AI-assisted review with the
  discipline expert "in complete control."

### Sources this design leans on

- ASCCC OERI IDEA Framework and Implementation Guide, March 2025 (CC BY 4.0) — categories
  7.1–7.8, Appendix A Rubric 1, §9.0 (the 77% BIPOC benchmark is adjustable by college).
- ASCCC OERI *IDEA Framework Gen-AI Crosswalk Instructions* (April 2026) — per-category prompt
  templates, table-shaped outputs, "analyze alt text and captions, not pixels" for 7.1, and the
  "separate what you see from what you infer" rule.
- OpenStax *Improving Representation and Diversity in OER Materials* (June 2020, CC BY 4.0) —
  judge image diversity per section/chapter; contextualize rather than rewrite historical
  quotations.
- `retext-equality` (MIT) — the rule engine for 7.3 and 7.6.
- Research report: `~/code/oeri-idea/IDEA-research-report-2026-09-11.md`.

## 2. Data model

All per chapter, all plain data, living **beside** `QueueSession` — nothing here is read by
`isPublishable` or by `phaseAvailability` for `plan`.

### 2.1 `IdeaReview` — the human's judgment

```ts
type CategoryId = '7.1' | '7.2' | '7.3' | '7.4' | '7.5' | '7.6' | '7.7' | '7.8'
type Rating = 'na' | 'exclusive' | 'emerging' | 'inclusive'
type ChecklistAnswer = 'yes' | 'no' | 'unsure' | 'skip'

interface CategoryReview {
  rating?: Rating                                   // human-set only; no code path writes it
  notes: string
  checklist: ReadonlyMap<string, ChecklistAnswer>   // keyed by stable bullet id, e.g. '7.6.3'
}

interface IdeaReview {
  categories: Readonly<Record<CategoryId, CategoryReview>>
  benchmark: { bipocPercent: number }               // default 77 (CCCCO Data Mart Fall 2022); editable
  assessor?: { name: string; title: string; college: string }   // Rubric 1 header fields
}
```

The checklist bullets are the Framework's "Elements for Consideration", vendored as
`data/idea-framework.json` with stable ids, text, and the category's "Restorative Requirements"
paragraph. That file is CC BY 4.0 and is attributed in the panel footer and in
`THIRD-PARTY-NOTICES.md`.

A pure reducer `(review, event) => review` in `src/engine/idea/review.ts`, hook shell over it in
the component layer, same split as `session.ts` / `useQueueSession.ts`.

### 2.2 `IdeaFinding` — what a check or the model surfaced

```ts
type FindingOrigin = 'rule' | 'draft'          // 'draft' = a model wrote it; rendered as such

interface RuleRef {
  id: string                                   // e.g. 'retext-equality:ablist:suffers-from'
  source: 'retext-equality' | 'idiom' | 'llm'
  note?: string                                // the rule's explanation, shown on the card
  sourceUrl?: string                           // NCDJ, GLSEN, …
}

interface EditFinding {
  kind: 'edit'
  key: string                                  // `${sectionId}::${elementId}::${occurrence}::${original}`
  sectionId: string
  elementId: string
  original: string                             // exact substring of the element's text
  occurrence: number                           // nth occurrence of `original` in that element
  replacement: string
  inQuotation: boolean                         // inside <blockquote>/<q> or a citation-bearing paragraph
  rule: RuleRef
  origin: FindingOrigin
}

interface ObservationFinding {
  kind: 'observation'
  key: string
  sectionId: string
  elementId?: string                           // highlightable when present
  category: CategoryId
  columns: Readonly<Record<string, string>>    // OERI's table shape for that category
  rule?: RuleRef
  origin: FindingOrigin
}

type IdeaFinding = EditFinding | ObservationFinding
```

Findings are ephemeral outputs of a run, recomputed whenever a section recompiles, like
`QueueItem`s. They are never persisted.

### 2.3 `IdeaEdits` — what the human decided

```ts
type IdeaEdit =
  | { kind: 'replace'; replacement: string }
  | { kind: 'keep'; context?: string }         // historical usage kept; optional parenthetical inserted after it
  | { kind: 'image'; placement: Placement; hit: ImageHit }   // §6

type Placement =
  | { kind: 'replace'; elementId: string }
  | { kind: 'insert-after'; elementId: string }

interface IdeaEdits {
  edits: ReadonlyMap<string, IdeaEdit>         // by finding key (edit/keep) or a generated key (image)
  dismissed: ReadonlySet<string>               // hidden for this session; not an edit
}
```

Accept writes to `edits`; Dismiss writes to `dismissed`; Undo deletes. The map is the only place
a decision lives.

### 2.4 `applyIdeaEdits` — a compile step

Added to `STEPS` after `text-semantics` and before `attribution`. For each edit whose `sectionId`
matches:

- `replace`: locate the element by `elementId`, find the `occurrence`-th instance of `original`
  in its text nodes, replace it preserving the leading capital and surrounding punctuation. If
  the substring is not found, **do not apply**; emit a `FixNote` (`step: 'idea-edits'`,
  message: "1 inclusive-language edit no longer matched and was not applied") and leave the
  edit in the map flagged stale in the UI.
- `keep` with `context`: insert ` (${context})` immediately after the matched text.
- `image`: see §6.3.

When at least one `replace`/`keep`-with-context/`image` edit applied, `appendAttribution`
appends one sentence to the Source-and-license block: *"Modified from the original: wording
updated for inclusive language."* (and, for images, the additional-image lines in §6.4). This is
the CC BY "indicate changes" obligation; it is idempotent like the rest of that step.

### 2.5 Export

`rubric1Export(review, findings, edits, chapter)` → `{ markdown, json }`:

- Header: textbook / chapter / assessor, benchmark used.
- One table: area · rating · notes, in Framework order, with the checklist answers under each
  row.
- Appendix: applied edits (original → replacement, section, rule source) and added images
  (title, creator, license).
- JSON mirrors the table so a future OERI submission form can consume it.

Download only. **Never packaged into the cartridge** — the rubric is about the material, not for
students. `.docx` export is a stretch goal for slice 1 if the existing document tooling makes it
cheap; otherwise Markdown + JSON only.

### 2.6 Provider settings

```ts
interface LlmSettings { provider: 'gemini' | 'openrouter' | 'ollama'; key: string; model: string }
```

**Stored only in the user's browser, on the user's device.** oer2canvas is a progressive web app,
so the key persists in IndexedDB for this origin (so an instructor is not re-pasting it every
session) and nowhere else: never on the relay, never in any server log, never in a URL. *Forget
key* erases it; the settings panel says which device it is stored on and warns about shared
computers. This is a deliberate step past the Firecrawl key's tab-memory contract, and the README
paragraph that describes that key gets a sibling explaining the difference.

## 3. Deterministic checks and inventories (no model, no network)

Module `src/engine/idea/`, one pure function per category: `(sectionId, html) => IdeaFinding[]`.
Input is the compiled, repaired section HTML — the same bytes the audit scans. Runs on the
compile worker path, results cached per `(sectionId, htmlHash)`.

### 3.1 `terms.ts` — 7.6 Appropriate Terminology and 7.3 Gender-Inclusive Language

- Engine: `retext-equality` via `unified` + `retext-english`, run on the **text nodes** of each
  block element so a hit maps to an `elementId` and an occurrence index.
- **Curated rule set**, vendored as `data/idea-terms.json`, generated by
  `scripts/idea-build-terms.ts` from the library's YAML with these edits, recorded in the script:
  - drop software-context rules (`disabled → turned off`, git-sense `master/slave`,
    `whitelist/blacklist`, `dummy value`, and the like);
  - keep every `ablist`, `race`, `lgbtq`, `suicide`, `condescending` rule;
  - keep `gender` noun rules (chairman, mankind, fireman, …); **drop** the `he/she → they`
    pronoun "or" rules from the *edit* set — pronoun rewrites are the author's call
    (Framework §7.3), so pronoun-pattern hits are emitted as **observations** instead.
- Each finding keeps the rule's note and source URL.
- **Quotation guard:** a hit inside `<blockquote>`, `<q>`, `<cite>`, or a paragraph containing a
  citation pattern (`\(\d{4}\)`, ` v\. `, `et al\.`) sets `inQuotation: true`; the card then leads
  with *Keep, add context* — the Framework's own rule for historical uses.
- Replacement preserves capitalization ("Suffers from" → "Has") and never crosses an inline
  element boundary; a match that would is skipped.

### 3.2 `idioms.ts` — 7.6 idioms and colloquialisms

- A vendored list `data/idea-idioms.json` (~150 entries, ours, CC BY) of English idioms with a
  plain-language gloss each.
- Emits **observations only**; each carries an optional parenthetical edit ("hit the books
  (study intensively)") the instructor may accept. The Framework says *clarify*, not remove.

### 3.3 `images.ts` — 7.1 image inventory

- For each `<img>`: final alt (post-queue), caption, figure reference, `src`, and a boolean
  `mentionsPeople` from a fixed noun list (`person|people|woman|man|student|worker|patient|
  child|family|nurse|doctor|teacher|…`) matched against alt + caption.
- Output: one observation per image with OERI's 7.1 columns (`imageRef`, `description`,
  `suggestedRevision: ''`), plus a section summary observation ("6 images · 2 mention people").
- **No demographic inference of any kind.** This inventory is the input OERI's 7.1 prompt asks
  for and the worksheet the human fills in.

### 3.4 `metadata.ts` — 7.7 keyword/glossary/metadata

- Headings h2–h4, `<dl>` terms, `<strong>`/`<b>`-led definitions, key-takeaway and summary
  blocks (located via the publisher profile, which already knows those selectors), and proper
  nouns appearing ≥ 2 times.
- One observation table so the instructor sees what the section signals as important.

### 3.5 Not checked by rules

- **7.2 Example Names** — deferred to the model (§4). In-browser name extraction is either a
  huge list or false positives on every capital.
- **7.4, 7.5, 7.8** — checklist and model only.

### 3.6 Re-run semantics

Findings recompute on every recompile of a section. Keys present in `edits` or `dismissed`
suppress their findings on the next run, exactly as answers shrink the queue. A finding whose
`original` no longer exists simply does not reappear.

## 4. Model-assisted drafting (bring-your-own key, browser-direct)

### 4.1 Provider adapter — `src/engine/idea/llm/`

```ts
interface LlmProvider {
  id: 'gemini' | 'openrouter' | 'ollama'
  label: string
  baseUrl: string                     // preset; not user-editable in v1
  defaultModel: string
  auth: (key: string) => HeadersInit  // Bearer for OpenRouter/Ollama Cloud; x-goog-api-key for Gemini
  extraHeaders?: HeadersInit          // OpenRouter: HTTP-Referer, X-Title
  dataUse: string                     // one sentence shown beside the key field, with a link
  offered: boolean                    // set by the CORS spike: false if it cannot be called browser-direct
}

complete(provider, settings, messages, { signal }): Promise<{ text: string; usage?: Usage }>
```

All three presets use the OpenAI-compatible chat-completions dialect (Gemini via its
`/v1beta/openai/` path). Non-streaming, JSON body, one request per category run, 60 s timeout,
one in-flight request per category, aborted on phase exit.

Requests go **browser → provider, always**. The relay is never in the path: a key must not
transit the server, let alone be stored by it.

Errors map to four user-facing states — *bad key*, *model not found*, *rate limited (retry in N
s)*, *provider unreachable* — never a raw stack.

### 4.2 The CORS spike (first task of slice 4)

`scripts/idea-llm-cors-probe.ts` sends one minimal completion to each preset from a browser
origin and records the verdict in `docs/evidence/idea-llm-cors-<date>.md`. **A provider that
cannot be called browser-direct is not offered** (`offered: false`, listed in the settings panel
as "not available from the browser" with the evidence link) — there is no relay fallback,
because a key must never transit the server. The data-use sentences are confirmed against each
provider's current terms in the same spike.

### 4.3 Prompt layer — `prompts.ts`

OERI's Appendix A templates, one per category, adapted only where the input shape differs:

- The *role · task · lens · constraints* block and the "clearly separate what you see explicitly
  in the text from what you infer or recommend" instruction are kept verbatim.
- **Grounding:** OERI's prompts say "[Link to Framework]". A browser model call can't follow
  links, so the category's *Restorative Requirements* + *Elements for Consideration* text is
  inlined as the lens (from `data/idea-framework.json`), and the category's Additional Resources
  URLs are listed as citations the model may name but not fetch.
- **Input per category:** 7.1 → the image inventory table (alt/caption/reference only, no
  pixels); 7.7 → the metadata inventory; 7.2 / 7.4 / 7.5 / 7.8 → the section's text; all → chapter
  title, section title, and discipline from source metadata.
- **Output requested as JSON** in OERI's column shapes: 7.1 → `[{ imageRef, description,
  suggestedRevision }]`; 7.5 → the five columns; 7.2 / 7.4 / 7.8 → `{ summary, items: [{ evidence,
  inference, suggestion }] }`; each item may carry `{ original, replacement }`.
- A response that fails to parse is shown as plain text under a *"couldn't structure this"*
  note — never dropped.
- Every item becomes an `IdeaFinding` with `origin: 'draft'`. An item becomes an **`edit`
  finding only when its `original` matches text in the section verbatim**; anything else is an
  `observation`. The model cannot edit text it did not quote.

### 4.4 Rubric draft (OERI Appendix B)

A chapter-level *Draft a Rubric 1 review* run returns area / suggested rating / notes. It renders
as a greyed **draft column beside** the human's rating column, with a one-click *use this note*
for the notes only. The suggested rating is displayed and **cannot be copied into the human
field** — the instructor clicks their own rating. This is the one place the design adds friction
on purpose.

### 4.5 Consent and disclosure

- The button names the provider: *"Send this section to Gemini"*.
- Above it: what leaves the browser (*this section's text and image descriptions*) and the
  provider's data-use sentence with a link. Expanded on the first run per session, collapsed but
  present afterwards.
- Nothing is sent on phase entry, on recompile, or in the background. Only on click.

### 4.6 Settings panel

In the IDEA phase header: provider select, key field (masked, paste-only), model field prefilled
from the preset, *Forget key*. No-key state on every panel is a sentence and a link to this
panel, not a disabled button.

## 5. The IDEA phase: shell, screen, interaction

### 5.1 Shell

- `PhaseId` gains `'idea'`; `PHASE_ORDER` = `destination · chapters · review · idea · plan ·
  result`; `PHASE_LABEL.idea = 'IDEA'`.
- `ShellState` gains `ideaRated: number` (categories with a rating, summed over selected
  chapters) and `ideaTotal: number`.
- Availability: *unavailable* ("checks are still running") until the selection is prepared;
  *available* thereafter. **IDEA never reaches `done` on its own** — the sidebar reads *"IDEA —
  optional"* until a rating exists, then *"IDEA — 3 of 8 rated"*.
- `phaseAvailability` for `plan` does not read `ideaRated`. Plan shows the same *"IDEA — …"*
  line above the commit button so skipping is a visible choice.

### 5.2 Screen

Per chapter, with the chapter switcher Review already has:

```
┌ IDEA review · Chapter 4: Nutrition            [Provider: Gemini ▾] [key ••••] [Forget]
│ Assessor: name / title / college       BIPOC benchmark: [77]%    [Export Rubric 1 ▾]
├───────────────────────────────────────────────────────────────────────────────────
│ ▸ 7.1 Illustrations & Photos      rated: —      6 images · 2 mention people
│ ▾ 7.6 Appropriate Terminology     rated: —      4 suggestions · 1 in a quotation
│   ┌ What a rule found ──────────────────────────────────────────────────────
│   │ "suffers from diabetes"  →  "has diabetes"        NCDJ style guide ↗
│   │   in §4.2 Nutrients, paragraph 7            [Replace] [Edit…] [Dismiss]
│   │ "the schizophrenics"  →  "people with schizophrenia"   (in a 1911 quotation)
│   │                                          [Keep, add context…] [Replace] [Dismiss]
│   ├ Ask the model ─────────────────────────────────────────────────────────
│   │ ⓘ Sends this section's text to Gemini. Gemini's data-use terms ↗
│   │                                            [Send this section to Gemini]
│   ├ Elements for consideration ──────────────────────────────────────────
│   │ ○ Outmoded or incorrect terminology identified and replaced/reframed   yes/no/unsure/skip
│   ├ Rubric 1 ───────────────────────────────────────────────────────────
│   │ ( ) N/A  ( ) Exclusive  ( ) Emerging inclusive  ( ) Inclusive
│   │ Notes: [                                                    ]
│   └───────────────────────────────────────────────────────────────────────
│ ▸ 7.7 …
├───────────────────────────────────────────────────────────────────────────────────
│ Section render (read-only, repaired HTML) — the focused finding is highlighted here
```

### 5.3 Interaction rules

- Eight collapsible panels, all present, Framework order, one open at a time by default. Each
  header line is its summary (finding count, rating).
- Focusing a finding highlights its element in the section render — the queue's existing D5.7
  highlight mechanism, reused. Edit findings highlight the sentence's block; image observations
  highlight the image.
- **Replace** applies immediately: map write → recompile that section → findings recompute →
  the row moves to an *Applied* list at the bottom of the panel with *Undo*. **Edit…** opens an
  inline field prefilled with the replacement. **Keep, add context…** opens a one-line field
  ("a widely used term at the time"). **Dismiss** hides it for this session.
- Draft rows render in the same table shape with a *draft* chip and a distinct border, so a
  reader can tell "a style guide says" from "a model suggested" at a glance.
- Checklist and rubric are always editable — with or without findings, with or without a key.
- Every user-facing string lives in one constants object per component. The one string that
  argues sits above the rubric: *"Rate what you observed, not what the tool counted. The counts
  and drafts are evidence; the judgment is yours."*
- The panel footer attributes the Framework text (CC BY 4.0, ASCCC OERI) and links the OERI
  assessment program.
- WCAG 2.2 AA on the screen itself, forced-colors screenshot, live-region announcements for
  *Applied* / *Undone* / *Sent* / *Draft ready*.

## 6. Image suggestions for 7.1 (open-licensed search)

Scope: search and suggest; the instructor chooses; the chosen image is packaged with attribution.
No image generation (deferred; see §8).

### 6.1 Providers — `src/engine/idea/images/`

```ts
interface ImageSearch {
  id: 'commons' | 'openverse'
  search(query: string, opts: { licenses: License[]; page: number; signal: AbortSignal }): Promise<ImageHit[]>
}
type License = 'cc0' | 'by' | 'by-sa' | 'pd'
interface ImageHit {
  id: string; title: string; thumbUrl: string; fullUrl: string; width: number; height: number
  license: { kind: License; name: string; url: string }
  creator?: string; sourcePageUrl: string
  attributionHtml: string           // TASL: Title · Author · Source · License, built by the adapter
}
```

- **Wikimedia Commons first.** No key; `origin=*` CORS; `list=search` in the `File:` namespace
  with `prop=imageinfo&iiprop=url|extmetadata`. The adapter parses the per-file license from
  `extmetadata` and **drops** anything that is not CC0 / CC BY / CC BY-SA / public domain, and
  anything in a "do not use or index" category. Unparseable license metadata → dropped, not
  shown with a warning.
- **Openverse second**, anonymous tier, `license=cc0,by,by-sa` (+ `pdm`) filter; license and
  creator arrive as fields. Second only because anonymous limits are unverified. There is no
  app token: if the anonymous tier proves unusable, Openverse is dropped rather than proxied.
- **Excluded:** Unsplash and Pexels (non-CC licenses; Unsplash requires hotlinking, which
  conflicts with packaging).
- **"More sources"**: the Framework §8.0 diverse-collection links (nappy.co, Disabled And Here,
  Gender Spectrum Collection, wocintechchat, …) as a link list under the search box. They have no
  APIs; an instructor brings an image from them through the existing Document import.

### 6.2 Entry points and the search card

- The 7.1 section summary line offers *Find an openly licensed photo*; each image row offers
  *Find an alternative*, prefilled with that image's alt as the query.
- The card: query field; license tri-state fixed to CC0 / CC BY / CC BY-SA (all on by default,
  BY-SA labeled with its share-alike note); results grid with title, creator, license badge;
  *Use this image* opens a placement picker over the section render (*replace image X* /
  *insert after paragraph N*).
- The Framework's 7.1 guidance shown once above results: *"Look for people whose identity is not
  the subject of the image."* The app never ranks or filters by demographic terms; the
  instructor's query does that.

### 6.3 What "Use this image" does

Writes an `image` edit. `applyIdeaEdits` emits
`<figure><img src alt=""><figcaption>…attributionHtml</figcaption></figure>` at the placement,
and the packaged-asset pipeline that already ships PDF-recovered figures fetches `fullUrl` into
the cartridge. **The new image enters the accessibility queue** — it has no alt yet — so Plan
re-gates until the instructor writes one (VLM draft available as today). IDEA can add work to
Review; it can never bypass it.

### 6.4 Attribution

TASL in the figcaption **and** a line in the page's Source-and-license block: *"Additional
image: Title by Author, Wikimedia Commons, CC BY 4.0."* CC BY-SA adds the share-alike sentence.
The placement dialog states the license obligation before *Use*.

### 6.5 Failure modes

Provider unreachable / rate-limited → one sentence in the card; the other provider still works.
Zero results → suggest broadening and show "More sources". Fetch failure at package time →
blocking finding naming the image, like any missing packaged asset today.

## 7. Error handling, privacy, testing

### 7.1 Error handling — one rule

A failure in the IDEA phase never affects publishability or the accessibility gate.

- A rule-check exception is caught per category per section and rendered as *"7.6 couldn't be
  checked on this section"* with the error in a collapsed detail; everything else still runs.
- `applyIdeaEdits` mismatches drop the edit with a `FixNote`; the edit stays in the map flagged
  *stale* in the Applied list.
- Model calls: the four mapped states; abort on phase exit; one in-flight per category; 60 s.
- Image fetch at package time: blocking finding, as any packaged asset.

### 7.2 Data boundary (also written to `docs/IDEA.md` and a README paragraph)

- Rule checks and inventories: in-browser, no network.
- Model calls: browser → chosen provider, on click only, section text + image descriptions only,
  user's key stored in the browser on the user's device (IndexedDB) and nowhere else, provider's
  data-use sentence beside the button.
- Image search: browser → Commons / Openverse, query text only.
- Relay: **unchanged.** No key, token, or credential is ever sent to, stored on, or forwarded by
  the server. A provider that cannot be reached browser-direct is not offered.
- No inference of race, ethnicity, gender, or disability from anything. Counts are human-entered.
- Shipped licenses: Framework text (CC BY 4.0, attributed); retext-equality rules (MIT); idiom
  list (ours, CC BY); the Culturally Responsive Curriculum Assessment Tool is linked, not
  embedded (CC BY-NC-SA).

### 7.3 Testing (matching the repo's tiers)

- **Pure unit:** `terms.ts`, `idioms.ts`, `images.ts`, `metadata.ts`, `applyIdeaEdits` (match,
  no-match, capitalization, inline-boundary skip, keep-with-context), the `IdeaReview` reducer,
  `rubric1Export`, prompt builders (snapshot per category), response parsers (valid JSON,
  malformed, plain text, verbatim-match gating), each provider's request shape against a fake
  `fetch`, each image adapter's license filter against canned responses (unparseable → dropped,
  do-not-use → dropped, BY-SA labeled).
- **Golden:** a fixture section compiled with a set of IDEA edits → HTML golden including the
  attribution change note and a CC BY-SA figure.
- **Browser:** the IDEA screen renders; keyboard traversal; highlight-on-focus; Replace → Applied
  → Undo round trip; forced-colors screenshot; no-key state; a11y scan of the screen.
- **Evidence, not tests:** `scripts/idea-llm-cors-probe.ts` and
  `scripts/idea-image-api-probe.ts`, writing to `docs/evidence/`, rerun on provider changes.
- **Acceptance:** one scenario in `RELEASE-ACCEPTANCE.md` — import a chapter, accept two term
  edits, keep one with context, add one Commons image, answer its alt, export cartridge and
  Rubric 1, verify both.

## 8. Slices

Each a shippable PR with its own tests; order fixed by dependency.

1. **Phase + review model + checklists + Rubric 1 export.** Shell change, `data/idea-framework.json`,
   `IdeaReview` reducer, the screen with all eight panels showing checklist + rubric only,
   Markdown/JSON export (docx if cheap).
2. **Term and idiom findings + edits.** `terms.ts`, `idioms.ts`, the vendored rule set and its
   build script, `applyIdeaEdits`, attribution change note, highlight-on-focus, Applied/Undo,
   golden.
3. **Inventories.** `images.ts`, `metadata.ts`, observation tables.
4. **Model drafting.** CORS spike → provider adapter, settings panel, prompts, parsers,
   per-category run, rubric draft column, disclosure copy.
5. **Image search.** API spike → Commons + Openverse adapters, search card, image edit kind,
   packaging, queue hand-off, attribution lines.

## 9. Deferred and open

- **Image generation provider** — deferred by decision; revisit for cases where no suitable
  open-licensed photo exists.
- **Rubric 2 (new-OER guide) mode** — the Framework's Appendix B; same model, different copy.
- **OERI contact** — ask oeri@asccc.org whether they welcome a third-party tool embedding their
  Gen-AI prompt templates, and whether the badged-OER repository will have a public feed the app
  could query ("has this textbook already been assessed?").
- **Data-use sentences** per provider — confirmed in the slice-4 spike, not asserted here.
