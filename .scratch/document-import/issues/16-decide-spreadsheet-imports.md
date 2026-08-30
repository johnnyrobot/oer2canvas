# 16 — Decide and gate spreadsheet imports

**What to build:** Establish whether browser-parsed spreadsheets preserve enough worksheet identity, cell provenance, and table structure to produce accessible Canvas content; either define a narrow implementable spreadsheet tracer or keep the capability explicitly disabled with evidence.

**Blocked by:** 13 — Harden and release the core document importer.

**Status:** resolved

- [x] The evaluation corpus covers multiple worksheets, headings, merged cells, formulas, hidden content, sparse ranges, and large tables.
- [x] The browser parser is assessed for worksheet identity, cell order, provenance, displayed values, and resource usage.
- [x] An accessibility policy defines when a worksheet can become an HTML table and when it must be split, summarized, or rejected.
- [x] Security and privacy checks cover formulas, external references, macros, hidden data, and unexpected embedded content.
- [x] The outcome is a documented enablement decision backed by fixtures and measurements.
- [x] If feasible, the decision includes acceptance-ready boundaries for a narrow vertical implementation ticket; otherwise spreadsheet selection remains unavailable with an accurate explanation.

## Answer

**All four formats stay disabled. `xlsx`, `xls`, `ods` and `csv` are now `probe-only`
entries in `DOCUMENT_FORMAT_CAPABILITIES`, each carrying its own explanation, and no import
path was added or changed.** `enabledCapabilityFor` in `document.ts` already refuses any
capability whose status is not `enabled`, so the entries exist to tell a user *why* before
they submit — which is what this issue's sixth criterion asks for when the answer is no.

The design is
[`16-decide-spreadsheet-imports-design.md`](../16-decide-spreadsheet-imports-design.md); its
twenty measured facts were taken 2026-08-30 against `@firecrawl/anydoc-wasm` 0.2.4 and are
pinned by `src/import/spreadsheet-evidence.browser.test.ts` (26 assertions, real WASM in the
real Worker).

### The verdict per format, and the measurement behind each

| format | verdict | decided by |
| --- | --- | --- |
| **xlsx** | disabled | **204 of 252** real worksheets came back with `headerRows: 0` — no header cell of any kind. **33 of 33** real files carrying a merged cell lost their header, and a merged header is a `rowspan`, which the repo's own table audit then refuses to promote under *any* answer. |
| **xls** | disabled | anydoc has no `xls` format; `formatFromBytes` reported `xlsx` for **all 37** real OLE2 workbooks and parsed every one. So it inherits every xlsx finding, and its own is worse: **141 of 141** legacy worksheets produced a table with no header cell. |
| **ods** | disabled | it **publishes content the author hid**. On a file LibreOffice Calc wrote through its own `calc8` filter, a hidden sheet (name and salary figure), a hidden row and a hidden column all reached the imported HTML — where the same source saved as `.xlsx` dropped all three. |
| **csv** | disabled | one title line above the header — what most reporting tools export — makes the whole file **ragged**, which is the other shape the audit refuses. And CSV carries no signature in its bytes, so `document.ts`'s `formatDetection === 'content'` guard could never pass for any CSV that exists. |

CSV was assessed separately throughout rather than lumped with the binary formats. It is not
better off: it is the only one of the four that cannot be identified from its own bytes, and
the one that produces ragged grids most readily.

### The accessibility policy

**A worksheet may become an HTML `<table>` only when its header structure is a fact the file
states, not a shape a heuristic guessed. Otherwise it is rejected — not split, and not
summarized.**

The important part of that finding is that **the policy is not new**. This repository already
has one, in `src/engine/compile/steps/tables.ts`, and it already runs on every imported
document: every table gets a `<caption>`; a table with no `<th>` is queued for a human; and
mechanical promotion is refused, with the item staying queued, when the table is ragged, has
a `rowspan` anywhere, or would promote a spanning cell. The question this issue actually had
to answer was whether spreadsheet output can *satisfy* that policy, and it cannot: the two
commonest real shapes — a merged group header and a ragged range — are exactly the two the
policy refuses, so the instructor gets a queue card that **cannot be cleared by any answer
they can give**. That is checked against the real audit, not asserted in prose, and proved
load-bearing by mutation: disabling the rowspan refusal in `tables.ts` turns the test red.

The heuristic's *other* direction is the one with no downstream detector at all. A worksheet
whose first data row happens to be all text comes back `headerRows: 1`, so ordinary records
are marked up as `<th scope="col">` with nothing queued and nothing flagged — a screen reader
is told a data row labels everything beneath it, and no later step has anything to check that
against.

Splitting and summarizing were both considered and rejected in the design. Splitting a grid
whose regions we cannot identify invents boundaries; summarizing a table into prose discards
the data the author came to publish.

### Why a second reader would not rescue it

Issue 14's answer to a lossy parser was a tracer over the package's own XML, reconciled
against anydoc's output. Two facts stop that pattern transferring:

- **The header row is not in the file.** Outside an `xl/tables/*` part — roughly 11% of real
  worksheets, and a construct ODS and CSV do not have at all — no spreadsheet format records
  which row is the header. Bold text and a border are formatting.
- **There is no join key.** `presentation/reconcile.ts` works because a slide and its blocks
  share identities both accounts hold (text runs, and a picture's `originPart`). No cell in
  anydoc's output carries a row, a column, or an A1 reference, so the only alignment key left
  is cell text — in a grid of short repeated values, where a monotonic walk would confirm
  coincidences rather than fail on them.

A tracer restricted to declared `xl/tables/*` ranges avoids both problems and is genuinely
implementable. It would also ship a capability that reads "import a spreadsheet" and refuses
seven of every eight real worksheets, on a distinction — did the author press *Format as
Table*? — no instructor will predict, while doing nothing at all for `.ods` and `.csv`. That
is a worse product than an honest refusal, so **no follow-on implementation ticket is filed.**
The design's "The bar, committed before the corpus is built" states the five criteria a
format must meet to graduate later; none of the four meets criterion 1 today.

### Security and privacy

Measured, not assumed. A `vbaProject.bin` is never read, packaged, or run. An
`xl/externalLinks/` part pointing at an absolute https URL is **never fetched** — asserted
with a `fetch` spy — and only its cached value survives. A formula's *source* never reaches
the page, so a formula cannot leak the ranges or sheet names it references. A cell comment
does not reach the page. Hostile cell text is escaped. Across all 82 real `.xlsx`: 0 with a
VBA part, 0 with an external link.

The one real defect is ODS hidden content, above. The one residual worth naming and not
blocking on: a cell whose text begins `=`, `+`, `-` or `@` is a spreadsheet formula-injection
payload if the rendered table is ever pasted back into Excel. It is inert in HTML, which is
this importer's only output, so it is a documentation matter.

### Resource usage — the existing budgets do not bound a spreadsheet

`maximumInputBytes` (16 MiB) bounds *compressed* bytes, and a spreadsheet's cost is driven by
*cell count*, which deflates about 10.5:1. The worst workbook that passes every gate — 8
sheets × 25,000 × 20, **10.83 MiB**, under both of anydoc's own internal ceilings
(`max_xml_nodes` 2,000,000 per part; `max_grid_slots` 4,500,000 per workbook) — parsed in
**20.5 s** and allocated **1,204 MiB** of WASM linear memory against a
`maximumWasmMemoryBytes` of 128 MiB. That check runs in `resultBudgetFailure` *after*
`toDocument` returns, because that is the only moment `wasmMemoryBytes` exists, so the budget
can report the overrun but cannot prevent it.

That is not only a theoretical ceiling. The real-file corpus already sits on the same curve:
its largest worksheet is **26,384 rows**, its widest **146 columns**, its slowest parse
**2,878 ms** on a 1 MiB file, and one ordinary workbook produced a **38 MB** document model —
which would have been proposed as a single Canvas page.

### One correction made during the work, recorded because it nearly shipped

An early probe measured a 500,000-cell worksheet at **96.8 s** and a second run of the same
fixture at **1.4 s**. That gap was the probe's own doing — it held two 15 MiB fixtures and the
arrays that built them, so the WASM instance's first `memory.grow` ran under heavy JS heap
pressure. The 96.8 s figure was nearly written into the design as an anydoc property. It is
not one; the honest cold number for that fixture is **3.5 s**. Every timing in the design was
re-taken one fixture per process afterwards, and this is noted so a later reader knows the
numbers were checked against a plausible alternative explanation rather than accepted because
they happened to support the verdict.

### What was built

| file | |
| --- | --- |
| `src/import/testing/spreadsheet-fixtures.ts` | new — XLSX/ODS builders and 20 evaluation cases, each naming what it stands in for |
| `src/import/spreadsheet-evidence.browser.test.ts` | new — 26 assertions against real anydoc and the real compile pipeline |
| `src/import/capability.ts` | four `probe-only` entries |
| `src/import/capability.test.ts` | the pinned probe-only set, plus a test that no accept string offers a spreadsheet |
| `src/import/released-sources.ts` | a comment; no entry |
| `src/components/DocumentImporter.tsx` | a probe-only format reads as unavailable, not as a limitation |
| `src/components/DocumentImporter.browser.test.tsx` | that wording, and the refusal on submit |
| `README.md` | one paragraph stating the refusal and the reason |

`src/import/document.ts` and `src/import/testing/corpus.ts` were deliberately **not** touched.
The existing status guard already refuses these formats, and `CORPUS_CASES` is the corpus this
release's support claim rests on — a disabled format makes no support claim.

### Verification

`npm run typecheck`, `npm test` (**139 files, 1,565 tests, all passing**) and `npm run build`
all green on this tree, 2026-08-30. Neither of the two known intermittent flakes appeared.

### What is NOT closed

All six criteria are ticked, and each is ticked against something that ran. Two honest
qualifications on the evidence behind them, stated rather than buried:

1. **28 of the 110 real `.xlsx` files found on the measuring machine were never read.** They
   are in OneDrive and the macOS File Provider stalled on one of them indefinitely; the run
   was restarted past it, recovering 55 of the remaining 84. The 82 measured files are a 75%
   sample, and the 28 missing ones are contiguous in directory order rather than randomly
   distributed.
2. **There are no `.ods` files on this machine at all.** Every ODS fact rests on synthetic
   packages plus one file LibreOffice Calc wrote through its own filter. That is
   producer-real, but it is one producer — so the ODS leak is proven to happen, and its
   frequency across real-world ODS files is not measured.

Neither qualification points the other way. A larger sample could move 81% to 75% or 87%; it
could not make a merged header stop being a `rowspan`, or make ODS stop publishing a hidden
sheet.
