# Decide and gate spreadsheet imports — design

**Issue:** [`issues/16-decide-spreadsheet-imports.md`](issues/16-decide-spreadsheet-imports.md)

**Blocked by:** 13 — resolved.

## What this issue is for

Issue 14 asked whether a deck can become a page a person can trust, and answered by
measuring. This issue asks the same question of a spreadsheet, and the answer has to be
decided against a harder bar, because a spreadsheet's whole content is one HTML element
this project already treats as a hazard.

A worksheet is a grid. A grid is *not* an accessible HTML table. `<table>` claims that the
cells in a row belong to one record and that some cells label others; a worksheet claims
neither. Excel and Calc hold a rectangle of values and render header-ness with bold and
borders, which are not semantics. So the question is not "does the parser accept an XLSX"
— it does, and it accepts a legacy `.xls` too — but **"can a worksheet become a `<table>`
whose structural claims are true?"**

The measurements below say: not from anydoc's output, and not from a second reader either,
because the fact a `<table>` needs most is a fact the file format does not record.

## Non-goals

- Rendering charts. anydoc emits no block and no asset for a spreadsheet chart or picture
  (fact 9), and this issue does not add a renderer.
- Recomputing formulas. Only cached values are available (fact 7) and nothing here
  evaluates a formula.
- Deciding `.xlsb`, `.xlsm`, `.tsv`, Numbers, or Google Sheets exports. Only the four
  formats already in `ImportedFormat` — `xlsx`, `xls`, `ods`, `csv` — are in scope.

## Measured facts

All measured **2026-08-30** against `@firecrawl/anydoc-wasm` 0.2.4, the version this repo
ships, driven from Node via `initSync` on the same `anydoc_wasm_bg.wasm` the browser Worker
loads. Probes are throwaway; the fixtures this issue commits reproduce every fact below.

Three sources of input, kept distinct because they carry different weight:

- **Synthetic packages** hand-authored to isolate one property at a time.
- **Real producer output**: files written by LibreOffice Calc 25.x through its own `calc8`,
  `Calc Office Open XML`, `MS Excel 97` and `Text - txt - csv (StarCalc)` filters, from one
  source document — so the same authoring intent can be compared across four formats.
- **Real user files on this machine**: 27 readable `.xlsx` (105 worksheets) and 37 `.xls`
  (141 worksheets), found with `mdfind`. **Nothing from these files appears anywhere in
  this repository.** Only aggregate counts were recorded; no cell text, no worksheet name,
  no path. They are somebody's real work.

### Detection and format identity

**1. anydoc has no `xls`. Four spreadsheet extensions collapse onto two parser paths.**
`Format` (the vendor `.d.ts`) is `doc | docx | odt | pdf | ppt | pptx | rtf | epub | xlsx |
ods | odp | csv` — there is no `xls` member. `formatFromExtension` maps `xls`, `xlsm` and
`xlsb` all to `xlsx`; `ods` maps to `ods`; `tsv` maps to `undefined`.

**2. A real legacy `.xls` is detected as `xlsx` from its content, and parses.** All **37**
real `.xls` files on this machine begin with the OLE2 signature `d0cf11e0a1b11ae1`, and
`formatFromBytes` returned `xlsx` for **every one of them**. `toDocument` then succeeded on
all 37, producing 141 worksheets and 90,525 cells with **zero** replacement characters and
zero stray control characters. So legacy BIFF is not unsupported — it is supported under
another format's name. This is issue 14 fact 1's shape exactly: separate `xls` capability
entries keyed on `format: 'xls'` could never match, because `detectedFormat` is `xlsx`.

**3. CSV has no content signature and must be named.** `formatFromBytes` returns
`undefined` for CSV bytes, and `toDocument(bytes)` with no format throws
`unsupported: "unrecognized file content: name the format explicitly"`. CSV is therefore
the only spreadsheet format whose identity rests entirely on the filename — the guard
`document.ts` uses for every other format (`parsed.formatDetection === 'content'`) cannot
be satisfied by any CSV that exists.

### Worksheet identity

**4. anydoc *does* model a worksheet — sometimes.** Unlike a slide, a worksheet has a
representation: a `heading` at level 2 carrying the sheet's name, immediately followed by
its `table`. This is a real advantage over issue 14's starting position.

**5. But the heading only appears when more than one sheet survives.** Measured on
synthetic workbooks:

| workbook | output |
| --- | --- |
| 1 sheet | `table` — **no heading, no name** |
| 2 sheets | `heading("Alpha") table heading("Beta") table` |
| 2 sheets, 2nd empty | `heading("Alpha") table` |
| 2 sheets, 2nd hidden | `table` — **no heading** |
| ODS, 1 sheet | `table` — **no heading** |
| ODS, 2 sheets | `heading("Alpha") table heading("Beta") table` |

A single-sheet workbook — the ordinary case — produces a nameless table. Across the 27 real
`.xlsx` files, **6 produced no heading at all**, and heading count matched visible-sheet
count in only **12 of 27**. An empty worksheet vanishes entirely: neither heading nor table.

### The header row — the fact that decides everything

**6. `headerRows` is a heuristic on row 1's shape, and it is wrong in both directions.**
Measured by varying one property at a time:

| first row | `headerRows` |
| --- | --- |
| text cells, then numeric rows | 1 |
| text cells, then more text rows | **1** — data announced as headers |
| numeric cells | 0 |
| text cells with one blank cell among them | **0** |
| text cells with one empty-string cell | **0** |
| a single row, nothing under it | 0 |
| first row contains a merged cell | **0** |
| a leading blank row above a text row | 1 (the blank row is trimmed) |

Two failures, not one. A worksheet whose header row has a blank corner cell — the ordinary
shape of a matrix table, where A1 is left empty above the row labels — gets **no header at
all**. And a worksheet whose first data row happens to be all text gets its **data
announced as headers** to a screen reader.

**On real files this fails far more often than it succeeds.** Over the 27 real `.xlsx`,
anydoc emitted 104 tables: **94 with `headerRows: 0`** and 10 with `headerRows: 1` — 90%
with no header cell of any kind. Over the 37 real `.xls`, **141 of 141** tables came back
`headerRows: 0`. Not one legacy worksheet in the corpus produced a single `<th>`.

**7. Merged cells are the common case, and they are exactly what turns the header off.**
**23 of 27** real `.xlsx` files carry `<mergeCell>`; every one of the 14 that carried both a
merge and a table also produced `headerRows: 0`. On the real LibreOffice-written fixture, a
genuine two-row group header (`Student` spanning two rows; `Midterm` spanning two columns
over `Score`/`Grade`) produced `headerRows: 0` and a grid whose origin cells carry
`rowSpan: 2` and `colSpan: 2`, in both XLSX and ODS.

**8. The only place a spreadsheet *declares* a header row covers 11% of worksheets.**
SpreadsheetML has exactly one authored statement of header-ness: an `xl/tables/tableN.xml`
part (Excel's "Format as Table" / ListObject), which carries `headerRowCount` and a
`<tableColumn name>` per column. Across the 27 real `.xlsx`: **12 of 105 worksheets** carry
one — 9 files of 27 — and all 12 declare `headerRowCount="1"`. ODS and CSV have no
equivalent construct at all. So the fact a `<table>` needs most is recorded in about a
ninth of real worksheets and in none of the other three formats.

### What else the model does and does not carry

**9. A spreadsheet's charts and pictures vanish without a trace.** Of the 27 real `.xlsx`,
**11 carry `xl/drawings/`, 9 carry `xl/charts/`, 1 carries `xl/media/`** — and anydoc
returned `assets: 0` for **all 27**, with no image inline anywhere. Reproduced synthetically:
a workbook with `xl/media/image1.png` referenced through a drawing with
`descr="Enrollment over time"` produced one table of one cell and **no image, no asset, no
finding**. This is issue 14 fact 6 again, but worse in kind: a slide's diagram is one part
of a slide, whereas a chart is frequently the entire point of the worksheet that holds it.

**10. Cell provenance does not exist in the model.** No A1 reference, no row or column
index, no sheet index reaches `Document`. A sparse sheet whose data starts at C5 arrives as
a dense 3×3 grid of strings with the gaps filled by `""`; nothing says the first cell was
C5. There is no key on which a second reader could join its account to anydoc's — which is
precisely what `presentation/reconcile.ts` needs and what
`PICTURE_ORIGIN_ATTRIBUTE` had to be invented to supply for decks.

**11. Displayed values are partially applied, and an error is indistinguishable from
data.** A cell holding `0.075` under a `0.00%` number format arrives as `"7.50%"`; `45000`
under built-in date format 14 arrives as `"2023-03-15"`; but `1234.5` under built-in
currency format 44 arrives as `"1234.5"` — the currency format was not applied. A formula
cell yields its **cached** value only: `A2+B2` with a cached `5` yields `"5"`, and the
formula source is never emitted. A cached error yields the error string as ordinary text
(`"#VALUE!"`, `"#DIV/0!"`, ODS `"Err:510"`), with nothing marking it as an error.

**12. A formula with no cached value silently becomes an empty cell.** `<c><f>A3+B3</f></c>`
with no `<v>` produced `""`. Real Excel always caches, so **0 of 27** real files hit this —
but tools that write XLSX without evaluating (openpyxl's default, several exporters) do
not, and such a file loses a whole computed column with no finding of any kind.

**13. Two logical tables on one sheet become one `<table>` with a false header.** Rows
`Term/Students`, `Fall/120`, blank, `Line/Amount`, `Printing/340` arrived as ONE table with
`headerRows: 1`, five rows including an empty one, and the second table's header row sitting
in the body as data. This is the ordinary shape of a report worksheet.

### Hidden content — the same intent, opposite outcomes

**14. XLSX hides; ODS leaks.** One source document, converted by LibreOffice to both
formats through its own filters, carrying a hidden sheet, a hidden row and a hidden column.
What LibreOffice wrote, verified by reading the packages:

- XLSX: `<sheet name="Salaries" … state="hidden"/>`, one `<row hidden="1">`, one
  `<col hidden="1">`.
- ODS: a `table:style-name` pointing at `<style:table-properties table:display="false"/>`,
  one `<table:table-row … table:visibility="collapse">`, one
  `<table:table-column … table:visibility="collapse">`.

What anydoc did with each:

| | hidden sheet | hidden row | hidden column |
| --- | --- | --- | --- |
| XLSX | **dropped** | **dropped** | **dropped** |
| `.xls` (same source) | **dropped** | **dropped** | **dropped** |
| ODS | **PUBLISHED** | **PUBLISHED** | **PUBLISHED** |
| CSV | n/a — the producer flattened it | published | published |

The ODS row is a privacy defect with a name: the hidden sheet in that fixture is called
`Salaries` and holds a salary figure, and anydoc emitted it as `heading("Salaries")` plus a
table. **1 of 27** real `.xlsx` files carries a hidden sheet, **8** carry a hidden row and
**1** a hidden column — so this is not a contrived shape.

The XLSX row is *not* simply the good outcome. Dropping hidden content is right for privacy
and wrong for fidelity, and it happens with no finding either way: an instructor whose grade
sheet has a hidden helper column gets a table missing a column and is never told.

**15. Nothing else leaks, and nothing executes.** Measured on synthetic packages:
`xl/vbaProject.bin` present → 0 assets, no block, never read; an
`xl/externalLinks/` part pointing at `https://example.invalid/rates.xlsx` with
`TargetMode="External"` → **no fetch**, only the cached value; a formula's *source* is never
emitted; a `xl/comments1.xml` cell comment ("Bumped from C. Do not tell the class.") →
`notes: 0` and the text absent. Cell text containing `<script>alert(1)</script>` arrives as
text and reaches `escapeHtml` in `anydoc-html.ts`. Across the 27 real files: 0 with VBA, 0
with external links, 2 with comments, 0 with pivot caches, 0 with query tables.

One residual worth naming and not blocking on: a cell whose text begins `=`, `+`, `-` or
`@` is a **CSV/Excel formula-injection** payload if the rendered table is ever pasted back
into a spreadsheet. It is inert in HTML — this importer's output — so it is a documentation
matter, not a refusal.

### CSV specifically

**16. Delimiter sniffing is real but reads only the first line, and one title line
destroys the table.** `,` `;` `\t` and `|` are all detected; quoting, embedded delimiters,
CRLF, a UTF-8 BOM, UTF-16LE and Latin-1 bytes all decode correctly (0xE9 → `é`). But a file
that opens with a title line before the real header:

```
Quarterly report
Term,Students
Fall,120
```

produced a **ragged** table — row 0 with ONE cell, rows 1 and 2 with two — and
`headerRows: 0`. Ragged output is not a corner case: `a,b,c` / `1,2` / `3,4,5,6` produced
rows of 3, 2 and 4 cells. A newline inside a quoted cell becomes a space.

**17. Ragged grids violate anydoc's own contract, and ODS produces them too.** The vendor
`.d.ts` says of `Table`: *"Canonical table grid: every logical grid position appears exactly
once."* For CSV that is false, and on the real LibreOffice ODS fixture the third worksheet
came back with row widths `[2, 0]` — one row with **zero** cells. `anydoc-html.ts` renders
each row's cells verbatim, so a ragged grid becomes `<tr>` elements with different `<td>`
counts, and a zero-width row becomes an empty `<tr></tr>`.

### Resource usage

**18. anydoc self-limits, at two ceilings the existing budgets do not know about.**
Measured by growing a fixture until it refused:

- `max_xml_nodes`: **2,000,000 per part** — `resource limit exceeded (max_xml_nodes): part
  exceeds 2000000 xml nodes`. Reached at roughly 500k–1M cells in one worksheet.
- `max_grid_slots`: **4,500,000 per workbook** — `workbook extent covers 4500000 grid
  positions`.

Both surface as `code: 'resourceLimit'`, which `anydoc.worker.ts` already maps to
`resource-limit`. So a runaway spreadsheet is refused rather than hung.

**19. The worst *legal* workbook costs 20–28 s and 1.2 GiB of WASM memory.** A deflated
`.xlsx` of 8 worksheets × 25,000 rows × 20 columns:

```
8 sheet(s) x 25000x20 = 4,000,000 cells
  .xlsx deflated: 10.83 MiB   [16 MiB budget: PASSES]
  cold parse: 20503 ms   [30,000 ms timeout: PASSES]
  blocks=16  rss 240 -> 3291 MiB
  wasm linear memory: 1204 MiB   [128 MiB budget, checked AFTER the parse: EXCEEDED]
```

Every existing gate lets this file through. It is under `maximumInputBytes` (16 MiB), under
both of anydoc's own ceilings, and it finishes inside `parserTimeoutMs` (30 s) — on an
M-series Mac in Node, which is faster than a browser Worker. And it allocates **1,204 MiB**
of WASM linear memory against a `maximumWasmMemoryBytes` of 128 MiB — **9.4× over** — which
`resultBudgetFailure` in `probe.ts` can only report *after* `toDocument` has returned,
because that is the only moment `wasmMemoryBytes` exists. The budget cannot prevent the
allocation; it can only refuse the result once the tab has already paid for it. Two cold
runs of the same fixture measured 20.5 s and 28.1 s, so the timeout margin is not
comfortable either.

The root cause is that **`maximumInputBytes` bounds compressed bytes and a spreadsheet's
cost is driven by cell count.** Sheet XML deflates about **10.5:1** (measured: 2.83 MiB of
XML → 0.27 MiB; 11.58 MiB → 1.08 MiB), so the 16 MiB ceiling admits several million cells.
That decoupling does not exist for the enabled formats: a 16 MiB DOCX holds 16 MiB of
prose-shaped content, and issue 13's benchmark measured the slowest successful parse across
every enabled format at **4,229 ms** with a high-water WASM allocation of **97,845,248
bytes**. A legal spreadsheet is five times slower and thirteen times larger than the worst
document this release has ever measured.

For scale on real files, none of this is what a real spreadsheet looks like: the largest
worksheet in the 27-file corpus is **588 rows × 7 columns**, and the slowest real parse was
**39 ms**. The hazard is a legal file, not a typical one — which is exactly the kind of
budget question this project settles before shipping, not after.

## The accessibility policy

The issue's third criterion asks when a worksheet may become an HTML table, and when it must
be split, summarized, or rejected. **This project already has that policy, and it already
applies to imported documents.** `src/engine/compile/steps/tables.ts` runs on every imported
chapter (`compileAndAuditChapter` with the `DOCUMENT` profile), and it says:

1. Every `<table>` gets a `<caption>` — the author's, or `summary`/`aria-label`, or the
   opening sentence of the paragraph that introduces it, or the literal fallback
   `'Data table'`.
2. A table with no `<th>` is **queued** for a human, who answers "row headers", "column
   headers", "both", or "this is layout".
3. Mechanical promotion is **refused**, with the item staying queued and the reason
   recorded, when the table has no rows, contains a nested table, has **a `rowspan`
   anywhere**, has **rows of differing width**, or would promote a cell with `colspan > 1`.

So the policy this issue needs is not a new policy. It is the existing one, and the decision
is whether spreadsheet output can *satisfy* it. Measured against facts 6, 7, 11, 13 and 17,
it cannot:

| worksheet shape | what the audit does | measured frequency |
| --- | --- | --- |
| header row anydoc recognised | `<th scope="col">`; no queue item | 10 of 104 real xlsx tables |
| any header row it did not | queued for a human | 94 of 104; 141 of 141 xls |
| merged group header (rowspan) | queued, then **REFUSED** — "a cell spans more than one row" | 14 of 14 merge-bearing files |
| ragged rows (CSV title line, ODS blank row) | queued, then **REFUSED** — "the rows are not all the same width" | every CSV with a title line |
| first data row happens to be text | `<th scope="col">` on **data** — no queue item, no way to notice | not measurable from the file |

The middle two rows are the ones that decide this issue. A refused item **stays queued with
no answer available to the instructor** — the reason is recorded, they pick again, and every
choice is refused for the same structural reason. That is not a remediation workflow; it is a
card that cannot be cleared. And a spreadsheet is not a document with a table in it, so this
is not one card among many: for a single-sheet workbook it is the *entire* import.

The last row is worse than a dead end, because it is silent. `headerRows: 1` on a row of
data produces `<th scope="col">` with nothing queued, nothing flagged, and a screen reader
announcing a data row as the labels for everything beneath it. Nothing downstream can detect
it, because nothing downstream has anything to check against.

Two smaller consequences follow from fact 5. A single-sheet workbook reaches `fixTables`
with no heading and no introducing paragraph, so its caption falls all the way through to
the literal string `'Data table'` — a caption that names nothing, on the one element whose
real name (the worksheet's) the parser had and dropped. And a workbook with two or more
sheets arrives as repeated `h2` headings, which `proposeRanges` splits at the minimum
repeated heading level — one Canvas page per worksheet, including the empty-looking ones.

**The policy, stated for the record.** A worksheet may become an HTML `<table>` only when
its header structure is a fact the file states, not a shape a heuristic guessed. On this
evidence that condition is met by a declared `xl/tables/*` part and by nothing else — 11% of
real worksheets, and no ODS or CSV worksheet ever. Everything else must be **rejected**, not
split and not summarized: splitting a grid whose regions we cannot identify invents
boundaries, and summarizing a table into prose discards the data the author came to publish.

## Would a spreadsheet tracer fix this?

Issue 14's answer to a lossy parser was a second reader over the package's own XML, joined
to anydoc's output. That pattern is the obvious thing to try here, so it is worth saying
exactly where it fails rather than asserting that it does.

What a tracer **could** recover, cheaply, reusing `zip-read.ts` unchanged:

- the worksheet name for a single-sheet workbook (fact 5) — a real `<caption>`;
- ODS hidden sheets, rows and columns (fact 14) — enough to *refuse* the file, though not to
  remove the leaked cells from anydoc's output;
- the presence of charts, pictures and drawings (fact 9) — enough to warn;
- `xl/tables/*` header declarations (fact 8) — for 11% of worksheets.

What it **cannot** recover, at any price:

- **The header row for the other 89%.** It is not in the file. XLSX, ODS and CSV have no
  place to record it outside a ListObject; bold text and a border are formatting, and
  inferring header-ness from formatting is the same guess anydoc already makes badly, moved
  into this repository where we would own its errors.
- **The join.** `presentation/reconcile.ts` works because a slide and its blocks share
  identities both accounts hold — text runs, and a picture's `originPart`
  (`PICTURE_ORIGIN_ATTRIBUTE`). A worksheet has neither. Fact 10: no cell in anydoc's output
  carries a row, a column, or an A1 reference. The only alignment key left is cell *text*,
  and a spreadsheet is a grid of short repeated values where `120` appears forty times. A
  monotonic walk over that has no anchor to fail against — it would confirm alignments that
  are coincidences, which is worse than failing.

A tracer restricted to `xl/tables/*` ranges avoids both problems and is genuinely
implementable. It is also a capability that reads "import a spreadsheet" in the UI and
refuses seven of every eight real worksheets, on a distinction (did the author press
*Format as Table*?) that no instructor will predict — and it does nothing at all for `.ods`
and `.csv`, which have no such part. That is a worse product than an honest refusal, and it
is not what the issue asked for.

## Verdict, per format

Judged independently, as issue 14 judged PPTX and ODP.

| format | verdict | the measurement that decides it |
| --- | --- | --- |
| **xlsx** | **disabled** | fact 6: 94 of 104 real worksheets produce a table with no header cell, and the audit's own refusal rule (rowspan, ragged) leaves those items queued with no answer the instructor can give. Fact 19: a legal 10.8 MiB workbook allocates 1,204 MiB of WASM memory against a 128 MiB budget that cannot be checked until after the allocation. |
| **xls** | **disabled** | fact 2: it parses, and reports itself as `xlsx`, so it inherits every xlsx finding. Fact 6 is worse here: **141 of 141** real legacy worksheets produced `headerRows: 0` — not one `<th>` in the entire corpus. |
| **ods** | **disabled** | fact 14: LibreOffice's own hidden sheet, hidden row and hidden column are all **published**. A privacy leak that the format's own producer expects to be honoured is a blocker on its own, before the shared header and raggedness (fact 17) findings are counted. |
| **csv** | **disabled** | fact 16: one title line above the header turns the whole file into a ragged grid — the exact shape `refusalToPromote` refuses. Fact 3 compounds it: CSV has no content signature, so it is the only format whose identity would rest on the filename, and `document.ts`'s `formatDetection === 'content'` guard could never pass. |

CSV was considered separately throughout and deliberately not lumped in, because it is
plain text and might have deserved the plain-text treatment. It does not: it is the only one
of the four that cannot be identified from its bytes, and it is the one that produces ragged
grids most readily.

## What this issue therefore builds

No import path. Four `probe-only` capability entries, an evaluation corpus, and a browser
test that pins every fact above against the real parser — so that the day anydoc changes
one of them, this decision is re-opened by a failing test rather than by nobody noticing.

`probe-only` is the status this table already defines and PDF already occupied before issue
13 shipped it, and `capability.test.ts` already pins the exact probe-only set with a comment
inviting the next engineer to name whatever they park there. `document.ts` needs no change:
`enabledCapabilityFor` already refuses any capability whose `status !== 'enabled'`, so a
`.xlsx` selected by hand is refused by existing code — and now with the format's own
explanation visible in the picker before the user submits.

`released-sources.ts` gains a comment and no entry. That is the correct outcome of its own
reconciliation test: `probe-only` is not `enabled`, so the two hand-typed lists still agree.

### The bar, committed before the corpus is built

Following issue 14's practice of stating the bar in the design so the verdict cannot be
reverse-engineered from the fixtures. A spreadsheet format graduates only if, across its
corpus cases:

1. every worksheet's table is either given `<th>` cells that match a header the FILE
   declares, or refused — never given `<th>` cells a heuristic guessed;
2. no worksheet, row or column the author hid reaches the imported HTML;
3. every chart, picture and drawing is named by a finding on the worksheet that held it;
4. no table reaches the audit ragged or carrying a `rowspan`, since the audit will refuse
   both and leave the instructor a card they cannot clear;
5. a legal file under `maximumInputBytes` stays inside `maximumWasmMemoryBytes` and
   `parserTimeoutMs`.

None of the four formats meets criterion 1 today. `ods` additionally fails 2, all four fail
3, `ods` and `csv` fail 4, and all four fail 5.

## Testing

- **Evaluation corpus** (`src/import/testing/spreadsheet-fixtures.ts`, new): one fixture per
  property the criteria name — multiple worksheets, a two-row merged group header, a sparse
  range, formulas with and without cached values, hidden sheet/row/column in both XLSX and
  ODS, an embedded picture, a macro part, an external reference, a cell comment, two logical
  tables on one sheet, a CSV with a title line, and a large-but-legal grid.
- **Evidence test** (`src/import/spreadsheet-evidence.browser.test.ts`, new): drives each
  fixture through the REAL `probeParser` in Chromium — real WASM, not jsdom — and asserts
  the measured fact. It runs `compileAndAuditChapter` on the resulting HTML for the two
  cases that carry the accessibility verdict, so the "queued with no answer available"
  claim is checked against the real audit rather than read off this document.
- **Deliberately NOT in `CORPUS_CASES`.** That corpus is "the corpus this release's support
  claim rests on"; a disabled format has no support claim, and adding cases there would
  break its own coverage-shape test, which requires every released format to be represented.

## Residuals

- The real-file corpus is one machine's, and it is a college IT and instructional-design
  workload. It is a real distribution, not a representative one.
- 84 further `.xlsx` files live in OneDrive on this machine; reading them stalls in the
  macOS File Provider. Whatever fraction of them was measured is recorded in the issue's
  `## Answer` rather than assumed here.
- There are no `.ods` files on this machine at all, so every ODS fact rests on synthetic
  packages plus one file LibreOffice Calc wrote through its own `calc8` filter. That is
  producer-real, but it is one producer.
- Fact 19's timings are Node on an M-series Mac. A browser Worker is slower, so the 20–28 s
  figure is a floor, not a ceiling — which strengthens the verdict rather than weakening it,
  but is stated because the number was not taken where it will be paid.
