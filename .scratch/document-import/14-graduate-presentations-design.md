# Graduate presentation formats through the document workflow — design

**Issue:** [`issues/14-graduate-presentations.md`](issues/14-graduate-presentations.md)

**Blocked by:** 04, 09, 10 — all resolved as of 2026-08-29.

## What this issue is for

Every enabled format so far has been a *document*: a linear run of blocks that already
reads top to bottom. A deck is not. It is a set of slides, each a bag of shapes with a
z-order, some of which are titles, some of which are speaker notes the author never
intended a student to read, and some of which are diagrams that carry the whole point of
the slide.

The question this issue answers is therefore not "does the parser accept a PPTX" — it
does — but **"can a deck be turned into a page a person can trust?"** The issue's own
second criterion says as much: a format gets an evidence-based support status, not a
status derived from the parser not throwing.

The measurements below say the honest answer is *not with anydoc alone*. anydoc has no
slide in its model, and three classes of slide content vanish from its output without a
trace. So this design adds a second, small reader over the presentation package itself,
whose job is less to parse than to **notice what the parser lost**.

## Measured facts

Measured 2026-08-29 against `@firecrawl/anydoc-wasm` 0.2.4, driven from Node via
`initSync` with synthetic minimal packages (the probes are throwaway; the corpus this
issue builds replaces them). Recorded here so the plan does not re-derive them.

1. **Container detection collapses four extensions onto one format.**
   `formatFromExtension` maps `pptx`, `pptm`, `ppsx`, and `ppsm` all to `pptx`, and
   `formatFromBytes` returns `pptx` for all four main-part content types — presentation,
   slideshow, macro-enabled presentation, and macro-enabled slideshow. `odp` detects as
   `odp`. **Five extensions, two parser paths.**

2. **There is no slide in the document model.** `BlockKind` is
   heading/paragraph/list/table/blockQuote/codeBlock/rule/math. A slide's title
   placeholder arrives as an ordinary `heading` at level 2. Nothing carries a slide
   number, a slide count, or a boundary.

3. **An untitled slide leaves no boundary at all.** A three-slide deck whose middle slide
   has only a text box emits `heading("First slide")`, `paragraph("Body of an untitled
   slide")`, `heading("Third slide")` — the middle slide's content is
   indistinguishable from a continuation of the first.

4. **The two formats disagree about reading order.** With the title shape authored *last*
   in the slide, PPTX emits the body paragraph first and the heading second (it preserves
   `spTree` order, which is z-order and is also PowerPoint's own reading order); ODP
   hoists the `presentation:class="title"` frame to the top of its page. The same
   authoring mistake produces two different orders in the two formats.

5. **Speaker notes are emitted as an ordinary `blockQuote` inline in the slide's block
   run, in both formats, and `Document.notes` stays empty.** A presenter note and a pull
   quote are byte-identical in the output. This is the most serious finding: without a
   second source of truth, importing a deck publishes the author's private notes into a
   student-facing page, silently.

6. **Three classes of slide content vanish without a trace.** A SmartArt diagram
   (`graphicData` uri `.../diagram`), a chart (`.../chart`), and an embedded video
   (`p:pic` carrying `a:videoFile`) each produced **no block and no asset** — the slide
   imported as its heading and nothing else.

7. **Equations survive as `math` blocks** carrying LaTeX, the same shape DOCX and EPUB
   produce. Both of those block import today (`docx-equation`, `epub-equation` in the
   corpus), so a deck equation inherits that treatment rather than inventing one.

8. **Images behave normally.** A slide picture becomes an `Asset` with `originPart`
   `ppt/media/imageN.png`, and alt text comes from PPTX `descr` / ODP `svg:desc`. Absent,
   `alt` is `''` — which `anydoc-html.ts` already treats as undescribed rather than
   decorative. Tables arrive as `kind: 'data'` with `headerRows` set.

9. **A slide names its own title on the slide; the layout chain is not needed.** Measured
   2026-08-29, and unlike facts 1-8 this one is measured against **real decks**, not
   synthetic packages: every `.pptx` on this machine — 41 paths, **34 distinct decks, 226
   slides**, written by PowerPoint 16 for Windows and for Mac plus generators that leave
   `docProps/app.xml` empty — classified slide by slide from the deck's own XML, resolving
   each slide's layout part through its `slideLayout` relationship to see whether the layout
   was ever load-bearing. **It never was.** All **130** slides that had a title placeholder
   wrote the type on the slide itself — **110 `title`, 20 `ctrTitle`** — and **not one**
   identified its title only by an `idx` reference into the layout. Type-less `<p:ph idx="N"/>`
   is common (46 slides carry one) but always for a *body* placeholder, where ECMA-376's
   `body` default makes it correct — the same default fact 5's notes reading already leans on.
   anydoc 0.2.4 draws the line in the same place: a title shape carrying only `<p:ph idx="0"/>`
   comes out a `paragraph`, not a `heading`, **even with a layout part in the package that
   says `title`**. Following the chain would therefore not rescue such a slide; it would
   manufacture a disagreement between the two accounts about a slide anydoc gives no heading
   for. So `isTitleShape` stays as written, `ppt/slideLayouts/**` stays out of
   `PPTX_PATTERNS`, and an unresolvable title stays a warning.

   The surprise is the other half of the same count. **96 of the 226 slides — 42% — have no
   title placeholder at all**, 92 of them carrying no `p:ph` whatsoever: whole decks built out
   of free text boxes, with a headline that only *looks* like a title. Fact 3's untitled slide
   is not an edge case, it is the common shape of a real deck. That is an argument for the
   generated title being editable and the warning being per-slide and quiet, not for warning
   harder — and the corpus should carry a deck like this rather than only well-formed ones.

Facts 3, 5, and 6 are all the same defect wearing three hats: **anydoc's output cannot be
checked against anything.** That is what the package index exists to fix.

## Where the work happens, and why it splits where it does

Two constraints pull in opposite directions, and between them they fix the seam.

**The bytes can only be read in the Worker.** `probe.ts` transfers the input buffer:

```ts
worker.postMessage(request, [options.bytes])
```

Ownership moves. Issue 13 measured the consequence — reading `byteLength` on the main
thread afterwards returns 0. So a main-thread reader cannot see the bytes, and copying
them to keep a second view would put two copies of a 16 MiB deck in two heaps while
synchronous WASM runs, which is exactly what that transfer exists to avoid.

**The XML can only be parsed on the main thread.** A Worker has no `DOMParser` —
`probe.ts` already says so where it explains why the PDF path carries unsanitized Markdown
out: *"the main thread splits and sanitizes it, because `sanitizeImportedHtml` needs
`DOMParser`, which a Worker does not have."* Hand-rolling an OOXML scanner in the Worker to
dodge that would be a regex parser over hostile input, which is the wrong answer twice.

So the seam is: **the Worker does zip, the main thread does XML.** Selecting which parts to
extract needs no XML parser — it is path matching over the central directory
(`ppt/presentation.xml`, `ppt/slides/*.xml`, `ppt/slides/_rels/*.rels`,
`ppt/notesSlides/*.xml`, or ODP's `content.xml`) — so the Worker inflates exactly those and
returns them on `ParserProbeResult` as a `presentation?: { kind, parts }` field. That is the
pattern the PDF path already set with `detection`, `markdown`, and `unmarkedPages`.

Each unit then needs only the runtime capability it actually has, and neither needs the
other's: the zip reader is testable without a DOM, and the index parser is testable without
a Worker or any WASM at all.

## The four units

### `zip-read.ts` — named parts out of a package, in the Worker

Enumerates the central directory and inflates only the parts whose paths match, via
`DecompressionStream('deflate-raw')` — a global in both browsers and Node, which is already
why the writer's tests run in the fast `unit` project. It reads *named* parts only, never
the whole archive, so a deck with a thousand media files inflates none of them.

### `presentation/index.ts` — what the file says about itself

Parses those parts with `DOMParser` on the main thread and returns a `PresentationIndex`.
It does not extract content; anydoc does that. It answers only the questions anydoc cannot.

```ts
export interface PresentationSlideIndex {
  /** 1-based, in presentation order: `sldIdLst` order, or `draw:page` order. */
  number: number
  /** Title placeholder text as authored. Absent when the slide has no title. */
  title?: string
  /** Text runs on the slide in reading order — the key alignment is matched on. */
  textRuns: readonly string[]
  /** Notes-part text, when the slide has one and it is not whitespace. */
  notesText?: string
  /** The title placeholder is not first in reading order (fact 4). */
  titleOutOfOrder: boolean
  /** Content anydoc cannot represent, counted per slide (fact 6). */
  unrepresentable: { diagrams: number; charts: number; media: number }
}

export interface PresentationIndex {
  kind: 'pptx' | 'odp'
  slides: readonly PresentationSlideIndex[]
}
```

The zip reader is a capability this repository deliberately does not have:
`src/engine/export/zip.ts` says of itself that it "only ever WRITES", and that this is
what makes owning it cheaper than a dependency. Adding a reader changes that bargain, so
it is scoped to exactly what the index needs and no more.

That new surface takes hostile input, so entry count, declared part size, and total
inflated bytes are all checked *before and during* inflation, never after, and every part's
CRC is verified against its central-directory record. `security.browser.test.ts` gains
cases for a zip bomb, a part whose header lies about its size, and a traversal-shaped part
name. A reader that trusts its own headers is the classic way this goes wrong.

### `presentation/reconcile.ts` — aligning the two accounts

Pure, no WASM. Takes the normalized HTML's top-level blocks — via `blocksOf` from
`page-plan.ts`, which is exported precisely so a caller counts blocks the way a plan does
rather than with a second rule that could disagree — and the `PresentationIndex`, walks
both **monotonically** (never reordering, never backtracking), and returns each block
attributed to exactly one slide plus the findings the disagreements imply.

Monotonic matters. The temptation with two lists is to search for the best global
alignment, which quietly invents an order neither source claimed. A forward-only walk can
only ever confirm or fail, and failing is the outcome this design wants when the accounts
disagree.

Notes are identified by matching a `<blockquote>`'s text against the slide's `notesText`.
Where they match, the block is dropped from the output and recorded. Where a `<blockquote>`
does *not* match notes text, it is a real quotation and survives — which is exactly the
distinction fact 5 says is otherwise impossible.

Its output is one `<section data-slide="N">` per slide, wrapping that slide's blocks with
the slide's heading first. `section` and `data-*` are both already on the Canvas allowlist
(`engine/allowlist.ts`), so this survives export unchanged; `h1` is *not* on that
allowlist, which is a second reason slide titles stay at `h2` where anydoc already puts
them.

### Wiring

- **One capability entry**, not four. `importStructuredDocument` requires
  `parsed.detectedFormat === capability.format`, and fact 1 says every PPTX-family
  container reports `pptx`. Four entries with formats `pptm`/`ppsx`/`ppsm` would fail
  that check on every real file. So `pptx` is one entry carrying four extensions and four
  media types, and `odp` is a second.
- **Findings carry the slide number in `sourcePage`**, which `ImportFinding` already has
  and the PDF path already uses for pages. No new field.
- **The page plan needs one small, general seam.** `proposeRanges` splits at the *minimum
  repeated heading level*, and every slide title is an `h2` — so without a change a deck
  would propose one page per slide, which is precisely what the deck-to-page decision below
  rejects. Wrapping each slide in a `<section>` fixes this by construction: `blocksOf` walks
  `document.body.childNodes`, so a slide becomes ONE top-level block with no top-level
  heading left to split on, and the existing "no repeated heading" path already proposes a
  single page. The only addition is that `blocksOf` honours a `data-plan-label` attribute
  for a block's summary, so the editor's split points read as slide boundaries instead of
  `Section: Photosynthesis Light reactions…`. That attribute is deliberately named for the
  plan, not for slides: it is a block declaring its own label, and nothing in `page-plan.ts`
  learns what a presentation is.

## What each situation produces

| Situation | Severity | What the user is told |
| --- | --- | --- |
| Slide with no title (fact 3) | warning | The section is titled *Slide N*, editable like any other |
| Title not first in reading order (fact 4) | warning | Names the slide; content keeps the deck's own order |
| Speaker notes present (fact 5) | warning | Names the slides; the notes are not imported |
| Diagram, chart, or embedded media (fact 6) | warning | Names the slide, the kind, and the count |
| Equation (fact 7) | **blocker** | Same treatment as DOCX and EPUB today |
| A block that cannot be attributed to a slide | **blocker** | Names what could not be placed |
| Image with no alt text (fact 8) | warning | Existing undescribed-image path, unchanged |

Two of these deserve their reasoning stated rather than assumed.

**Why unattributable content blocks.** Publishing a paragraph under the wrong slide's
heading is a silent correctness error — nothing in the output looks wrong, and the reader
has no way to discover it. Issue 13 settled the same question the same way for PDF pages:
absence of evidence that a page is blank is not evidence that it is. A deck we cannot
segment is a deck this workflow has nothing honest to say about.

**Why notes are excluded rather than labelled.** They are the author's private text. A
label is a promise that every downstream consumer — the cartridge, Canvas's own renderer,
a copy-paste into an email — will keep honouring it, and none of them made that promise.
Excluding them and naming the slides that had them is the only version that cannot leak.

## Deck to pages

**A deck proposes one page, with each slide as a titled section.** Every slide title
arrives as an `h2` (fact 2), so the untouched plan would otherwise propose one page per
slide — around thirty near-empty Canvas pages for a normal lecture deck, against a
`MAX_PROPOSED_PAGES` of 100. A deck is one lesson. An instructor who wants it split has
the issue-10 plan editor, which already splits at any block boundary.

Slide provenance is visible in three places, none of which edits a title the author
wrote: an untitled slide's *generated* title is `Slide N`, so provenance appears exactly
where it would otherwise be missing; each section heading carries a stable `slide-N`
anchor; and the plan editor's block summaries name the slide, so split points read as
slide boundaries.

## The bar, committed before the corpus is built

A format graduates only if, across its corpus cases:

1. every top-level block is attributed to a slide;
2. every construct in fact 6 is named by a finding on the right slide;
3. no notes text appears anywhere in the imported HTML;
4. the shared accessibility review and cartridge export pass, packaged assets included.

Stated now, in the design, so the verdict cannot be reverse-engineered from whatever the
corpus turns out to do. PPTX and ODP are judged **independently** — fact 4 already shows
they behave differently — and either may end this issue disabled, which the issue's sixth
criterion explicitly allows.

`.pptm`, `.ppsx`, and `.ppsm` ride on the PPTX verdict, because fact 1 measured them to
be the same parser path rather than assuming it. Each still gets a corpus case proving
its container detects, and the macro-enabled pair get a security case pinning that a deck
carrying `ppt/vbaProject.bin` imports no bytes from it and packages no asset for it. We
never execute it; the test exists so that stays true.

## Testing

- **Corpus** (`testing/presentation-fixtures.ts`, new): a semantic deck per format, plus
  cases standing in for each row of the situations table. Built with `writeZip` from
  hand-written OOXML/ODF, following `structured-document-fixtures.ts`; every case names
  what it stands in for, which `corpus.test.ts` already enforces.
- **Reconciler unit tests**: the alignment walk is pure, so its whole decision table is
  testable without WASM — including the failure that blocks.
- **Zip reader unit tests**: round-trip against `writeZip`, plus the refusals.
- **Security** (`security.browser.test.ts`): zip bomb, lying header, traversal-shaped
  name, macro-bearing deck.
- **Accessibility** (`App.a11y.browser.test.tsx`): the deck import screen, matching the
  screens issue 13 added for every other tab.
- **Artifact** (`cartridge-artifact.browser.test.ts`): a deck exports, unzips under a real
  `unzip`, and its slide anchors survive.
- **Docs**: `THIRD-PARTY-NOTICES.md` and the capability limitations describe presentations
  truthfully — issue 13's doc-claims test already fails when a user-facing obligation is
  missing.

## Open question for the plan — SETTLED by fact 9 (2026-08-29)

**Answered: a title is resolvable without following the layout chain, on every real slide
measured, and anydoc resolves it no further than we do.** The index keeps requiring
`type="title"` or `type="ctrTitle"` on the slide, `ppt/slideLayouts/**` stays out of
`PPTX_PATTERNS`, and a title that cannot be resolved is an untitled slide — a warning with
an editable generated title, never a blocker. The original statement of the question
follows, unchanged.

Fact 4 was measured on synthetic packages where the title placeholder was unambiguous.
Real decks inherit placeholders from slide layouts and masters, and a slide may name its
title by layout reference rather than by carrying `<p:ph type="title"/>` itself. **The
plan's first task after the index exists must measure how often a title is resolvable
without following the layout chain**, and, if it commonly is not, decide whether the
index follows that chain or whether an unresolvable title is simply an untitled slide
(which is already a warning, not a blocker). This is a bounded question with a safe
default, which is why it is a plan task and not a blocker on this design.
