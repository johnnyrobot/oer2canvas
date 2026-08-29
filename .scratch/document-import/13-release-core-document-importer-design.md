# Harden and release the core document importer — design

**Issue:** [`issues/13-release-core-document-importer.md`](issues/13-release-core-document-importer.md)

**Blocked by:** 09, 10, 11, 12 — all resolved as of 2026-08-29.

## What this issue is for

Every other document-import issue added a capability. This one adds none. It asks a
different question: **is what we already built releasable, and how would anyone know?**

That distinction shapes the whole design. The deliverable is not a feature, it is a
*checkable state*. So the central artifact is a gate that names the seven acceptance
criteria and reports, per criterion, the check that closes it — and fails loudly when a
criterion has no check at all. A criterion nobody can run is a criterion that rots.

## The gate

`npm run verify:release` composes what already exists with what this issue adds:

```
typecheck → vitest (unit + browser + forced-colors) → build → test:dist → corpus → security → artifact
```

It prints one row per criterion with the check that covers it, and exits non-zero on any
failure. Two criteria cannot be closed by a machine and are printed as **MANUAL**, citing
`docs/RELEASE-ACCEPTANCE.md` and the date of the last recorded run.

**Why a composite script rather than a document listing commands.** A document that lists
`npm test` alongside "check the screen reader" makes the two look equally enforced. They are
not. The script's job is to make the boundary between *enforced* and *attested* visible at
the moment someone tries to release, which is exactly when the temptation to skip the second
kind is highest.

**Why it does not run the manual checks.** Both need credentials or a human ear. A gate that
silently skipped them while reporting green would be worse than no gate.

## Criterion → check

| # | Criterion | Closed by | Kind |
| --- | --- | --- | --- |
| 1 | Capability table matches corpus-tested support | `capability.test.ts` + the widened corpus, cross-checked mechanically | enforced |
| 2 | Keyboard, screen-reader, focus, progress, cancellation, error recovery | `App.a11y.browser.test.tsx` + the new web-tab screen (Chromium); Firefox and screen reader attested | part enforced, part manual |
| 3 | Hostile documents, HTML, URLs, archive expansion, malformed binaries, active content, credential leakage | the new security suite | enforced |
| 4 | Cartridges unzip; manifests, page bytes, assets, determinism, gate invariants | the new artifact suite, using a real `unzip` | enforced |
| 5 | Docs explain local compute, memory-only handling, Firecrawl, no OCR, limits, recovery | a doc-claims test asserting each obligation appears in a user-facing file | enforced |
| 6 | Dependency notices and licensing complete | a notices test: every direct dependency listed, no shipped parser called probe-only | enforced |
| 7 | Production build, tests, publisher imports, Canvas acceptance | `build` + `test:dist` + `verify:production`; live Canvas attested | part enforced, part manual |

## Measured facts

Recorded here so the plan does not re-derive them, and dated so a later reader knows what to
re-run.

1. **Archive expansion is already bounded — measured 2026-08-29.** A valid DOCX whose
   `word/document.xml` was 400,000 repeated paragraphs (roughly 31 MB expanded) was refused
   in about 1.6 s with `ParserProbeError` / `resource-limit`: *"Parser memory exceeded the
   128 MiB browser limit."* So the existing ceiling catches a compression bomb, and this
   criterion needs a **regression test, not new machinery**.

   Two caveats the plan must resolve rather than inherit. The compressed size was not
   captured — `probeParser` transfers the buffer into the Worker, so reading `byteLength`
   afterwards returns 0 — so the achieved **ratio is unmeasured**. And the ceiling is checked
   in `resultBudgetFailure`, which runs on the `result` message, i.e. **after** the parse
   returns; this case survived to post a result, but a larger bomb might exhaust the tab
   first. The plan must measure the boundary and record what happens beyond it.

2. **The accessibility suite has no screen for the Web page tab.**
   `App.a11y.browser.test.tsx` covers screens 1, 1b (text and markup), 1c (document), 2, 3
   and 4. Issue 12 added a panel and no screen, so criterion 2 is not met today.

3. **`THIRD-PARTY-NOTICES.md` describes both WASM parsers as "Probe-only".** False for
   `@firecrawl/anydoc-wasm` since issue 04 and for `@firecrawl/pdf-inspector-wasm` since
   issue 11. Criterion 6 has a concrete defect before any audit begins.

4. **The capability table has no `web` entry.** `DOCUMENT_FORMAT_CAPABILITIES` describes file
   formats; URL acquisition is a separate tab wired through `onImportWeb`. Criterion 1 names
   "optional URL acquisition", so the table and the criterion do not currently line up.

5. **`zip.test.ts` already verifies artifacts against a real `unzip`**, and its header states
   the reason: *"anything less than a third-party reader agreeing is just this file marking
   its own homework."* The artifact suite extends that stance rather than inventing one.

## Corpus

**Synthetic and committed, deliberately widened.** Real documents were considered and
rejected for this issue: they add repo weight, licensing bookkeeping, and fixtures whose
meaning changes silently when replaced. Generated fixtures are deterministic, diffable, and
already how every parser fact in this project was measured.

The obligation that comes with that choice: **every case must name the real-world property it
stands in for.** A generated fixture is only evidence if a reader can see what it is evidence
*of*. The cases, per enabled format where the format admits them:

- deep heading nesting, so the page-plan split has something to be wrong about;
- a table with merged cells, the single most common structure to lose;
- footnotes and endnotes;
- right-to-left and CJK text, because a sanitizer that reverses or drops them fails silently;
- an equation, since Temml conversion sits downstream;
- large-but-legal — inside every budget, near one of them;
- one hostile case, feeding the security suite below.

The capability table gains an entry (or a declared sibling list) covering URL acquisition, so
criterion 1's "matches" becomes a mechanical check rather than a reading.

## Security

The suite is organised by the criterion's own list, and each case must state what the
*expected refusal* is — a test that merely asserts "does not crash" documents nothing.

- **Archive expansion** — pins fact 1 above, plus the boundary the plan measures.
- **Malformed binaries** — truncated, header-only, and wrong-magic files per format. Issue 11
  established the shape: the refusal must stay correctly *retryable* or not, because
  `actionableFailure` decides that from a code derived from an English message.
- **Active content** — already covered by `markup.ts`'s tests; the suite asserts the same
  guarantees through the *document* paths, which reach a different sanitizer entry point.
- **Hostile URLs** — private network, IP literal, credential-bearing, non-HTTPS, and
  post-redirect variants. Largely proved by issue 12; gathered here so criterion 3 is
  checkable in one place.
- **Credential leakage** — generalises `web-key-containment.test.ts` from the Firecrawl key to
  the **Canvas token**. `credentials.ts` holds a token the same way and `idb.ts` is "the one
  place this app writes to disk", so the same enumerate-then-assert method applies: every
  storage path watched at once, every failure mode driven, and the sentinel required to appear
  in no message, finding, request, or render.

## Artifacts

Extends `zip.test.ts`'s real-`unzip` method to a whole cartridge, per enabled format:

- the archive is valid to a third-party reader (`unzip -t`);
- the manifest carries the shape issue 07 measured Canvas accepting;
- page bytes equal the bytes the accessibility gate audited;
- packaged assets appear once, named by content hash;
- **determinism**: importing the same source twice produces byte-identical output, which is
  what makes re-import update pages rather than duplicate them.

**A stated tension.** Real `unzip` needs `node:child_process`, and `tsconfig.json` deliberately
omits node types so a `process` reference in `src/` is a compile error;
`tsconfig.node.json`'s own comment says its file list is "meant to be hard to grow by
accident." This design grows it by **one** file, deliberately, with the reason recorded there
— rather than weakening the tripwire for everything.

## Documentation and licensing

Not a rewrite, and **not a human reading a list** — both criteria are made mechanical, because
the gate reports only two kinds of thing and a third, "someone looked", would be the category
that quietly stops happening.

**Criterion 5 becomes a doc-claims test.** Each obligation is a required phrase-or-equivalent in
a *user-facing* file — `README.md`, `PRIVACY.md`, `SECURITY.md`, `ACCESSIBILITY.md` — never only
in `.scratch`: local compute, memory-only credential handling, the Firecrawl disclosure, that
OCR is not supported, the resource limits, and what to do when an import fails. The test asserts
presence and location, not wording, so prose can be improved without breaking it.

**Criterion 6 becomes a notices test.** Every direct dependency in `package.json` appears in
`THIRD-PARTY-NOTICES.md`, and no parser that the capability table marks `enabled` is described
there as probe-only. That second assertion is what would have caught fact 3 the day issue 04
shipped.

Both are weaker than a careful human read and neither replaces one. They are what survives when
nobody has time for the careful read, which is the condition a release gate is built for. The
doc-claim sweep from issue 12's Task 10 still runs by hand this once, because this release
changes what is true.

The doc-claim sweep from issue 12's Task 10 runs again, because this release changes what is
true: any sentence promising locality or non-transmission is re-read against the shipped
feature set.

## Manual acceptance

`docs/RELEASE-ACCEPTANCE.md`, numbered, each step naming the exact command or action and
leaving a place to record date, operator and result:

1. **Live Canvas** — `npm run verify:canvas-live` against an instance the operator
   administers, with the credentials in `.env.local`. Records the course, the pages created,
   and that a re-import updated rather than duplicated them.
2. **Firefox** — the keyboard, focus, progress, cancellation and error-recovery scenarios the
   Chromium suite automates, performed by hand in Firefox.
3. **Screen reader** — VoiceOver or NVDA through one import end to end: the form, the findings,
   the page plan, and the export.

Issue 13 closes by pasting a completed record. An empty record is a criterion not met, and
`verify:release` prints it as MANUAL with the date of the last run so staleness is visible.

## Files

- Create: `scripts/verify-release.mjs`, `docs/RELEASE-ACCEPTANCE.md`
- Create: corpus generators under `src/import/testing/`, plus security and artifact suites
- Modify: `src/import/capability.ts` (URL acquisition), `THIRD-PARTY-NOTICES.md`,
  `tsconfig.node.json` (one file), `package.json`, `App.a11y.browser.test.tsx` (web screen)
- Modify: `.scratch/document-import/issues/13-*.md`, `map.md`

## Non-goals

No new import formats. No OCR. No relay changes. No second browser project in CI — Firefox is
attested, not automated, and that is a recorded decision rather than an oversight. No real
document corpus. No deployment: this issue decides whether the app *is* releasable, and
pressing deploy remains a separate, human act.

## Open questions

- **Does the capability table gain a `web` row, or a declared sibling list?** A row makes
  criterion 1 checkable in one place but puts a non-file source in a table whose consumers all
  assume file extensions and media types — `DOCUMENT_FILE_ACCEPT` builds a file picker's
  `accept` string from it. Leaning toward a sibling list plus a test asserting the two
  together cover exactly the released set. **To settle in the plan, with the consumers read
  first.**
- **Where is the archive-expansion boundary?** Fact 1 shows 31 MB is refused cleanly. The plan
  must find where that stops being true and record whether the failure beyond it is a clean
  refusal or a lost tab. If it is the latter, that is a real finding and may warrant a
  pre-parse guard — which would make this issue add machinery after all.
- **Is `verify:production` in the gate or in the manual record?** It hits the live public
  deployment, so it cannot run offline or in CI, but it needs no credentials. Currently
  proposed as enforced-but-network-dependent; may belong in the manual record instead.

## Amendment — archive-expansion boundary, measured 2026-08-29

Resolves the open question above and the two caveats on Measured fact 1. Method: a throwaway
browser-project test built four `compressionBombDocx` rungs (`src/import/testing/archive-bomb.ts`,
kept; the test itself was deleted per the task-2 brief), reading `bytes.byteLength` **before**
calling `probeParser` — the earlier measurement read it after, when the buffer had already been
transferred into the Worker and reads 0, which is why the ratio was unmeasured the first time.
Each rung called `probeParser({ parser: 'anydoc', formatHint: 'docx', timeoutMs: 25_000 })`.

| paragraphs | compressed bytes | approx. expanded bytes | ratio | elapsed | outcome |
| --- | --- | --- | --- | --- | --- |
| 400,000 | 113,883 | 31,200,000 | 274:1 | 1,613 ms | `resource-limit` — "Parser memory exceeded the 128 MiB browser limit." |
| 1,000,000 | 282,941 | 78,000,000 | 276:1 | 643 ms | `resource-limit` — "AnyDoc could not inspect this file. resource limit exceeded (max_xml_nodes): part exceeds 2000000 xml nodes" |
| 2,000,000 | 564,703 | 156,000,000 | 276:1 | 41 ms | `resource-limit` — "AnyDoc could not inspect this file. resource limit exceeded (max_entry_bytes): word/document.xml declares 166000180 decompressed bytes" |
| 4,000,000 | 1,128,214 | 312,000,000 | 277:1 | 40 ms | `resource-limit` — "AnyDoc could not inspect this file. resource limit exceeded (max_entry_bytes): word/document.xml declares 332000180 decompressed bytes" |

**Every rung refuses cleanly, and the achieved ratio holds steady around 275:1** — a trivially
compressible expanded XML deflates to roughly that fraction of its size across the whole range
tried, so `maximumInputBytes` (16 MiB) already bounds the expanded size a bomb built this way can
reach to roughly 4.6 GB (16,777,216 bytes × ~275) before the archive itself would be rejected
pre-Worker; every rung tried here is far short of that and still refused.

**This also answers the caveat that `resultBudgetFailure` runs on the `result` message, i.e.
after the parse returns, and so "may never get that far."** It does not need to: at 1,000,000
paragraphs and above, `@firecrawl/anydoc-wasm` itself throws a typed error (`code: 'resourceLimit'`)
from its own internal `max_xml_nodes` / `max_entry_bytes` checks, well before it would produce a
`result`. `anydoc.worker.ts` maps that vendor code to our `resource-limit`
(`src/import/workers/anydoc.worker.ts:61`) and it reaches `probeParser` through the `failure`
message path, not through `resultBudgetFailure`. Only the smallest rung (400,000 paragraphs, ~31
MB expanded) survives long enough to actually build a document and get caught by the post-parse
`wasmMemoryBytes` check instead — consistent with Measured fact 1. Elapsed time falls as the rung
grows (1,613 ms → 40 ms) because the larger rungs are rejected by a cheap pre-parse node/byte
count rather than by a parse that ran far enough to approach the 128 MiB ceiling.

**Conclusion: every rung refuses cleanly with `resource-limit`, from 31 MB up to 312 MB
expanded, in every case well inside the 25 s probe timeout used here (and the 30 s production
`parserTimeoutMs`).** Criterion 3's archive-expansion case needs only the regression test
Task 3 adds, pinning the largest rung proved here (4,000,000 paragraphs / ~312 MB expanded /
`resource-limit`) — not new machinery. No pre-parse guard is warranted by this finding.
