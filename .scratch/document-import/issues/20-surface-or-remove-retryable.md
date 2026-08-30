# 20 — Surface `ParserProbeError.retryable`, or stop computing it

**What to build:** Either let a user act on the retryable/not-retryable distinction the parser layer
already draws, or delete it — and stop maintaining a field whose only readers are its own tests.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**The finding, from issue 13's residuals and re-verified 2026-08-30.** `retryable` is declared,
defaulted and assigned in `src/import/parsers/probe.ts` (lines 223–229) and read *nowhere else in
`src/`*. Issue 11 tuned its encrypted/unsupported classification with real care and issue 13's
security suite pins its value, but no component branches on it and `actionableFailure` builds the
same message shape regardless. No user has ever benefited from the distinction.

**Why this is worth an issue rather than a delete.** The distinction is real and useful: "the parser
ran out of memory on a big file, try again" and "this PDF is encrypted, trying again will not help"
are different situations, and telling a user to retry something that cannot succeed wastes their
time. The field is evidence that somebody already worked out which is which. The defect is that the
work stops at the boundary of the UI.

Issue 13 explicitly deferred this — its non-goals excluded adding capability — and recorded it for
"whichever future issue decides". This is that issue. **Deleting the field is an acceptable
outcome** if the conclusion is that a user cannot act on the difference; what is not acceptable is
leaving it computed, tested, and unread.

- [ ] Every failure code's `retryable` value is confirmed against what actually happens on a second attempt, rather than trusted from its declaration.
- [ ] The decision — surface it or delete it — is written down with the reasoning, not just implemented.
- [ ] If surfaced: a user meeting a retryable failure is offered a retry, and a user meeting a non-retryable one is not told to try again.
- [ ] If surfaced: the difference is announced to assistive technology, not only styled.
- [ ] If deleted: the field, its tests, and the classification logic behind it all go, and nothing is left that implies the distinction still exists.
- [ ] Whichever way it goes, no field in the parser layer is left with tests as its only reader.
