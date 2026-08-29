# 13 — Harden and release the core document importer

**What to build:** Release the browser-only document importer as a dependable product capability for its proven core formats, with transparent limits, privacy behavior, accessibility, security, artifact correctness, and regression protection.

**Blocked by:** 09 — Harden packaged assets across document formats; 10 — Let users approve and edit the proposed page plan; 11 — Import text-based PDFs and fail closed on OCR-dependent pages; 12 — Import one URL using a memory-only Firecrawl key.

**Status:** resolved

- [x] The published capability table matches corpus-tested support for plain text, Markdown, HTML, DOCX, ODT, RTF, EPUB, text-based PDF, and optional URL acquisition.
- [ ] Supported browsers pass keyboard, screen-reader, focus, progress, cancellation, and error-recovery acceptance scenarios.
- [x] Security tests cover hostile documents, HTML, URLs, archive expansion, malformed binaries, active content, and credential leakage.
- [x] Artifact tests unzip generated cartridges and verify manifests, page bytes, assets, deterministic output, and accessibility-gate invariants.
- [x] Documentation explains local compute, memory-only handling, Firecrawl disclosure, unsupported OCR, resource limits, and recovery guidance.
- [x] Dependency notices and third-party licensing obligations are complete for shipped parsers and browser components.
- [ ] Production builds, automated tests, existing publisher imports, and representative end-to-end Canvas acceptance checks all pass.

## Answer

`npm run verify:release` (`scripts/verify-release.mjs`), run 2026-08-29:

```
Release criteria

  1. [PASS] Capability table matches corpus-tested support
  2. [PASS] Keyboard, focus, progress, cancellation, error recovery  MANUAL: Firefox and screen reader — NEVER RUN
  3. [PASS] Hostile documents, URLs, archives, credentials
  4. [PASS] Cartridges unzip; manifests, bytes, assets, determinism
  5. [PASS] Documentation states its obligations
  6. [PASS] Dependency notices complete
  7. [PASS] Production build and artifact  MANUAL: Live Canvas acceptance — NEVER RUN

Enforced checks pass. Manual acceptance has NEVER been recorded.
```

Five criteria are ticked above — 1, 3, 4, 5, 6 — because each has an enforced, automated check
that ran green on this tree. Criteria **2 and 7 are left unticked on purpose.** Both have a
manual half — Firefox, a screen reader, and a real Canvas instance — and `docs/RELEASE-ACCEPTANCE.md`
has zero data rows in all three of its record tables (Live Canvas push, Firefox, screen reader).
Nobody has ever run them. `verify:release` reports this honestly as `MANUAL … NEVER RUN` rather
than as a pass, and this Answer does the same: **as of this commit, issue 13 stands at "enforced
checks pass, manual acceptance never recorded,"** not "released." Ticking those two boxes would
be the exact kind of claim this issue exists to prevent — a released-sounding checkmark standing
in for a check that was never actually run.

**This issue added no capability.** Every format, limit, and workflow it touches shipped in
issues 01–12; nothing here is new user-facing behaviour. That is what turned it into a gate
rather than a feature: its eleven tasks built checks — a corpus, a security suite, an artifact
reader, a docs-truthfulness test, a licensing test, and a script that prints where each of
issue 13's seven criteria stands — rather than adding anything for those checks to cover. A gate
that shipped alongside new capability would have made it hard to tell whether a green run proved
the gate works or just that nothing had broken yet; shipping the gate against an already-frozen
surface is what makes its PASS rows mean something.

**Archive expansion was already bounded before this issue measured it.** Task 2 built a
compression-bomb DOCX fixture at four rungs and pushed each through the real anydoc 0.2.4 WASM
parser: all four refused cleanly, at ratios in the 292–294:1 range (the design's earlier estimate
of "around 294:1" is accepted as the conservative bound — it is the top of a 0.7%-wide spread, not
a claim the spread is uniform), taking 40–1613ms. The escalation clause that would have demanded a
pre-parse guard was never tripped. The load-bearing fact underneath that result: `anydoc.worker.ts`
(lines 58–60) maps the vendor parser's own `resourceLimit` outcome to a `resource-limit` failure,
so a large bomb is refused by the *vendor's* limit on the early failure path — it never reaches
this project's post-parse budget check at all. There is still no pre-parse guard, and none was
added; the measurement showed the vendor's own ceiling already does that job for the sizes tested.

**Documentation and licensing were made mechanical, not reviewed.** Task 9's suite
(`src/docs-claims.test.ts`) asserts that required phrases and topics — local compute, memory-only
key handling, the Firecrawl disclosure, unsupported OCR, resource limits, recovery guidance — are
*present*, and asserts that every shipped parser and browser dependency has a notices entry in the
right place. Neither half reads for quality. A test checking "the word 'Firecrawl' appears near 'key'" passes whether
the surrounding sentence is clear or confusing, and a licensing entry that cites the wrong license
text would still satisfy "an entry exists at this path for this package." Mechanical checks catch
regression (a sentence silently deleted, a dependency added with no notice) — they cannot catch
whether the prose was ever good. That trade was made explicitly, not assumed.

**Firefox and screen-reader coverage are attested, not automated, by recorded decision.** A
second Vitest browser project for Firefox would roughly double browser-test wall time and add a
second flake surface, for engine differences the Chromium keyboard/focus/cancellation assertions
mostly already catch; screen-reader comprehensibility (whether an announcement that is technically
present actually communicates anything) has no automated proxy at all — Axe checks machine-
detectable rules, not whether a human listening understands what they heard. Both are recorded in
`docs/RELEASE-ACCEPTANCE.md` as things a human must run and log, not oversights the gate happens
not to cover yet.

**Residuals**, carried from the ledger rather than newly discovered here:

- RTF's malformed-binary coverage is weaker than EPUB's and ODT's: `malformedStructuredFixture('rtf')`
  returns `{\rtf1\ansi}`, a *valid* empty RTF, so its refusal comes from
  `importStructuredDocument`'s no-readable-content guard rather than from a parser rejecting
  malformed bytes the way it does for the other two formats.
- The seven structural corpus properties (merged cells, deep nesting, footnotes, RTL/CJK,
  equations, large-but-legal) run on DOCX and EPUB only, not on all eight released formats. A
  format-specific structural bug — merged cells mishandled in ODT, say — could escape the corpus
  entirely.
- The corpus's `large-but-legal` case sits around 13KB, nowhere near the 16 MiB input ceiling, so
  "a file just under the byte ceiling still succeeds" is uncovered. (The ceiling's *refusal* side
  is covered, by Task 3's oversized fixtures.)
- The one product-shaped finding: `ParserProbeError.retryable` is computed with real care — issue
  11 tuned the encrypted/unsupported classification, and this issue's security suite pins the
  value — and it is read by **nothing outside tests**. No component branches on it and
  `actionableFailure` builds the same message shape regardless of its value, so no user has ever
  benefited from the distinction it draws. Either it should be surfaced somewhere a user can see
  it, or the project should stop computing it as if it mattered. Out of scope here — issue 13's
  non-goals exclude adding capability — so it is recorded here for whichever future issue decides.

**What closes each criterion**, for anyone auditing the ticks above:

1. `src/import/released-sources.ts` (Task 1) declares the released set independently of the
   capability table so the reconciliation test in `released-sources.test.ts` is not tautological;
   `src/import/testing/corpus.ts` (Tasks 5–6) is the corpus that tested it against real parser
   output and found the DOCX/EPUB limitation strings understated — now corrected in
   `src/import/capability.ts`: DOCX's footnote-blocks and equation-blocks, and EPUB's
   equation-blocks and unrecognised-footnote behaviour, are now stated plainly.
2. `src/App.a11y.browser.test.tsx`, `src/components/DocumentImporter.browser.test.tsx` (automated
   half); `docs/RELEASE-ACCEPTANCE.md` §2–3 (manual half, never run).
3. `src/import/security.browser.test.ts`, built across Tasks 2–4 (archive expansion, malformed
   binaries, active content via the document-path sanitizer, hostile URLs, credential leakage for
   both the Firecrawl key and the Canvas token).
4. `src/import/cartridge-artifact.browser.test.ts` + `src/import/cartridge-artifact.test.ts`,
   sequenced through `npm run test:artifacts` (Task 7).
5. The docs-truthfulness suite from Task 9 (`src/docs-claims.test.ts`).
6. The dependency-notices half of that same Task 9 suite, checking `THIRD-PARTY-NOTICES.md`
   against shipped parsers and browser components.
7. `npm run build` + `npm run test:dist` (automated half); `docs/RELEASE-ACCEPTANCE.md` §1, Live
   Canvas push (manual half, never run).
