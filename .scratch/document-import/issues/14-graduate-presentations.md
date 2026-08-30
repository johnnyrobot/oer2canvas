# 14 — Graduate presentation formats through the document workflow

**What to build:** Evaluate modern presentation files as document sources and expose only the formats whose slides, notes, media, and reading order can be transformed into understandable, remediable Canvas pages with honest limitations.

**Blocked by:** 04 — Enable EPUB, ODT, and RTF structured imports; 09 — Harden packaged assets across document formats; 10 — Let users approve and edit the proposed page plan.

**Status:** resolved

- [x] The corpus covers PPTX, PPTM, PPSX, PPSM, and ODP with representative titles, text boxes, notes, images, tables, equations, and ambiguous reading order.
- [x] Each format receives an evidence-based support status rather than being enabled solely because the parser accepts it.
- [x] Passing presentations create stable proposed pages with visible slide provenance and editable titles.
- [x] Missing titles, ambiguous order, unsupported diagrams, equations, media, or notes produce specific findings and limitations.
- [x] Enabled formats complete the shared accessibility-review and cartridge-export workflow, including packaged assets.
- [x] Formats that do not meet the quality bar remain disabled without weakening the released core importer.

## Answer

**PPTX graduates. ODP does not.** `.pptm`, `.ppsx`, and `.ppsm` ride on the PPTX verdict,
because design fact 1 measured them to be the same parser path rather than assuming it.

The bar was written into the design before any corpus existed, precisely so this verdict could
not be reverse-engineered from whatever the corpus turned out to do. It is applied below per
format, per criterion, and where a criterion is met by argument rather than by measurement that
is said in those words.

### PPTX — enabled

| Bar criterion | Verdict | Evidence |
| --- | --- | --- |
| 1. Every top-level block attributed to a slide | **Met, by measurement over the corpus** | Seven `format: 'pptx'` corpus cases, run through the real parser dispatch in a real browser against real anydoc 0.2.4 (`corpus.browser.test.ts`), produce the EXACT blocker set each case declares — and not one of them declares any, so `presentation-unattributed-content` never fires. The set is asserted in both directions, so an expected-blocker regression fails too. |
| 2. Every construct in design fact 6 named by a finding on the right slide | **Met, by measurement** | `pptx-unrepresentable` authors a SmartArt diagram, a chart, and a video on slide 1 and produces exactly one warning: `presentation-unrepresentable`, `sourcePage: 1`, "Slide 1 contains 1 diagram, 1 chart, 1 media that could not be imported." Measured 2026-08-30. `expectFindings` asserts the warning set exactly, and Task 9's review proved that assertion load-bearing by deleting the finding from `reconcile.ts` and watching the corpus go red. |
| 3. No notes text anywhere in the imported HTML | **Met, by measurement** | `pptx-speaker-notes` asserts the note's absence via `expectNotInHtml`, proven load-bearing by mutation: pushing the notes block into `taken` failed exactly the notes cases, with the note visible in the diff. |
| 4. Shared accessibility review and cartridge export pass, packaged assets included | **Met, by measurement** | `App.a11y.browser.test.tsx` audits an imported three-slide deck (middle slide untitled) with axe and finds no violations and no duplicate ids; every `section[data-slide]` carries an `<h2>` with a non-empty id. `cartridge-artifact.browser.test.ts` exports `pptx-packaged-image` through the real parse → compile → `buildCartridge` → zip path, twice for determinism, and `cartridge-artifact.test.ts` reads the artifact back with a REAL `unzip`: `web_resources/oer2canvas/image1-<hash>.png` is present, and the manifest carries two `type="webcontent"` resources and the matching `<file href>`. |

**Residuals stated as limitations, not as bar failures.**

- **PPTX has no one-sentence walk rule.** ODP now has one — "a shape's own content is read; a
  shape nested inside another shape is not entered" — backed by eleven measured placements and
  one measured exception. PPTX has `walkShapes`' enumeration of shape kinds, and the tenth of
  the eleven silent misattributions found during this issue lived in the gap between two of
  them. Nothing structural rules out a twelfth. This is why criterion 1 above is recorded as met
  **by measurement over the corpus**, not as proven for every deck. It is a limitation because
  no counterexample survives today and every one found was fixed and pinned; it is not dismissed,
  because the next one would be found the same way the last ten were.
- **Picture attribution is closed for one property and open for another.** Closed
  unconditionally: a picture block can never be published under a slide that does not reference
  its origin part, which holds whether or not a blocker fires. Open: WHICH INSTANCE of a shared
  media part lands under which slide still rests on the index and anydoc agreeing about which
  shapes produce blocks. The last adversarial review could still construct one — the eleventh —
  but it needs a producer that writes more than one blip reachable in a single fill, and neither
  PowerPoint nor Impress does. That last sentence is **argument, not measurement**: it rests on
  what two authoring tools were observed to write, not on a proof that nothing else can.
- **The mirror direction is structurally invisible.** anydoc emitting a block the index knows
  nothing about cannot be detected by the index. No reviewer could construct one; every candidate
  resolved to "anydoc emits nothing either". Recorded as a residual with no measurement either
  way — which is the honest status, not a clean bill.
- **Two different screens for "this file cannot be imported."** A deck with an anydoc-level
  blocker (an unpackageable EMF) returns an `ImportResult` and lands in the plan editor with a
  disabled Prepare button; a reconciler-level blocker throws back to the file picker. Both are
  correct — one has trustworthy HTML to show and the other does not — but the difference is not
  explained to the user anywhere. Not a bar criterion; recorded in `docs/RELEASE-ACCEPTANCE.md`
  so the screen-reader run watches for it, and left as a follow-up.
- **The reconciler blocker discards the deck's other findings**, so a refused deck shows one
  sentence where there may also have been speaker-notes and untitled-slide warnings. Not a bar
  criterion. Worth revisiting only if the refusal rate on real decks proves high.

### ODP — probe-only

| Bar criterion | Verdict | Evidence |
| --- | --- | --- |
| 1. Every top-level block attributed to a slide | Met, by measurement, on the cases that existed | The three `odp-*` corpus cases produced no blockers, and `reconcile.browser.test.ts` drives dozens of ODP shapes through real anydoc. |
| 2. Every construct in design fact 6 named by a finding on the right slide | **NOT MET, by measurement** | ODP names ONE of the three. Media is counted: an Impress `draw:plugin` with a media mime type raises `presentation-unrepresentable` on the right page, with or without a poster. A chart does not. Measured 2026-08-30 against real anydoc 0.2.4, on both shapes LibreOffice actually writes for `draw:frame > draw:object`: with no replacement image the page imports as its heading and nothing else, **with zero findings**; with the `ObjectReplacements/` picture Impress normally writes beside it, the page imports that still picture as though it were an ordinary slide image, **again with zero findings**. A diagram is the same construct through the same door. |
| 3. No notes text anywhere in the imported HTML | Met, by measurement | `odp-speaker-notes` asserted the absence, and `reconcile.browser.test.ts` still pins the ODF notes path against real anydoc across inline comments, nested frames, headings, tabs and soft breaks. |
| 4. Shared accessibility review and cartridge export pass, packaged assets included | Met, by measurement, at commit `0d1f4e1` | Both real artifacts were unzipped with a real `unzip` and were structurally identical to the PPTX one — same `image1-b81de774.png`, same two `type="webcontent"` resources, same `<file href>`. The ODP a11y screen passed axe with no violations. |

**Criterion 2 is the whole verdict, and it is a measurement rather than a judgement call.**
`odpIndex` reports `unrepresentable.diagrams` and `charts` as a hardcoded zero because ODF
carries both as an embedded OBJECT with no `draw:mime-type` on the frame to classify it by —
the mime type lives in the manifest entry for the sub-document's own directory, which nothing
reads. The residual was carried into this task framed as "nothing is claimed". That framing is
too generous: the consequence is not silence about a construct, it is **a silent loss of it**,
and in the replacement-image shape — the one a real `.odp` almost always has — it is worse than
a loss, because the reader is shown a snapshot of a chart with nothing saying a chart was ever
there. That is design fact 6's defect, unclosed, on the single most common thing an OER science
deck carries after images.

The whole point of the second reader is to notice what the parser lost. For an ODP chart it
notices nothing. Enabling the format on that evidence would be exactly the "status derived from
the parser not throwing" this issue's second criterion forbids.

**What is NOT the reason.** Everything else on the ODP path is measured and works: one section
per page, generated editable titles for untitled pages, notes excluded and named, media named,
reading order (ODF hoists `presentation:class="title"`, so a title-last page still reads title
first — measured), packaged pictures through a real cartridge, and eleven measured picture
placements behind the format's one-sentence walk rule. ODP is closer to graduating than the
verdict makes it sound. It is also worth recording that no real `.odp` written by Impress exists
in this repository: every ODF judgement here rests on the ODF specification, hand-built XML, and
out-of-band probes against a real file during review — whereas PPTX carries design fact 9's
survey of 226 slides across 34 real decks. That asymmetry did not decide the verdict, but it is
part of the honest evidence picture.

**What would re-enable it:** measure what Impress writes for a chart and a diagram — the
manifest media type of the embedded sub-document — so `odpIndex` can count them the way
`pptxIndex` counts a `graphicData` uri. That is a task, not a flag flip.

### Where the verdict lives, so it cannot quietly rot

- `src/import/capability.ts` — the `odp` entry carries the measurement and the re-enable
  condition; the `pptx` entry carries the evidence and both residuals.
- `src/import/presentation/reconcile.browser.test.ts` — two rows, "ISSUE 14 VERDICT: an ODP
  chart is …, with no finding saying so", pin the failing measurement against real anydoc, in
  both of its shapes, with an explicit instruction not to loosen them.
- `src/import/capability.test.ts` — pins that `odp` is the ONLY probe-only entry, by name, so
  flipping it without reading why fails.
- `src/import/presentation.browser.test.ts` — pins the user-visible consequence: an `.odp` is
  refused at the file picker.
- `README.md`, `docs/RELEASE-ACCEPTANCE.md`, `THIRD-PARTY-NOTICES.md` — the user-facing half.

### Criteria

1. **Corpus covers PPTX, PPTM, PPSX, PPSM, and ODP.** Seven PPTX cases spanning a semantic
   lecture deck (bulleted body plus a data table), a described image packaged through the
   cartridge, an untitled slide, speaker notes, a diagram/chart/video slide, the `.ppsx`
   slideshow container, and a macro-bearing `.pptm`; `.ppsm` is exercised with its real
   extension in `presentation.browser.test.ts`. Every case declares what it stands in for and
   asserts its exact blocker AND warning sets. ODP's three cases were measured out of the
   release corpus by this task's verdict; their coverage survives in
   `presentation/reconcile.browser.test.ts` and `presentation/index.test.ts`, which drive the
   ODP index and reconciler against real anydoc without asserting a release claim. Equations and
   ambiguous reading order are covered by the reconciler suites rather than the corpus — an
   equation blocks via the inherited `docx-equation`/`epub-equation` path (design fact 7), and
   title-out-of-order raises `presentation-reading-order` on both formats.
2. **Evidence-based support status.** The table above, per format, per criterion, with the
   measurement date and the file each measurement lives in.
3. **Stable pages with visible slide provenance and editable titles.** A deck proposes ONE page
   whose slides are `<section data-slide="N">` blocks; `blocksOf` sees each section as one
   top-level block with no top-level heading to split on, so the existing "no repeated heading"
   path proposes a single page rather than thirty near-empty ones. Provenance appears in three
   places that never edit a title the author wrote: an untitled slide's generated title is
   `Slide N`, each section heading carries an id, and `data-plan-label` makes the plan editor's
   split points read as slide boundaries. Titles are editable like any other in the plan editor.
4. **Specific findings.** `presentation-untitled-slide`, `presentation-reading-order`,
   `presentation-speaker-notes`, `presentation-unrepresentable` (naming the slide, the kind, and
   the count), the inherited equation blocker, the inherited undescribed-image warning, and
   `presentation-unattributed-content` as a blocker. Each names its slides in the message and
   sets `sourcePage` when exactly one slide is affected — one finding per code rather than one
   per slide, because 42% of real slides carry no title placeholder and per-slide warnings would
   put a dozen near-identical entries on an ordinary deck.
5. **Shared accessibility and cartridge workflow.** Both proven for PPTX end to end, including a
   packaged asset inside `web_resources/` read back by a real `unzip`. Task 11 also found that
   NO corpus case for ANY of the formats had previously carried a packaged image through that
   path, so this closed a gap in the prior release's evidence too, not only in this one's.
6. **Formats that do not meet the bar remain disabled without weakening the core importer.** ODP
   is `status: 'probe-only'` and has no `RELEASED_SOURCES` entry. Nothing in the released
   importer was relaxed to accommodate it: `importStructuredDocument`'s capability gate is
   unchanged and refuses it, and the corpus, cartridge, and accessibility suites lost ODP rows
   rather than gaining an exemption for one.

**Gate:** `npm run verify:release` — criteria 1–7 all `[PASS]` on their enforced halves; the two
MANUAL rows report `NEVER RUN` for Firefox/screen reader (criterion 2) and live Canvas
(criterion 7), exactly as issue 13 defined them. Suite: 138 files, 1461 tests, green.
