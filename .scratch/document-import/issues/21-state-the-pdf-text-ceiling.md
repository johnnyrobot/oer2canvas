# 21 — State the byte ceiling a PDF actually meets

**What to build:** Tell a user the limit that will actually refuse their PDF, instead of advertising
one that is eight times larger than the one they hit first.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**The discrepancy, verified 2026-08-30.** `src/import/released-sources.ts:111` gives PDF a
`maximumBytes` of `DOCUMENT_IMPORT_LIMITS.maximumInputBytes` — 16 MiB — under a doc comment calling
it "the ceiling a user actually meets". But `src/import/pdf.ts:82` separately refuses **extracted
text** above `MAX_TEXT_IMPORT_BYTES` (2 MiB, from `text.ts:37`). A text-dense PDF reaches the second
ceiling long before the first. Neither `capability.ts`'s PDF limitations nor `README.md` mentions it:
the README's only 2 MiB line is about text, Markdown and HTML.

**This is recorded as UNDECIDED, not decided.** It was deferred from issue 13's Task 1 to its Task 12
and never landed there either, so the question is open: is the honest fix to document the second
ceiling, to reconcile the two, or to change what `maximumBytes` means? The doc comment claiming
`maximumBytes` is "the ceiling a user actually meets" is the part that is unambiguously wrong today,
whichever way the rest goes.

**The user-facing shape of the bug.** A 4 MiB text-heavy PDF is inside every limit this app
advertises and is refused anyway. The message a user gets should name the limit they actually hit and
what to do about it, and today it comes from a guard nothing published.

- [ ] The relationship between the input-byte ceiling and the extracted-text ceiling is settled and written down, including whether `maximumBytes` should keep its current meaning.
- [ ] A PDF refused by the extracted-text ceiling says which limit it hit, in a message that does not imply the file was too large on disk.
- [ ] The published limits — capability table and README — state both ceilings, or state one that is actually true for every PDF.
- [ ] `released-sources.ts`'s "the ceiling a user actually meets" comment is either made true or corrected.
- [ ] A fixture pins a PDF that passes the input ceiling and fails the text ceiling, so the two cannot silently converge or diverge again.
- [ ] Issue 13's residual list is updated to point at this issue rather than describing the question as open.
