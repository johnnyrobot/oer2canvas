# Evaluate and conditionally enable legacy DOC and PPT — design

**Issue:** [`issues/15-evaluate-legacy-doc-ppt.md`](issues/15-evaluate-legacy-doc-ppt.md)

**Blocked by:** 13, 14 — both resolved.

## What this issue is for

Issue 14 asked whether a deck could become a page a person can trust, and answered it by
reading the file twice: once with anydoc, once from the deck's own package, so the two
accounts could be compared. That second reader is the whole reason PPTX and ODP graduated,
and its opening premise was that **anydoc's output cannot be checked against anything**
unless something else in the file says what the file contains.

Legacy DOC and PPT are OLE2/CFB compound files. There is no zip, no XML, no manifest, and
no part names — nothing a second reader could read without becoming a second full
implementation of the binary format. So this issue starts one rung lower than issue 14 did:
not "can the second account be built" but **"is anydoc's account, alone and unchecked, good
enough to publish?"**

The answer this design reaches is no, for both formats, on measurements that name what
would go wrong and where. Neither format is enabled. The work that ships is the accurate
refusal the issue's sixth criterion asks for, and the record that says why.

## Method, and the confound it had to survive

Everything below is measured against real `@firecrawl/anydoc-wasm` 0.2.4, driven from Node
via `initSync` with the same `anydoc_wasm_bg.wasm` the browser Worker loads. Measured
2026-08-30, on macOS 26.4, with LibreOffice 26.2.4.2 as the file producer where a real file
did not exist.

LibreOffice is used **twice, for two different jobs**, and the second one is what makes the
attributions here trustworthy:

- as a **writer**, converting real `.docx`/`.pptx` into `.doc`/`.ppt` (`--convert-to
  'doc:MS Word 97'`, `'ppt:MS PowerPoint 97'`), because a corpus of legacy files does not
  otherwise exist on this machine (fact 2);
- as an **independent reader** of those same legacy bytes, converting each `.doc`/`.ppt`
  BACK to `.docx`/`.pptx` and parsing THAT with anydoc. Content that survives the read-back
  but not anydoc's own legacy reading is content **anydoc's legacy reader lost**, on bytes
  both readers were handed.

The second job exists because the naive comparison is wrong, and measurably so. Converting
the repository's own `semanticDocxFixture` to `.doc` loses its headings, its lists, and the
boundary between two adjacent tables — but converting that same fixture `.docx` → `.docx`
**through LibreOffice loses exactly the same things**. Every one of those losses belongs to
LibreOffice's reading of a hand-authored package, not to the legacy format and not to
anydoc. A modern-versus-legacy comparison would have blamed the parser for all three. No
attribution below is made that way; each is made against the read-back of the same bytes.

Where a real file exists, a real file is used: five genuine Microsoft-Word-written `.doc`
files carry facts 3, 4 and 6.

## Measured facts

Recorded here so the plan does not re-derive them, and so the verdict is checkable.

1. **The parser accepts both formats, and does not decide this issue.**
   `formatFromExtension` maps `doc`→`doc`, `ppt`→`ppt`, `pps`→`ppt`, `pot`→`ppt`
   (`dot`→`undefined`, `xls`→`xlsx`), and anydoc's `Format` union declares `doc` and `ppt`
   alongside the formats this release ships. `formatFromBytes` identifies both from their
   OLE2 stream names. Nothing refuses these files at the door; **whether to expose them is
   entirely this issue's judgement, not the vendor's.**

2. **There is no representative legacy corpus to be had.** Spotlight over this whole
   machine finds **8 files named `.doc` and 0 named `.ppt`, `.pps`, or `.pot`.** Of the
   eight: five are genuine `Composite Document File V2` documents written by Microsoft
   Office Word, one is a DOCX with a `.doc` extension, one is an HTML document with a
   `.doc` extension, and one is a plain-text file from a Python distribution. **Every
   legacy deck measured in this document was written by LibreOffice**, so nothing here
   describes what PowerPoint's own `.ppt` writer produces — a gap that cannot be closed
   from this machine.

3. **Content detection is trustworthy on a mislabelled file, and one real file in seven is
   unreadable.** The DOCX-named-`.doc` detects as `docx` and parses; the HTML-named-`.doc`
   returns `undefined` from `formatFromBytes` and throws `unsupported`. `document.ts`'s
   existing guard (`parsed.formatDetection !== 'content'`) would refuse it with an accurate
   message. That is safe behaviour — and it also means **one of the seven real `.doc`-named
   files on this machine could not be imported even if DOC were enabled**, because "a `.doc`
   that is really Word HTML" is a shape the format's own history produced in bulk.

4. **Reading order is not a defect.** Comparing the text lines both readers produced from
   the same bytes, in each reader's order: **0 inversions over 474 shared lines** across the
   six parseable real `.doc` files, and **0 inversions over 1,119 shared lines** across 27
   legacy decks. Whatever anydoc's legacy readers get wrong, they do not reorder it.

5. **Malformed OLE2 refuses cleanly and fast.** Eight damage classes — truncation to 50%,
   to 10%, header only, zeroed DIFAT, a directory start sector out of range, an absurd
   sector shift, a self-referential FAT, and 200 flipped bytes — applied to two real `.doc`
   files and one `.ppt`: **24 of 24 refused with code `malformed`, each in ≤6 ms**, none
   hung, none returned a partial document. The disable verdict below is NOT a verdict about
   parser fragility.

6. **DOC silently drops text-box content — measured on a real Word file.** A one-page
   conference-attendance report (34,816 bytes, `Name of Creating Application: Microsoft
   Office Word`; the file is a private institutional document, so it is described rather
   than named or quoted here): LibreOffice reads 14 non-empty text lines from it, anydoc
   reads 11, and the three anydoc is missing are the form's ANSWERS — the three paragraphs
   the report exists to carry. All three live in Word text frames (`w:txbxContent` in the
   read-back, inside a `wps:txbx` on a `txBox="1"` shape). **442 of 1,250 characters, 35%
   of the document's text, is absent from the import with no finding, no placeholder, and
   no visible gap.** The same content in DOCX form imports: anydoc reads text boxes there.
   It is the DOC reader, not the construct.

7. **DOC publishes tracked-change DELETED text as body text.** A document carrying one
   deletion, one insertion, one comment and one hidden run, written by LibreOffice to both
   `.docx` and `.doc`:

   | | DOCX | DOC |
   | --- | --- | --- |
   | deleted text | excluded | **published, inline, unmarked** |
   | inserted text | published | published |
   | comment | dropped | dropped |
   | hidden text | published | published |

   The DOC import reads `Before the deletion.DELETEDTEXT the grant application was rejected
   After the deletion.` LibreOffice reading the SAME `.doc` bytes writes that text as
   `<w:delText>`, from which anydoc then correctly excludes it — so the revision mark is in
   the file and **anydoc's DOC reader ignores it**. Run through this project's own
   `normalizeAnyDocDocument`, that page carries the deleted sentence and **zero findings**.
   Frequency is unmeasured: **0 of the 7 real `.doc` files carried a deletion**, so this is
   a proven mechanism, not an observed rate.

8. **DOC's structure is otherwise good.** Thirty real documents, LibreOffice-written `.doc`
   against LibreOffice's read-back of those same bytes: headings **265/270**, tables
   **60/60**, lists **235/246**, text **204,294/206,149 characters (99.1%)**, images
   **76/121**. The 45-image deficit is 41 repeated bullet glyphs in one document plus one
   image in each of four others. Nothing about DOC's ordinary prose, headings or tables is
   the problem here.

9. **PPT drops EVERY picture from the page while keeping its bytes.** Across the 27 legacy
   decks: **0 image inlines**, against **267 image payloads extracted into
   `Document.assets`** and **214 pictures LibreOffice reads from the same bytes**. A
   picture is not a placeholder, not a finding, not an `[Embedded image]` span — it is
   simply not in the output. Run through the project's own normalizer, the ONLY signal a
   deck whose every picture vanished produces is one `warning`:

   > This PPT contains an embedded asset (for example, an object payload) that no visible
   > content refers to. It was not included in the export.

10. **PPT flattens every table.** 0 tables against LibreOffice's 8 on the same bytes; the
    cells arrive as loose paragraphs (`Stage`, `Location`, `Calvin cycle`, `Stroma`) with
    nothing recording that they were a table.

11. **PPT publishes the presenter's private notes.** Speaker notes come out as an ordinary
    `blockQuote`, exactly as issue 14's fact 5 measured for PPTX — and for PPTX the
    reconciler identifies them against `ppt/notesSlides/` and drops them. For PPT there is
    nothing to match against. Measured through `normalizeAnyDocDocument`, a deck's imported
    HTML contains `<blockquote><p>PRIVATE NOTE remind the class the quiz is
    Friday</p></blockquote>` — a note authored in this issue's own fixture, quoted here
    because it is the one note in the measurement that belongs to nobody. Across the 27 real
    decks, **5 decks (18.5%) publish 20 note blocks totalling 5,641 characters** of text an
    author typed for themselves: presenter reminders, a legal-obligation crib for a training
    session, and arithmetic worked out off-slide. Those are private documents, so they are
    counted rather than quoted. Issue 14 called this class of leak "the most serious
    finding" and refused to ship a labelled version of it; here it cannot even be labelled.

12. **A legacy deck has no slide boundaries to recover.** 23 heading blocks across 27 decks
    (against 114 in the same decks' PPTX form). The read-back agrees at 23, so the title
    placeholders are gone from the binary as LibreOffice wrote it rather than lost by
    anydoc — but the file that would reach this importer has no slide titles in it either
    way, and no `sldIdLst` to count slides from. Issue 14's `<section data-slide="N">`
    output, its `Slide N` generated titles, its per-slide findings and its refusal on
    unattributable content all rest on knowing where a slide starts. None of that is
    reachable.

13. **The remedy issue 14 built cannot be applied.** `zip-read.ts` reads named parts from a
    ZIP central directory; `presentation/index.ts` parses those parts with `DOMParser`;
    `presentation/reconcile.ts` walks the two accounts monotonically. An OLE2 compound file
    has none of the three inputs. Building the equivalent means writing a CFB reader plus a
    Word-97 FIB/piece-table reader or a PowerPoint records reader — i.e. re-implementing
    the very parser whose output we wanted to check, and then having no third account to
    check THAT against. Issue 14's zip reader was cheap because zip is a directory of named
    parts and every part it read could be validated against `writeZip` and against `unzip`.
    Nothing here has that property.

14. **No budget decides this either.** Legacy encodings are not systematically larger:
    median legacy/modern size ratio **2.09** over the 30 documents and **1.03** over the 27
    decks (totals 0.89x in both cases). Parse times are trivial — the slowest legacy parse
    measured was **17 ms** for a 22.9 MB deck — and peak WASM linear memory over a whole
    27-file sequential run was **90 MiB**, under the 128 MiB ceiling. Two decks exceed
    `maximumInputBytes` (16 MiB) in legacy form; four of the same decks exceed it in modern
    form. `DOCUMENT_IMPORT_LIMITS` needs no new value and no legacy exception.

## The bar

**Issue 14's bar, unchanged**, because these are the same two questions about the same two
kinds of file and a second bar written after the measurements would be a bar written to fit
them:

1. every top-level block is attributed to a slide (presentations only);
2. every construct the parser cannot represent is named by a finding in the right place;
3. no notes text appears anywhere in the imported HTML;
4. the shared accessibility review and cartridge export pass, packaged assets included.

Plus the two this issue's own criteria add, which apply to a document as well as a deck:

5. content present in the file is either imported or named — nothing disappears silently;
6. content absent from the published document (a deletion, a note) is never published.

## Verdicts

### DOC — **disabled**

The driving measurements are **fact 6 and fact 7**: a real Word file loses 35% of its text
with no finding, and a document with tracked changes gains a sentence its author deleted,
also with no finding. Criteria 5 and 6 fail in opposite directions at once — the import both
omits what is there and publishes what is not — and fact 13 says neither can be detected
from inside the browser, because there is no second account of a `.doc` to detect it with.

Everything else about DOC is fine (facts 4, 5, 8, 14), which is precisely why the two that
are not fine are disqualifying rather than merely regrettable: a format that fails loudly
teaches its user something, and this one fails silently in a workflow whose whole premise
is that a finding names what went wrong before anything is published.

**"Limited" was considered and is not reachable.** A limited status needs a signal to gate
on — refuse the file when it has a text box, or when it has revision marks. Both live in
the same binary structures anydoc alone parses; detecting either means writing the reader
whose absence is the problem (fact 13). There is no cheap discriminator, so there is no
honest partial exposure.

### PPT — **disabled**

The driving measurements are **fact 11** (5 of 27 real decks publish 5,641 characters of
the presenter's private notes, with no way to tell a note from a pull quote) and **fact 9**
(every picture in every deck disappears from the page, announced only by a warning that
says an unnamed "embedded asset" was not exported). Criterion 3 fails outright, criterion 2
fails for pictures and tables, and criterion 1 has no subject because fact 12 leaves no
slides to attribute blocks to.

PPT is the clearer of the two verdicts, and it fails the bar that PPTX and ODP passed one
issue ago on exactly the axis that bar exists to test.

## What ships

A verdict is not a deliverable on its own. Three small things carry it:

- **Two `probe-only` capability entries**, for `doc` and `ppt`. `capability.ts` already has
  that status and `capability.test.ts` already pins the probe-only set to `[]` with a
  comment saying "a later engineer who parks some format here has to say so in a diff that
  names it". This is that diff. A probe-only entry appears in NO accept string, NO format
  summary, and NO released source — `DOCUMENT_FILE_ACCEPT`,
  `STRUCTURED_DOCUMENT_FILE_ACCEPT`, `IMPORTABLE_DOCUMENT_CAPABILITIES` and
  `releaseEnabledFormats()` all filter on `status === 'enabled'` — so the reconciliation
  test in `released-sources.test.ts` stays green with `RELEASED_SOURCES` untouched, which
  is exactly the behaviour that test was written to have.
- **A refusal that names the format and the fix.** Today `capabilityForFilename('x.doc')`
  returns `undefined` and `importStructuredDocument` says "Choose a supported document file
  (.docx, .odt, …)" — true, but it does not tell someone holding a `.doc` what to do. With
  the entry present, `document.ts` can say what the file is, that it is not imported, and
  that saving it as `.docx` (or `.pptx`) works. That is the issue's sixth criterion, which
  asks for an ACCURATE capability message and not merely a refusal.
- **The measurement harness**, as `scripts/measure-legacy-office.mjs`, so the evidence
  above is re-runnable against a later anydoc rather than only re-readable. It takes a
  directory of files and prints the same per-file structure counts these facts were
  computed from. It touches nothing the app imports.

**No binary fixture is committed.** Every fixture in `src/import/testing/` is generated by
code the repository owns, from text, ZIP or XML; a `.doc` or `.ppt` fixture would be an
opaque blob produced by LibreOffice on one developer's Mac that nothing in the repository
could regenerate or explain. For a format that is disabled, the case for carrying that blob
is weak, and the tests that matter — that the format is refused, and that it appears in no
supported-format list — need no legacy bytes at all.

## What this issue does NOT establish

Stated plainly, because the issue's criteria will be left unticked for these reasons:

- **No dedicated corpus was built** (criterion 1). Fact 2 says the raw material for a
  representative one does not exist here, and the design chooses not to commit generated
  binaries for a disabled format. Malformed coverage exists as fact 5's 24 measured
  variants, but it lives in this document, not in the suite.
- **Browser parsing, cancellation and resource use were not measured for legacy input**
  (criterion 2). Extraction quality was, extensively, and fact 14 measures size and memory
  against the real budgets — but in Node. Measuring cancellation of a legacy parse in a
  browser means routing a legacy file to the Worker, which is the thing this issue decided
  not to do. Facts 5 and 14 are the honest substitute, and they are labelled as Node
  measurements everywhere they appear.
- **Nothing describes PowerPoint's own `.ppt` writer** (fact 2). If a future issue obtains
  real PowerPoint-written decks, fact 12's attribution — title placeholders lost by
  LibreOffice's writer rather than by anydoc — is the one that could move. Facts 9, 10 and
  11 would not: they are measured against the read-back of the same bytes, so they are
  properties of anydoc's PPT reader, not of the producer.
- **The frequency of fact 7's leak is unknown** (0 of 7 real files). The mechanism is
  proven; the rate is not.
