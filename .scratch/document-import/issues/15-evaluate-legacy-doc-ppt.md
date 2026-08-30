# 15 — Evaluate and conditionally enable legacy DOC and PPT files

**What to build:** Determine whether legacy DOC and PPT files can meet the same browser-only extraction, safety, semantic-quality, and Canvas-export standards as modern documents, and expose them only when the evidence supports doing so.

**Blocked by:** 13 — Harden and release the core document importer; 14 — Graduate presentation formats through the document workflow.

**Status:** resolved

- [ ] A dedicated corpus covers representative DOC and PPT content, malformed files, large files, and known conversion ambiguities.
- [ ] Browser parsing, cancellation, resource use, and extraction quality are measured against the established import budgets.
- [x] Reading order, structure, tables, links, notes, and embedded media are compared with the source using documented criteria.
- [x] Each legacy format receives a clear enabled, limited, or disabled decision with reproducible evidence.
- [ ] Any enabled format completes the same planning, accessibility-review, asset, and cartridge-export workflow as its modern counterpart.
- [x] Disabled formats produce an accurate capability message and do not appear as generally supported file types.

## Answer

**DOC: disabled. PPT: disabled.** Both are parked in `DOCUMENT_FORMAT_CAPABILITIES` as
`probe-only`, appear in no accept string, no format summary and no released source, and now
refuse by name with the way out in the message.
[`15-evaluate-legacy-doc-ppt-design.md`](../15-evaluate-legacy-doc-ppt-design.md) carries the
fourteen measured facts, all taken 2026-08-30 against real `@firecrawl/anydoc-wasm` 0.2.4
loaded from the same `anydoc_wasm_bg.wasm` the browser Worker loads.

**The measurement that decided DOC** is two silent failures pointing in opposite directions.
A one-page conference report written by Microsoft Office Word imports **442 of its 1,250
characters short — 35% of its text** — because the form's three answers live in Word text
frames that anydoc's DOC reader does not read; there is no finding, no placeholder, and
nothing visibly wrong with the page. And a document with tracked changes imports **the
sentence its author deleted**, inline and unmarked, where the same content in DOCX form
correctly excludes it. Both are attributed to the DOC reader rather than to the test setup:
LibreOffice, reading the SAME bytes, finds the text-frame paragraphs and writes the deletion
as `<w:delText>`, from which anydoc then excludes it correctly. Run through this project's
own `normalizeAnyDocDocument`, the tracked-changes page carries the deleted sentence and
**zero findings**.

**The measurement that decided PPT** is the leak issue 14 called its most serious finding,
in the form where it cannot be fixed. Speaker notes arrive as an ordinary `blockQuote`,
exactly as they do for PPTX — and a PPTX's notes are identified against `ppt/notesSlides/`
and dropped, while a `.ppt` has no package to match against. Across **27 real decks, 5
(18.5%) publish 20 quote blocks holding 5,641 characters** of text the author wrote for
themselves. Alongside it: **0 image inlines across those 27 decks**, against 267 image
payloads anydoc still extracts and 214 pictures LibreOffice reads from the same bytes —
every picture in every deck simply absent from the page, announced only by a generic
`unreferenced-asset` **warning**. Tables flatten the same way (0 against LibreOffice's 8),
and with 23 heading blocks across 27 decks there are no slide boundaries to attribute
anything to.

**"Limited" was considered for DOC and is not reachable.** A limited status needs a signal
to refuse on — the presence of a text box, or of revision marks. Both live in the same
binary structures anydoc alone parses. Detecting either means writing a CFB reader plus a
Word-97 FIB/piece-table reader, i.e. re-implementing the parser whose output we wanted to
check, with no third account to check THAT against. Issue 14's zip reader was cheap because
a ZIP is a directory of named parts and every part it read could be validated against
`writeZip` and against `unzip`; nothing about OLE2 has that property. That is the same
reason `presentation/reconcile.ts` cannot be pointed at a `.ppt`.

**What is NOT the reason, stated so a future issue does not re-litigate it.** anydoc accepts
both formats (`formatFromExtension` maps `doc`→`doc`, `ppt`/`pps`/`pot`→`ppt`), so the
vendor did not decide this. Reading order is fine: **0 inversions over 474 shared lines**
across six real Word files and **0 over 1,119** across the 27 decks. Malformed input is
fine: eight damage classes across three files, **24 of 24 refused with code `malformed` in
≤6 ms**, no hangs, no partial documents. Budgets are fine: the slowest legacy parse measured
was 17 ms for a 22.9 MB deck, peak WASM linear memory over a whole 27-file run was 90 MiB
against a 128 MiB ceiling, and legacy encodings are not systematically larger (median size
ratio 2.09 for documents, 1.03 for decks). DOC's ordinary structure is good — over 30 real
documents, headings 265/270, tables 60/60, text 99.1%. **A format that failed loudly would
be a candidate for a warning; these two fail silently, in a workflow whose whole premise is
that a finding names what went wrong before anything is published.**

**One methodological result worth keeping.** The obvious experiment — convert a modern file
to legacy, compare the two parses — is wrong, and measurably so. Converting this
repository's own `semanticDocxFixture` `.docx` → `.docx` **through LibreOffice** loses the
same headings, the same lists, and the same boundary between two adjacent tables that a
`.docx` → `.doc` conversion loses. Every attribution in the design is therefore made against
a READ-BACK of the same legacy bytes, never against the original, and
`scripts/measure-legacy-office.mjs` documents that in its own header so the next person does
not fall into it.

**What closes each ticked criterion:**

3. The design's facts 4, 6, 8, 9, 10, 11 and 12 — reading order (inversion counts over
   shared lines), structure (heading, list and paragraph counts), tables, links, notes and
   embedded media, each compared against an independent reading of the same bytes, with the
   comparison method stated in the design's *Method* section and re-runnable through
   `scripts/measure-legacy-office.mjs`.
4. Both verdicts, each with its driving measurement, above and in the design. Reproducible:
   the harness is committed, its usage block says how to obtain and read back legacy files,
   and the counts it prints are the counts the facts were computed from.
6. `capability.ts` gains `doc` and `ppt` as `probe-only` with the refusal as their first
   limitation; `capability.test.ts` pins the probe-only set to exactly `['doc', 'ppt']` and
   proves `.doc`/`.ppt`/`.pps`/`.pot` and both legacy media types appear in neither accept
   string and neither format summary (compared as whole comma-separated tokens, since
   `.docx` contains `.doc`); `document.ts` refuses a parked format by label and limitation
   before `file.arrayBuffer()`, proven by five browser cases carrying real ODT bytes under
   legacy names — reverting that branch to the generic message fails all five;
   `released-sources.ts` records the absence of a row as a decision; `README.md` says it in
   the release scope.

**What is left open, and why — these are not oversights:**

1. **No dedicated corpus was built.** Spotlight over the whole measuring machine finds **8
   files named `.doc` and 0 named `.ppt`, `.pps` or `.pot`**, and of the eight, five are
   genuine Word 97 documents, one is a DOCX misnamed, one is HTML misnamed, one is plain
   text. There is no representative real-producer material here, and the design chose not to
   commit a generated binary blob nothing in the repository could regenerate for a format
   that ships disabled. Malformed coverage exists as 24 measured variants — in the design,
   not in the suite. `testing/corpus.ts` is deliberately untouched: it lists cases that
   import successfully, and a disabled format has none.
2. **Browser parsing, cancellation and resource use were not measured for legacy input.**
   Extraction quality was, extensively, and size and memory were measured against the real
   `DOCUMENT_IMPORT_LIMITS` values — but in Node, and every fact says so where it appears.
   Measuring cancellation of a legacy parse in a browser means routing a legacy file to the
   Worker, which is the one thing this issue decided not to do.
5. **No format was enabled, so this criterion has no subject.** Ticking a box whose
   antecedent is empty would read as "the workflow was verified for a legacy format", and
   nothing of the sort was run.

**Residuals for whoever revisits this:**

- **Nothing here describes PowerPoint's own `.ppt` writer.** Every legacy deck measured was
  written by LibreOffice. If real PowerPoint-written decks appear, the one fact that could
  move is fact 12's attribution — the missing slide titles are lost by LibreOffice's writer
  rather than by anydoc, since the read-back agrees at 23 headings. Facts 9, 10 and 11 would
  not move: they are measured against a read-back of the same bytes and are properties of
  anydoc's PPT reader.
- **The frequency of the tracked-change leak is unmeasured.** The mechanism is proven; **0
  of the 7 real `.doc` files carried a deletion**, so the rate is unknown.
- **One real `.doc` in seven could not be imported even if DOC were enabled.** It is an HTML
  document carrying a `.doc` extension — Word's own save-as-HTML output, produced in bulk
  historically. `formatFromBytes` returns `undefined`
  and `document.ts`'s existing `formatDetection !== 'content'` guard refuses it. Safe, and a
  coverage gap that a "save it as .docx" instruction does not close, because the user has to
  open the file to discover it was never a `.doc`.
- **Hidden text is published by BOTH the DOC and the DOCX path.** Measured incidentally
  while isolating the tracked-changes leak: a run styled hidden imports as ordinary text in
  DOCX too. That is a pre-existing behaviour of an ENABLED format, not a legacy defect, and
  it is out of scope here — recorded so it is not lost.

**Verification**, run on this tree:

```
$ npm run typecheck
> tsc --noEmit && tsc -p tsconfig.node.json --noEmit
(no output)

$ npm test
 Test Files  138 passed (138)
      Tests  1544 passed (1544)

$ npm run build
✓ built in 843ms
PWA v1.3.0  precache 9 entries (1320.70 KiB)

$ npm run verify:release
  1. [PASS] Capability table matches corpus-tested support
  2. [PASS] Keyboard, focus, progress, cancellation, error recovery  MANUAL: Firefox and screen reader — NEVER RUN
  3. [PASS] Hostile documents, URLs, archives, credentials
  4. [PASS] Cartridges unzip; manifests, bytes, assets, determinism
  5. [PASS] Documentation states its obligations
  6. [PASS] Dependency notices complete
  7. [PASS] Production build and artifact  MANUAL: Live Canvas acceptance — NEVER RUN
```

Issue 13's criteria 2 and 7 remain `MANUAL … NEVER RUN`, unchanged by this issue and not
claimed by it.
