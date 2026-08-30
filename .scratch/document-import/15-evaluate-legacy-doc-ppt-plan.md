# Evaluate and conditionally enable legacy DOC and PPT — plan

**Design:** [`15-evaluate-legacy-doc-ppt-design.md`](15-evaluate-legacy-doc-ppt-design.md)

The design settled the verdict — **DOC disabled, PPT disabled** — on facts 1–14, measured
2026-08-30 against real anydoc 0.2.4. This plan does not re-derive them. It lands the three
things the verdict implies, in four commits, and then answers the issue.

Every task names what it verifies and with what command. Nothing here says "passes" without
a run behind it.

## Collision note

A sibling agent is working issue 16 (spreadsheets) concurrently and will edit
`capability.ts`, `released-sources.ts`, `document.ts`, `testing/corpus.ts` and `README.md`
too. Each task below keeps its edit to those files to ONE contiguous block, added at a
predictable place (end of the capability array, end of the comment block in
`released-sources.ts`, one new branch in `document.ts`), so a manual merge is a pair of
adjacent inserts rather than an interleave.

`testing/corpus.ts` is deliberately NOT edited: the corpus is a list of cases that import
successfully through `importStructuredDocument`, and a disabled format has none. The
refusal is tested where refusals are tested (`document.browser.test.ts`,
`capability.test.ts`), not in the corpus.

---

## Task 1 — Park DOC and PPT in the capability table as `probe-only`

**Files:** `src/import/capability.ts` (one contiguous addition),
`src/import/released-sources.ts` (a comment only, one contiguous block at the end of the
file's list), `src/import/capability.test.ts`.

Add two entries at the END of `DOCUMENT_FORMAT_CAPABILITIES`, after `odp`:

- `doc` — label `Word 97–2003 document`, extensions `['.doc']`, media type
  `application/msword`, parser `anydoc`, `status: 'probe-only'`.
- `ppt` — label `PowerPoint 97–2003 presentation`, extensions `['.ppt', '.pps', '.pot']`,
  media types `application/vnd.ms-powerpoint` (one entry for three extensions, for the same
  reason PPTX has one for four: design fact 1 measured `pps` and `pot` mapping to `ppt`),
  parser `anydoc`, `status: 'probe-only'`.

Each carries a block comment naming the measurement that disabled it and a `limitations`
array whose FIRST string is the refusal itself, because `DocumentImporter.tsx` renders
`selectedCapability.limitations.join(' ')` under the file input for whatever capability the
filename matches — including a probe-only one. The prose must therefore read correctly as
"**Word 97–2003 document limitation:** Not imported. …".

No `probe` function is attached. A probe would be a lazy import of the Worker client for a
format nothing may route to it; the entry exists to say "known, and refused", not to offer
a path.

**Verify:** `capability.test.ts`'s probe-only assertion changes from `[]` to
`['doc', 'ppt']`, and gains assertions that neither extension appears in
`DOCUMENT_FILE_ACCEPT`, `STRUCTURED_DOCUMENT_FILE_ACCEPT`, `DOCUMENT_FORMAT_SUMMARY` or
`STRUCTURED_DOCUMENT_FORMAT_SUMMARY`, and that `releaseEnabledFormats()` is unchanged.
`npx vitest run --project unit src/import/capability.test.ts src/import/released-sources.test.ts`.

The second file in that command is the point: `RELEASED_SOURCES` is NOT touched, and the
reconciliation test must still pass, proving a probe-only entry is invisible to the
released set.

---

## Task 2 — Refuse a legacy file by name, with the fix in the message

**Files:** `src/import/document.ts` (one new branch in `enabledCapabilityFor`),
`src/import/document.browser.test.ts`.

`enabledCapabilityFor` currently collapses "unknown extension" and "known but not enabled"
into one message. Split them: when `capabilityForFilename` returns an entry whose status is
not `enabled`, throw a message naming that capability's label and its first limitation
instead of the generic list. Everything else about the function stays as it is, including
the generic message for a genuinely unknown extension.

**Verify:** a browser test that `importStructuredDocument` on a `File` named `lecture.doc`
rejects with a message naming Word 97–2003 and `.docx`, and on `deck.ppt` with one naming
`.pptx` — and that `chapter.docx` is unaffected. No legacy bytes needed: the refusal
happens before `file.arrayBuffer()`.
`npx vitest run --project browser src/import/document.browser.test.ts`.

---

## Task 3 — Commit the measurement harness

**File:** `scripts/measure-legacy-office.mjs` (new, no imports from `src/`).

One script carrying what the design's probes did: parse each file given (or every file in a
directory) with real anydoc, and print a TSV row per file of block counts by kind, heading
levels, table/list/image/asset/note counts, character count, parse ms and WASM memory —
plus a `--pair` mode that joins two runs on the filename stem and prints the deltas, which
is how facts 6, 8, 9, 10 and 12 were computed.

It documents in its own header that LibreOffice is required to produce or read back legacy
files, that the read-back is what makes an attribution valid, and that the docx→docx
control (design's Method section) is what proves the read-back is necessary.

**Verify:** run it against the repository's own generated DOCX/PPTX fixtures — no legacy
file required for the script itself to be exercised — and paste the output.
`node scripts/measure-legacy-office.mjs <dir>`.

---

## Task 4 — Say it in the docs, then answer the issue

**Files:** `README.md` (one paragraph, adjacent to the presentation paragraphs),
`.scratch/document-import/issues/15-evaluate-legacy-doc-ppt.md`,
`.scratch/document-import/map.md`.

The README paragraph states: legacy `.doc`, `.ppt`, `.pps` and `.pot` are not imported; save
as `.docx`/`.pptx` first; and the two reasons in one line each (a legacy Word file can lose
text-box content and can publish deleted text; a legacy deck loses every picture and
publishes speaker notes). Tightly scoped, because issue 17 is editing this file too.

The issue's `## Answer` records the verdicts, the driving measurement for each, and which of
the six criteria are closed. Criteria 1, 2 and 5 stay UNTICKED, for the reasons the design's
final section already states — the corpus was not built, browser cancellation was not
measured for legacy input, and criterion 5 has no subject because no format was enabled.
Criteria 3, 4 and 6 are ticked, each naming what closes it.

**Verify:** `npm run typecheck`, `npm test`, `npm run build`, output pasted into the Answer.

---

## Not doing, and why

- **No corpus case.** Design: a disabled format has no successful import to add to
  `testing/corpus.ts`, and the repository commits no binary it cannot regenerate.
- **No `security.browser.test.ts` case.** Its cases feed hostile bytes to a path a user can
  actually reach; a disabled format has none. Design fact 5's 24 malformed variants are the
  measurement, and they live in the design.
- **No change to `limits.ts` or `parser-limit-values.ts`.** Design fact 14: no legacy file
  crossed a budget a modern file does not also cross.
- **No `ImportedFormat` change.** `types.ts` already declares `'doc'` and `'ppt'`.
- **No `RELEASED_SOURCES` entry.** It lists what the release CAN import. A comment is added
  there in Task 1 saying these two were evaluated and deliberately excluded, so the absence
  reads as a decision rather than an oversight.
