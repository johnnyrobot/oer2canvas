# 18 — Attribute an imported chart to the slide that carries it

**What to build:** Give the chart table anydoc emits an identity the presentation index can join on, so a deck carrying an inserted chart imports with its chart data instead of being refused.

**Blocked by:** 14 — Graduate presentation formats through the document workflow (resolved).

**Status:** ready-for-agent

## Why this exists

Measured during 14, over 39 real `.pptx` decks driven end to end: **4 refused because of an
inserted chart**, and the rule was exact — *every* deck carrying a `ppt/charts/chartN.xml`
refused, and every deck without one imported. It is the largest remaining refusal this module
itself causes.

The chart's *data* is not missing. anydoc renders a chart's cached values as a `<table>` —
series, categories, numbers. The failure is attribution: `presentation/index.ts` counts the
graphic frame as an unrepresentable chart and records **no text** for it, so when
`reconcile.ts` walks the blocks by prefix accumulation, that table belongs to no slide and
`presentation-unattributed-content` blocks the import.

## The approach this issue commits to, and the one it forbids

**Forbidden: teaching the index to reproduce anydoc's chart table.** That means predicting
series order, category-axis handling, chart type and number formatting. Predicting anydoc's
rendering from package XML is the exact class of rule that produced **eleven silent
misattributions** during issue 14, each fixed as an instance while the class stayed open. Do
not reopen it.

**Committed: give the table an identity, the way issue 14 gave pictures one.** Task 6b
replaced a per-slide picture *count* with an identity join on the media part path
(`data-origin-part`), because a count is a prediction and an identity is a fact both accounts
already hold. A chart's table carries no such identity today. The index already knows which
slide references `ppt/charts/chartN.xml` through the slide's `_rels`; `anydoc-html.ts` knows
which chart part it rendered the table from. Join on that.

The precedent to read first is `anydoc-html.ts`'s `data-origin-part` emission and
`reconcile.ts`'s picture claim — including that the attribute is a join key stripped on every
path out of the module, never content.

- [ ] The chart table anydoc emits carries an origin identifying the chart part it came from, gated to presentation formats so DOCX, ODT, RTF and EPUB are unchanged.
- [ ] The index records, per slide, the chart parts that slide references, alongside the picture origins it already records.
- [ ] A deck carrying an inserted chart imports, with the chart's table attributed to its own slide.
- [ ] A chart table whose origin no slide references, and a referenced chart part that produced no table, are each a named refusal — the walk still confirms or fails, never guesses.
- [ ] The `presentation-unrepresentable` chart warning still fires, because a rendered data table is not the chart a reader would have seen.
- [ ] Measured against real decks, not only fixtures: the four decks that refused in 14 are re-run and the refusal rate reported. Issue 19's harness is how.
- [ ] Every new assertion is mutation-tested. Issue 14 produced a test that could not go red four separate times; assume it will happen again.
