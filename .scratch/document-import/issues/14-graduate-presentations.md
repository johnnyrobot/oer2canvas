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

**Both formats graduate — but not on the evidence this Answer originally rested on.** The bar was
applied twice over a corpus of eleven synthetic fixtures, and both times it said "met". The final
whole-branch review then ran files real producers wrote, and measured 2 of 11 real `.pptx` decks
refusing and 0 of 3 real `.odp` files importing. Four ordinary defects came out of that, all four
are fixed and pinned here, and the numbers on real files are now 29 of 39 `.pptx` importing and
**14 of 14 `.odp`** — see "What real files did to this verdict" below for the full measurement,
including the one construct that still refuses. Read that section before the two tables: the
tables record what the corpus proves, and the corpus was not enough.

**PPTX graduated on the first application of the bar; ODP only on the second, after
a defect the first pass mistook for a limitation was fixed.** `.pptm`, `.ppsx`, and `.ppsm` ride
on the PPTX verdict, because design fact 1 measured them to be the same parser path rather than
assuming it.

The bar was written into the design before any corpus existed, precisely so this verdict could
not be reverse-engineered from whatever the corpus turned out to do. It is applied below per
format, per criterion, and where a criterion is met by argument rather than by measurement that
is said in those words.

### The first pass failed ODP, and the review overturned it. That history is the evidence.

The first application of the bar failed ODP on criterion 2: an Impress chart produced no finding
at all, which is design fact 6's silent loss and the exact defect the whole second reader exists
to prevent. That measurement was correct about the code. It was wrong about the cause, and the
review caught it by doing something neither the design nor the first pass had done — **it had
LibreOffice write the file itself**, through `soffice`'s own `impress8` filter, instead of
reasoning from the ODF specification and hand-authored XML.

Three things fell out of that, and all three changed the verdict:

1. **The claim the verdict rested on was not what a real `.odp` does.** Impress writes a chart as
   `draw:frame > draw:object` plus an `ObjectReplacements/` preview whose manifest media type is
   `application/x-openoffice-gdimetafile` — a VCL metafile, not a raster. Driven end to end, that
   deck raises `embedded-content` at severity **blocker**. So a real Impress chart *refused* the
   import. It was neither "dropped entirely" nor "published as a still picture of itself" — the
   two shapes the failing verdict was built on. Both are real behaviours of the code; neither is
   what a user meets. The verdict survived on the letter of criterion 2 and was **overstated
   about the consequence**, which is exactly the distinction this issue's second criterion is
   about.
2. **The guard test could not detect the thing it claimed to guard.** It said "when this test
   fails, do not loosen it — a failure means the index learned to notice an embedded object." A
   working manifest-based counter was implemented and **both pinned rows still passed**, because
   the fixture deliberately omitted the sub-document and therefore its manifest entry — the exact
   datum any correct fix reads. A test that cannot go red is not evidence.
3. **The deferred measurement was already in hand, and the fix was about thirty-five lines.** The
   failing verdict said re-enabling "needs one measurement… that is a task, not a flag flip."
   The measurement above supplies it. Disabling a format for users when the package already
   carries the datum, over a seam the design already built, is not proportionate.

**So the fix was made and the bar re-applied.** `parts.ts` adds one pattern
(`META-INF/manifest.xml`) to `ODP_PATTERNS`; `presentation/index.ts` parses `manifest:file-entry`
into a media-type map, resolves `draw:object`'s `xlink:href` (`./Object 1` → `Object 1/`) through
the same `resolvePackagePath` the picture path already uses, and classifies
`application/vnd.oasis.opendocument.chart` as a chart and `…opendocument.graphics` as a diagram.

### PPTX — enabled

| Bar criterion | Verdict | Evidence |
| --- | --- | --- |
| 1. Every top-level block attributed to a slide | **Met over the corpus; NOT met on a real deck carrying an inserted chart** | Eight `format: 'pptx'` corpus cases, run through the real parser dispatch in a real browser against real anydoc 0.2.4 (`corpus.browser.test.ts`), produce the EXACT blocker set each case declares — and not one declares any. Asserted in both directions. **But the corpus is not the whole evidence any more.** Over 39 real `.pptx` decks driven end to end (see "What real files did to this verdict"), 4 refuse, and all 4 refuse for the same reason: anydoc renders a chart's cached data as a `<table>` the index has no account of. The rule is exact — every deck carrying a `ppt/charts/chartN.xml` refused, every deck without one imported. The block is not attributed, and the file is refused rather than published, so nothing is misattributed; but the criterion as written is not met for those decks and this row says so. |
| 2. Every construct in design fact 6 named by a finding on the right slide | **Met, by measurement** | `pptx-unrepresentable` authors a SmartArt diagram, a chart, and a video on slide 1 and produces exactly one warning: `presentation-unrepresentable`, `sourcePage: 1`, "Slide 1 contains 1 diagram, 1 chart, 1 media that could not be imported." `expectFindings` asserts the warning set exactly, and Task 9's review proved that assertion load-bearing by deleting the finding from `reconcile.ts` and watching the corpus go red. |
| 3. No notes text anywhere in the imported HTML | **Met, by measurement** | `pptx-speaker-notes`'s `expectNotInHtml`, proven load-bearing by mutation: pushing the notes block into `taken` failed exactly the notes cases, with the note visible in the diff. |
| 4. Shared accessibility review and cartridge export pass, packaged assets included | **Met, by measurement** | axe finds no violations and no duplicate ids on an imported three-slide deck whose middle slide is untitled, with every `section[data-slide]` carrying an `<h2>` with a non-empty id. `pptx-packaged-image` exports through the real parse → compile → `buildCartridge` → zip path, twice for determinism, and is read back by a REAL `unzip`: `web_resources/oer2canvas/image1-<hash>.png`, two `type="webcontent"` resources, matching `<file href>`. |

### ODP — enabled, after the manifest fix

| Bar criterion | Verdict | Evidence |
| --- | --- | --- |
| 1. Every top-level block attributed to a slide | **Met over the corpus AND over every real `.odp` measured** | Five `format: 'odp'` cases, same exact-blocker-set assertion in both directions, none declaring one — plus **14 of 14 real `.odp` files written by LibreOffice Impress itself importing with no blocker**, where before this fix wave 6 of those 14 refused and the three the final reviewer measured refused 3 of 3. This is the row that changed most: the corpus said "met" while every real file said otherwise, because no fixture had ever carried the empty `text:p` LibreOffice writes inside every shape with no text, or the `page-number` frame it writes for a slide number. Both now have corpus cases (`odp-page-chrome`) and pinned anydoc measurements. |
| 2. Every construct in design fact 6 named by a finding on the right slide | **Met, by measurement — and this is the criterion that failed first** | `odp-unrepresentable` authors an embedded Draw diagram, an inserted chart, and a video on page 1, and produces the **identical** finding PPTX produces: `presentation-unrepresentable`, `sourcePage: 1`, "Slide 1 contains 1 diagram, 1 chart, 1 media that could not be imported." Authored to be identical deliberately, so the two formats are compared on the same evidence rather than on whichever case each happened to get. |
| 3. No notes text anywhere in the imported HTML | **Met, by measurement** | `odp-speaker-notes`'s `expectNotInHtml`, plus the ODF notes path pinned against real anydoc across inline comments, nested frames, headings, tabs and soft breaks in `reconcile.browser.test.ts`. |
| 4. Shared accessibility review and cartridge export pass, packaged assets included | **Met, by measurement** | The same axe screen, run independently for ODP rather than argued from the shared code path. `odp.imscc` was rebuilt and unzipped with a real `unzip` for this verdict: 5 files, 4070 bytes, `web_resources/oer2canvas/image1-b81de774.png` — structurally identical to `pptx.imscc`. |

**The guard is now real.** The chart measurement is pinned in
`presentation/reconcile.browser.test.ts` and was mutation-tested three ways: removing
`META-INF/manifest.xml` from `ODP_PATTERNS`, dropping the trailing-slash manifest key lookup, and
misclassifying a diagram as a chart. Each goes red. The fixture writes the sub-document and its
manifest row, so the datum a correct fix reads is actually present — the omission that let an
earlier version of this guard pass against a working fix.

**And `odp-unrepresentable` was itself vacuous for exactly the half it was added to close.** The
corpus asserted warning CODES, and `presentation-unrepresentable` is ONE code covering diagrams,
charts, media and unimportable pictures — so with the chart and diagram classifier deleted, the
page's video alone kept the case green. Measured: all three classifier mutations left it passing,
while this Answer cited it as criterion 2's measurement. That is the same defect as a guard test
that cannot go red, one level up, and it is the third time this issue has produced it.

`pptx-unrepresentable` had the identical weakness — delete PPTX's diagram and chart counts and
its video still raises the code — so the fix is general rather than local: a corpus case can now
declare `expectFindingMessages`, asserting that the finding's MESSAGE names each construct, and
both cases assert `1 diagram, 1 chart, 1 media`. A chart-only ODP case would have closed one
instance of a defect present in both formats. Re-run against the same three mutations, the corpus
now goes **red every time**, where it was green every time.

**One ODF-specific limitation, stated rather than hidden.** The `ObjectReplacements/` preview
LibreOffice saves beside an embedded object is a VCL GDI metafile this importer cannot package,
so a real Impress deck containing a chart raises BOTH the `presentation-unrepresentable` warning
naming the chart AND the ordinary unpackageable-image blocker naming the preview, and does not
import until the object is removed or replaced. It refuses rather than losing anything silently,
which is the behaviour this workflow wants. It is a limitation, not a bar failure: criterion 2
asks that the construct be named, and it is.

**The formats are NOT symmetric here, and an earlier draft of this Answer said they were.**
Measured end to end, both formats, and pinned in `presentation.browser.test.ts`:

| Deck | Findings |
| --- | --- |
| ODP: chart plus GDI preview | `presentation-unrepresentable` ("1 chart", `sourcePage: 1`) **and** the `embedded-content` blocker |
| PPTX: chart pasted from Excel (`p:graphicFrame > p:oleObj` plus EMF preview) | the `embedded-content` blocker **only** — `result.findings` is `[]` at the reconciler, already pinned at `reconcile.browser.test.ts` |

So a PowerPoint **pasted** chart never names the chart. The reason is that design fact 6's chart
is the `graphicData` chart uri — what PowerPoint writes for a chart INSERTED in PowerPoint — and
`pptxIndex` counts that uri, while a pasted chart is an OLE embedding that takes a different
path. ODP has no such split: every embedded object goes through the manifest, so a chart is named
whatever produced it.

**On this construct ODP is now better than PPTX.** That is a PPTX limitation, not a bar failure —
criterion 2 requires design fact 6's constructs to be named, and for PPTX they are — but it is
written into `capability.ts`'s pptx `limitations` rather than left as an asymmetry a reader would
assume away, and it is pinned in both directions.

### What real files did to this verdict

**The corpus was eleven synthetic fixtures, and it was not enough.** The final whole-branch
review did the one thing no task had done — it ran files real producers wrote, end to end — and
measured 2 of 11 real `.pptx` decks refusing outright and 0 of 3 real `.odp` files importing
cleanly. Design fact 9 had read 226 real slides' XML without running one of them through the
importer, which is exactly the gap that let this happen: reading a deck's XML tells you what the
deck says, not what anydoc does with it.

This fix wave re-ran that measurement over a larger corpus of real files: **39 real `.pptx`
decks** (PowerPoint 16 on Windows and Mac, python-pptx, Google Slides exports, and generator
templates) and **14 real `.odp` files LibreOffice Impress wrote itself** through its own
`impress8` filter. Every deck was driven through the whole importer — real Worker, real anydoc
0.2.4, real reconciler, real asset packaging — in a real browser.

| | Before this wave | After |
| --- | --- | --- |
| Real `.pptx` refused | 17 of 39 | 10 of 39 |
| …of which the presentation module's own doing | 11 of 39 | **4 of 39** |
| Real `.odp` refused | 6 of 14 | **0 of 14** |

The 10 remaining `.pptx` refusals are three kinds, and only one is this module's:

1. **A chart inserted in PowerPoint — 4 decks.** Anydoc renders a chart's cached values as a
   `<table>`; the index counts the frame as an unrepresentable chart and records no text for it,
   so the table belongs to no slide and the deck refuses. The rule is exact: every deck carrying
   a `ppt/charts/chartN.xml` refused, every deck without one imported. Pinned in
   `reconcile.browser.test.ts` in both directions (a chart WITH its part renders a table and
   blocks; the same frame WITHOUT its part renders nothing and is merely reported lost), and
   written into `capability.ts`'s pptx limitations so a user is told what to do about it.
   **It is not fixed here, deliberately.** Reproducing that table in the index means predicting
   how anydoc turns a chart's caches into rows — series order, category axis, number formatting,
   chart type — which is the class of rule that produced eleven silent misattributions in this
   module and was retired in favour of joining on identities both accounts already hold. A
   chart's table carries no such identity today. Refusing is the safe answer, and it is named.
2. **The browser asset budget — 5 decks.** `Embedded assets exceed the 8 MiB browser limit` and
   `One embedded asset exceeds the 4 MiB browser limit`, from `import/limits.ts`. Not a
   presentation defect; the released core importer's own limit, reached by photo-heavy decks.
3. **A template with no slides — 1 deck.** python-pptx's `default.pptx` has an empty `sldIdLst`,
   and anydoc itself refuses it: `presentation has no slide list`. That is the right answer for a
   file that is a template rather than a deck.

**And design fact 6 was wrong about charts.** It says anydoc drops a chart entirely. That is true
only of a chart frame with NO chart part — which is what every fixture in this repo wrote, and
why nothing caught it. Given the cached values PowerPoint stores so a reader need not open the
workbook, anydoc renders the chart as a data table instead. Both halves are now pinned, so the
fact is a measurement rather than a recollection.

**Four defects were found this way and by no other method**, all of them ordinary rather than
adversarial, and none of them reachable from the corpus as it stood:

| Defect | What it did | Reach |
| --- | --- | --- |
| `p:ph type="ftr"`/`"sldNum"`/`"dt"` read into `textRuns` | one cached slide number refused a 27-slide deck | 4 of 15 distinct real decks, 48 of 143 slides |
| an empty ODF `text:p` ends the slide | `432 blocks of content belong to no slide` out of 434 | 8 of 14 real `.odp`, one with 99 empty paragraphs |
| a `page-number` frame's literal `<number>` | every page showing a slide number refuses | 8 of 14 real `.odp` |
| a zero width space in a run | anydoc drops it, the index keeps it, the deck refuses | a real 13-slide teaching deck, 4 occurrences |

Each is now pinned by a measurement against real anydoc (one placeholder type, one presentation
class, or one character per otherwise identical package) AND by a corpus case that carries the
shape end to end, and each pin was mutation-tested — ten mutations in all, each turning red
exactly the assertions it should.

**The real-file harness is not committed.** It reads decks from this machine's own Documents,
OneDrive and caches, and those files are not ours to check in. What IS committed is every shape
they exposed, as a fixture: `placeholders` and `chartWithData` on `PptxSlideSpec`, `chromeFrames`
and `emptyCustomShape` on `OdpPageSpec`, and the `pptx-slide-chrome` and `odp-page-chrome` corpus
cases. The disclosure that stood before this wave stands after it, one level up: **no real deck
of any kind is committed to this repository**, and the only defence against that is to keep
running real files.

### Residuals stated as limitations, not as bar failures

- **The residual behind criterion 1 is not `walkShapes`' shape-kind enumeration. An earlier
  draft of this Answer said it was, and that was wrong in a way that pointed the next reader at
  the wrong file.** `walkShapes` already covers every child of `CT_GroupShape` that can carry
  text; the two defects real decks actually produced were both a MISSING FILTER INSIDE a branch
  it already had. No audit of the shape-kind enumeration would have found either:

  - `p:sp` read the footer, slide-number and date placeholders anydoc renders nothing for. Not
    exotic: the most common optional feature in PowerPoint, on 4 of the 15 distinct real decks
    on this machine and 48 of their 143 slides. One cached slide number refused a whole 27-slide
    deck, and `document.ts` throws on a presentation blocker, so the user was returned to the
    file picker with no page and nothing saying what had happened.
  - The OLE branch collected every `p:oleObj` at any depth, where PowerPoint writes one per
    `mc:AlternateContent` branch. It got the right answer only because PowerPoint writes the same
    `r:id` in both — coincidence, not design.

  **The real residual is that the index's walk and anydoc's rendering are two independent
  implementations, and only a measurement can tell you where they differ.** That is true of the
  ODP walk's one-sentence rule too: the rule is a compression of eleven measurements, not a proof.
  What changed this round is the method that finds the differences — running files real producers
  wrote, end to end — and every defect this wave fixed was found that way and by no other.
- **ODP's one-sentence walk rule governs TEXT AND PICTURES, and not the loss counters.** "A
  shape's own content is read; a shape nested inside another shape is not entered" is exact for
  the two things the two accounts must AGREE about, because a part the index collects and no
  block carries is a refusal. The `draw:object` and `draw:plugin` LOSS counters deliberately do
  not obey it: they are any-depth. That is a choice, not an oversight — anydoc renders nothing
  for an embedded object or a media plugin at any depth (measured, including one nested inside
  another frame), so obeying the rule there would report FEWER real losses without making any
  account agree better, hiding a video from the reader because of where its author put it. An
  earlier draft of this Answer stated the rule without that qualifier, which would have let a
  reader audit the counters against a rule they were never meant to follow. Both directions are
  pinned: the nested media is counted, and it contributes no text and no picture.
- **Picture attribution is closed for one property and open for another.** Closed
  unconditionally: a picture block can never be published under a slide that does not reference
  its origin part, whether or not a blocker fires. Open: WHICH INSTANCE of a shared media part
  lands under which slide still rests on the index and anydoc agreeing about which shapes produce
  blocks. The last adversarial review could still construct one — the eleventh — but it needs a
  producer that writes more than one blip reachable in a single fill, and neither PowerPoint nor
  Impress does. **That last sentence is argument, not measurement:** it rests on what two
  authoring tools were observed to write, not on a proof that nothing else can.
- **The mirror direction is structurally invisible.** anydoc emitting a block the index knows
  nothing about cannot be detected by the index. No reviewer could construct one; every candidate
  resolved to "anydoc emits nothing either". Recorded as a residual **with no measurement either
  way**, which is the honest status rather than a clean bill.
- **Two different screens for "this file cannot be imported."** A deck with an anydoc-level
  blocker (an unpackageable EMF or GDI metafile) returns an `ImportResult` and lands in the plan
  editor with a disabled Prepare button; a reconciler-level blocker throws back to the file
  picker. Both are correct — one has trustworthy HTML to show and the other does not — but the
  difference is not explained to the user anywhere. Not a bar criterion; recorded in
  `docs/RELEASE-ACCEPTANCE.md` so the screen-reader run watches for it, and left as a follow-up.
  It is now the more visible of the two, because a real Impress chart takes exactly this path.
- **The reconciler blocker discards the deck's other findings**, so a refused deck shows one
  sentence where there may also have been speaker-notes and untitled-slide warnings. Not a bar
  criterion. It was recorded as "worth revisiting only if the refusal rate on real decks proves
  high"; the refusal rate has now been measured twice, and at 4 of 39 real `.pptx` and 0 of 14
  real `.odp` the answer is that it is not high enough to force this. It stays a follow-up, but
  the trigger is no longer hypothetical — it has been evaluated.

### One methodological note, recorded because it changed the outcome

Every ODF judgement in this issue before the review rested on the ODF specification, hand-built
XML, and out-of-band probes — against PPTX's design fact 9, a survey of 226 slides across 34 real
decks. The one measurement taken from a file LibreOffice actually wrote overturned a format
verdict. Design fact 9 was worth its cost for the same reason, and the pattern is the same one
this whole issue keeps re-learning: for these two formats, a claim about what a producer writes
is worth nothing until a producer has written it.

**And the disclosure that made that risk visible still stands, so it is repeated here rather than
retired now that the verdict improved.** NO REAL `.odp` WRITTEN BY IMPRESS EXISTS IN THIS
REPOSITORY. `odpFixture` writes synthetic ODF, authored to match what LibreOffice was measured to
write; the real file was driven through the importer out of band during review and was never
committed. Hand-built ODF produced the wrong verdict once. Dropping this sentence at the moment
the verdict got better would be exactly the wrong direction, which is why an earlier draft of
this Answer losing it is itself recorded.

### Criteria

1. **Corpus covers PPTX, PPTM, PPSX, PPSM, and ODP.** Eight PPTX cases spanning a semantic
   lecture deck (bulleted body plus a data table), a described image packaged through the
   cartridge, an untitled slide, speaker notes, a diagram/chart/video slide, the `.ppsx`
   slideshow container, and a macro-bearing `.pptm`; `.ppsm` is exercised with its real extension
   in `presentation.browser.test.ts`, and `pptx-slide-chrome` — a deck carrying the footer,
   slide number and date PowerPoint's Header & Footer dialog adds, added by the final fix wave
   because that shape alone refused 4 of the 15 distinct real decks on this machine. Five ODP
   cases: a packaged described image, `odp-page-chrome` (a real Impress `page-number` frame, a
   footer frame, and the empty `text:p` Impress writes inside every text-free shape — the shape
   that refused 6 of 14 real `.odp` files), a semantic deck
   with a table, speaker notes, and `odp-unrepresentable` — which was added by an earlier task
   precisely because without it ODP would have passed the bar's fact-6 criterion **vacuously**,
   which is the reverse-engineering the design committed the bar in advance to prevent. Every
   case declares what it stands in for and asserts its exact blocker AND warning sets. Equations
   and ambiguous reading order are covered by the reconciler suites rather than the corpus — an
   equation blocks via the inherited `docx-equation`/`epub-equation` path (design fact 7), and
   title-out-of-order raises `presentation-reading-order`.
2. **Evidence-based support status.** The two tables above, per format, per criterion, with the
   measurement and the file it lives in — including the first pass's failed verdict, why it was
   wrong, and what measurement overturned it.
3. **Stable pages with visible slide provenance and editable titles.** A deck proposes ONE page
   whose slides are `<section data-slide="N">` blocks; `blocksOf` sees each section as one
   top-level block with no top-level heading to split on, so the existing "no repeated heading"
   path proposes a single page rather than thirty near-empty ones. Provenance appears in three
   places that never edit a title the author wrote: an untitled slide's generated title is
   `Slide N`, each section heading carries an id, and `data-plan-label` makes the plan editor's
   split points read as slide boundaries. Titles are editable like any other in the plan editor.
4. **Specific findings.** `presentation-untitled-slide`, `presentation-reading-order`,
   `presentation-speaker-notes`, `presentation-unrepresentable` (naming the slide, the kind, and
   the count — now including an ODF embedded chart and diagram), the inherited equation blocker,
   the inherited undescribed-image warning, and `presentation-unattributed-content` as a blocker.
   Each names its slides in the message and sets `sourcePage` when exactly one slide is affected
   — one finding per code rather than one per slide, because 42% of real slides carry no title
   placeholder and per-slide warnings would put a dozen near-identical entries on an ordinary
   deck.
5. **Shared accessibility and cartridge workflow.** Proven for both formats end to end, each
   independently rather than argued from the shared path, including a packaged asset inside
   `web_resources/` read back by a real `unzip`. Task 11 also found that NO corpus case for ANY
   format had previously carried a packaged image through that path, so this closed a gap in the
   prior release's evidence too, not only in this one's.
6. **Formats that do not meet the bar remain disabled without weakening the released core
   importer.** No format ended disabled — but this criterion was genuinely exercised rather than
   waived: ODP *was* set to `probe-only`, its `RELEASED_SOURCES` entry removed and its corpus,
   accessibility and cartridge rows deleted, and nothing in the released importer was relaxed to
   accommodate it at any point. The capability gate that refuses a probe-only format is unchanged
   and still there; `capability.test.ts` pins the probe-only set exactly, by name, so parking a
   format there in future requires a diff that says which one.

**Gate:** `npm run verify:release` — criteria 1–7 all `[PASS]` on their enforced halves; the two
MANUAL rows report `NEVER RUN` for Firefox/screen reader (criterion 2) and live Canvas
(criterion 7), exactly as issue 13 defined them. Suite: 138 files, 1537 tests, green;
`npm run test:artifacts` 12 + 12 green.

**Verdict after the real-file measurement: both formats still graduate, and ODP now graduates on
stronger evidence than PPTX.** ODP imports 14 of 14 real Impress files with no blocker. PPTX
imports 29 of 39 real decks, and the 4 refusals that are this module's own doing are one named,
pinned construct — an inserted chart — stated in `capability.ts` so a user is told what to do
about it. Refusing is not the outcome anyone wants, but it is the outcome this module was built
to produce when the two accounts disagree, and it is the only remaining one.
