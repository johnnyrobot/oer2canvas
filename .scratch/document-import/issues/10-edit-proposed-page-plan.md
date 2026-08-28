# 10 — Let users approve and edit the proposed page plan

**What to build:** Turn an imported document into a deterministic proposed set of Canvas pages that the user can inspect, rename, include or exclude, split, merge, and reorder before confirming it for accessibility review and export.

**Blocked by:** 01 — Import plain text into a Canvas cartridge; 04 — Enable EPUB, ODT, and RTF structured imports; 05 — Import Markdown and HTML safely.

**Status:** resolved

- [x] The same imported content produces stable page identities and page boundaries across repeated runs.
- [x] A user can preview, rename, include, exclude, split, merge, and reorder proposed pages without reparsing the source file.
- [x] Page-editing controls are fully keyboard operable, expose meaningful accessible names, and announce important state changes.
- [x] Document title, attribution, source URL when present, and rights metadata remain editable and flow into the export plan.
- [x] Reconfirming a changed plan invalidates stale compiled or audited output and sends only the confirmed pages into review.
- [x] Empty plans, duplicate names, invalid splits, cancellation, and restoration after a recoverable error have clear behavior.

## Answer

Added a pure page-plan module (`src/import/page-plan.ts`) and a keyboard-operable plan editor
(`src/components/ImportPlanEditor.tsx`) between parsing and preparation. The importers now parse
and hand off; `App` owns the draft plan so it survives visits to Review and Plan and can be edited
and confirmed again without rereading the source.

Page formation follows the spec's policy: the normalized document is cut into top-level blocks and
split at the highest heading level that repeats; a lone document title is not a split and folds
into the first page; body text before the first split heading becomes a page named for the
document; content without a repeated heading level starts as one page. Works with several
importer sections keep one page per section. The budget is 100 proposed pages per document; an
automatic split beyond it falls back to one page with a visible warning, and manual splits stop at
the budget. Page identity is the source-derived work id plus the 1-based index of the page's first
block, so rename, exclude, and reorder change no id, a split gives the new page the id of the block
it starts at, a merge keeps the surviving page's id, and the same bytes propose the same pages and
ids on every run. A one-page proposal keeps the importers' `<work>-page-1` identity.

The editor offers rename, include/exclude, split (chosen from named block boundaries in a select),
merge with next, and move up/down as labelled controls that name the page they act on; one polite
live region announces structural changes and edge cases (already first/last, one-block pages);
focus lands on the new page after a split, the surviving page after a merge, and the pressed
control after a move. Previews mount only while open. Document title, author, source, public URL,
license, and rights stay editable on the plan and flow into the confirmed work's provenance and the
Plan attribution. Empty plans, blank titles, and duplicate included titles are named and block
preparation; invalid document details are reported at confirm time with focus. Confirming sends
only included pages, in plan order, into the shared compile/audit/review path; any edit to a plan
that was already prepared discards the prepared output with a visible notice, and a failed or
cancelled preparation keeps the plan for correction. Discarding returns to the source browser.

Verification: TypeScript checks, 82 unit files / 826 tests, 21 browser files / 114 tests, the
production build, and the built-bundle smoke test (which now merges the EPUB proposal in the built
editor before exporting) all pass. The production build retains its pre-existing chunk-size
warning.
