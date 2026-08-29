# Decision — what counts as "too little extracted content"

**Answers plan 11 escalation 1 / design 11 open question 2, and plan 12 escalation 1, together.**
Decided 2026-08-29.

Both plans escalated the same question and both assumed it had the same answer. It does not, and the
reason is the whole decision.

## What was already true

Empty is refused on every path today. `importText` throws on `!text.trim()`; `sanitizeImportedHtml`
raises the `import-no-supported-content` blocker when nothing semantic survives
(`src/import/markup.ts:381-387`); and issue 11's scanned-page detection blocks a PDF page that
produced nothing. **The zero floor is shipped, unambiguous and invents nothing.**

The gap is *near*-empty: three garbled words from a JavaScript app shell, or a PDF page carrying only
a running header and a page number. Both pass a zero floor. "Enable JavaScript to view this article"
publishing as an article is exactly the silent-hole class this project keeps eliminating.

## The decision

**No absolute character count, on either path. A floor is either zero, or derived from the artifact
in hand.** An absolute characters-per-page number is never invented, and never imported from another
project — `libretexts-reader` uses "under 100 chars/page" (`content/pdf.rs:197-210`), which is a
reasonable guess for its own corpus and would be someone else's guess wearing evidence's clothes here.

Add this to both plans' Global Constraints.

**Neither signal blocks. Both warn.** Blocking on "suspiciously short" would refuse a legitimately
short document, and the case that genuinely must not publish — nothing at all — already blocks. A
warning that is wrong costs a glance at the preview; a blocker that is wrong costs the whole import.

### PDF: a page against its own document

After extraction every page's text is in hand, so the document supplies its own baseline. A page far
below its document's median page length, **in a document that is otherwise text-rich**, is anomalous
and warns.

The guard matters: a mostly-scanned document has a low median, so a bad page would not look anomalous
against it — and that case is already owned by scanned-page detection, which blocks. The relative test
exists for the page that is anomalous *among readable pages*, which is precisely the case nothing else
catches.

This derives from the artifact and introduces one ratio rather than one absolute. The ratio still has
to be validated against real PDFs before it ships — see Still to measure.

### Web: the page against its own claims

One article has no distribution to compare against, so the PDF technique is unavailable. Two routes,
in preference order:

1. **Compare the extracted body against the page's own metadata description.** A body shorter than
   its own summary is incoherent, and it derives from the page rather than from a guess.
   **Unverified**: the design's probe recorded `metadata.statusCode`, `error`, `sourceURL`, `url` and
   `contentType` (`12-import-url-design.md:140,287-288,354-356`) but never established whether
   `description` is returned. Verify before building on it.
2. **If no description is returned, disclose rather than judge.** Report the extracted word count as a
   neutral note in the import report. No threshold, so no false positives, and the number is in front
   of the person deciding whether to publish. This is the same move issue 09 made with packaged
   bytes — show the measurement, let the human judge — and it is the honest answer when there is
   genuinely nothing to derive a threshold from.

Do **not** detect failure by matching English phrases ("Enable JavaScript", "We use cookies"). Both
plans already record the cost of that pattern: issue 11's `encrypted`/`malformed` classification is
decided by a regex over an English error message, and both plans flag it as a residual precisely
because a wording change upstream silently reclassifies. Do not add a second instance of a defect
already recorded as one.

## Still to measure, before either ships

- **The PDF ratio.** Needs real textbook PDFs, including one with a legitimately sparse page (a part
  divider, a full-page figure with a caption) that must NOT warn. Until measured, the relative test is
  specified but not tuned; ship the zero floor alone rather than a tuned-by-guess ratio.
- **Whether Firecrawl returns `metadata.description`.** One probe, no key needed beyond what Task 2
  already spends. It decides between web route 1 and route 2.

## What this does not decide

Whether a page that warns should be *visually* marked in the preview the way a refused image is. The
findings carry it; whether the page body should too is a UI question nobody has asked yet.
