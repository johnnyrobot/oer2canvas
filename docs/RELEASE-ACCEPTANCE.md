# Release acceptance record

Most of what makes the document importer releasable is enforced by `npm test`, `npm run build`,
and the other commands a `scripts/verify-release.mjs` gate is expected to run automatically.
Three checks are not — and cannot be — part of that automated gate:

- **Live Canvas.** `npm run verify:canvas-live` writes to a real Canvas course and needs an
  administrator token for that instance. Handing that token to a CI job is a decision nobody
  should make casually, so the check stays something a human runs against an instance they
  personally administer, with the credential on their own machine.
- **Firefox.** The document-import release matrix is desktop Chrome and Firefox, but only
  Chrome is exercised by the automated Vitest browser project. This is a recorded decision, not
  an oversight: a second Vitest browser project roughly doubles browser-test wall time and adds
  a second flake surface, for engine differences that the Chromium keyboard, focus, and
  cancellation assertions mostly already catch. Firefox parity is attested here instead. If a
  Firefox-specific defect ever turns up in this record, that decision should be revisited.
- **Screen reader.** Axe (the tool behind the automated accessibility tests) checks
  machine-detectable rules — roles, names, contrast, focus order. It cannot tell you whether an
  announcement is comprehensible. An announcement can be technically present, read aloud by
  VoiceOver or NVDA, and still communicate nothing useful; only a human listening can catch that.

**Do not "fix" the gap by deleting these sections or by automating around what they actually
test.** If one of them stops applying (a format changes, a decision above gets revisited), edit
the reasoning above to say why — don't just remove the check.

Every entry below records a real run: the date it happened, who ran it, and the result. Nothing
in the three record tables is a placeholder — an empty table means the check has never been run,
and the `verify:release` gate is expected to report that as **NEVER RUN**, not as a pass. Each
table's first data column is a bare `YYYY-MM-DD` date so that gate can find the most recent row
by matching `^\|\s*(\d{4}-\d{2}-\d{2})\s*\|` against each line. Each row has
four cells, in this order: date, operator, result, notes. So a genuine entry — not written here as
a table row, on purpose, so nothing in this file before the first real run can be mistaken for one
— would carry a date of 2026-08-29, an operator such as jdoe, a result of PASS, and notes along
the lines of "two pages created, second import updated both in place."

Add new rows to the bottom of the relevant table after a real run. Do not edit or remove a past
row; if a later run finds the same thing, that repetition is itself useful evidence.

## 0. What a deck import does and does not do

Recorded here, not only in the capability table, because these are the behaviours a human
running the checks below will actually see on screen and could otherwise mistake for defects.

`.pptx`, `.pptm`, `.ppsx`, and `.ppsm` are one format to this importer — all four containers
report `pptx` from their own main-part content type — and `.odp` is a second. A deck of any of
them imports as **one proposed page whose slides are `<section data-slide="N">` sections**, each
led by an `<h2>`. It is not one page per slide; the page plan editor splits at any block boundary
if an instructor wants that.

- **Speaker notes are excluded, and the slides that had them are named.** If a note reaches an
  imported page, that is a defect, not a limitation — `src/import/corpus.browser.test.ts`
  asserts its absence directly.
- **Diagrams, charts, and embedded audio or video are not imported**, and each is named by a
  warning that gives the slide, the kind, and the count. A video's still poster frame does
  import as a picture; the warning is what records that a video, not a still, was there. The
  same holds for the preview picture Impress saves beside an embedded chart.
- **A slide with no title is titled `Slide N`** and named by a warning, so it can be renamed
  in the plan editor. This is common, not exceptional.
- **Two different refusals, with two different screens.** A deck whose slides cannot be matched
  to the deck's own outline is refused at the file picker with a message and never reaches the
  plan editor, because there is no partial page it would be safe to show. A deck carrying an
  image the importer cannot package instead reaches the plan editor with a blocking finding and
  a disabled Prepare button, because that page's slide attribution is still trustworthy. Both
  are correct; the difference is not currently explained to the user, and is worth watching for
  in the screen-reader run below.

**One ODF-specific behaviour worth expecting.** Impress records an embedded chart or diagram's
kind only in the package manifest, and saves a preview beside it as a VCL GDI metafile — a
format this importer cannot package. So a real Impress deck containing a chart produces BOTH the
`presentation-unrepresentable` warning naming the chart AND the ordinary unpackageable-image
blocker naming the preview, and does not import until the object is removed or replaced.
Expected behaviour, not a bug to report.

A PowerPoint deck with a chart **pasted in** from Excel produces only the second of those: it
blocks on the EMF preview and never names the chart, because a pasted chart is an OLE embedding
rather than the native chart shape the index counts. Measured, and pinned in
`src/import/presentation.browser.test.ts`. On this one construct ODP is better than PPTX; do not
read the two formats' limitations as describing identical behaviour here.

## 1. Live Canvas push

Verifies that a real import creates pages in a real Canvas course, and — the property page
identity actually depends on, since a page's identity is derived from the source content's hash
and its structural position rather than from anything Canvas assigns — that re-importing the
same document **updates** those pages instead of duplicating them.

**Requirements**, from `scripts/verify-canvas-release.mjs` and the README's "Optional self-hosted
Canvas push" section:

- A Canvas instance you administer, with a test/sandbox course on it. The course name must
  contain "test" or "sandbox" (case-insensitive) — the script refuses to run against any other
  course name.
- A paired self-hosted oer2canvas deployment (frontend + relay) pinned to that Canvas origin, per
  the README section above. Public deployments (including production) have no Canvas UI and
  cannot be used for this check.
- An administrator API token for the Canvas instance, used only for setup and cleanup — the
  script mints its own short-lived, scoped token for the actual push and revokes it afterward.

**Steps:**

1. In `.env.local` (never commit this file; the application itself never reads it), set:

   ```
   CANVAS_TOKEN=<an administrator token for the Canvas instance you administer>
   ```

2. Set the remaining required variables, either also in `.env.local` or inline on the command
   line:
   - `CANVAS_BASE_URL` — the Canvas origin, e.g. `https://canvas.example.edu`
   - `CANVAS_TEST_COURSE_ID` — the numeric id of the test/sandbox course
   - `SELF_HOSTED_APP_ORIGIN` — the paired self-hosted oer2canvas deployment, e.g.
     `https://oer2canvas.example.edu`

3. Run:

   ```sh
   npm run verify:canvas-live
   ```

   This one run performs the whole check: it creates a scoped token, drives a real import through
   the deployed app's UI, pushes it to the sandbox course, pushes the *same* import a second time,
   reads Canvas's own page list after each push to compare, and then restores the course to its
   original state (it deletes anything it created, revokes the scoped token, and removes any
   temporary enrollment it added).

4. Confirm the console output includes a line like:

   ```
   PASS self-hosted create/update: N page(s), second push created no duplicates
   ```

   That line is the update-not-duplicate proof: it comes from comparing Canvas's page listing
   after the first push against the listing after the second. A run that instead prints an error
   or omits this line is a FAIL.

5. Confirm the run also prints `PASS cleanup restored course ...` — the sandbox course should be
   left exactly as it was found.

**Record:** the course (its `CANVAS_TEST_COURSE_ID` and name), the page count `N` from the
create/update line, and confirmation that the second push replaced rather than duplicated pages.
On a FAIL, record the error text the script printed.

| Date | Operator | Result | Notes |
| --- | --- | --- | --- |
| 2026-08-30 | claude-code (automated, NOT a hand run) | PASS | Course 162, "oer2canvas release test (throwaway)" on canvas.johnnyrobot.ai — created for this run and deleted after it, so the only sandbox-named course on the instance (a dated demo course) was never written to. `PASS self-hosted create/update: 4 page(s), second push created no duplicates` — the second push updated all four in place. `PASS cleanup restored course 162; short-lived token revoked; temporary enrollment removed`. Sanitizer, keyboard and accessibility-tree checks on the Canvas body all passed. ONE OPEN FINDING, reported by the script as OPEN rather than PASS: `least-privilege token: this Canvas default developer key ignores manual-token URL scopes` — the scoped token this run minted was NOT actually restricted by Canvas, because this instance's default developer key does not have "enable scopes" switched on. That is an instance configuration fact, not a defect in this app, but it means the run's least-privilege property was not enforced by Canvas and should not be claimed. CAVEATS: the app under test was a local `vite` dev server (self-hosted-canvas mode) at http://localhost:5199 with `wrangler dev` serving /relay, not a deployed self-hosted origin; the admin credential was rotated after this run. PREREQUISITE FIX: this script had never run end to end, and its UI selector for the workflow step still said "Chapters" after the nav was renamed to "Content" — repaired in this commit. An empty record table hid a broken check, not just an unrecorded one. |

## 2. Firefox

By hand, in desktop Firefox, the same scenarios the Chromium suite automates for the document
import form (`DocumentImporter.tsx`, tested in `src/App.a11y.browser.test.tsx` and
`src/components/DocumentImporter.browser.test.tsx`):

- **a. Keyboard reaches the submit control.** Load the document import form fresh and press Tab
  repeatedly from the top of the page. Confirm focus reaches the "Inspect document" button in a
  sensible order, with no keyboard trap and nothing skipped.
- **b. Start an import and cancel it.** Choose a document, complete the rights question, click
  "Inspect document", then click the "Cancel import for …" button that appears while it's
  running. Confirm the status text clears, "Inspect document" re-enables, and the message reads
  "Document inspection cancelled. You can choose a file and try again." (Chromium proves the
  underlying cancellation mechanism at the parser level in `src/import/file.browser.test.ts` and
  `src/import/pdf.browser.test.ts`; this scenario is the UI path to the same abort.)
- **c. Trigger an error and confirm focus lands on the message.** Submit the form without a file,
  or choose a file the parser rejects (e.g. a malformed `.docx`/`.epub`/`.odt`/`.rtf`). Confirm
  the resulting error message receives keyboard focus immediately — this is the same assertion
  `DocumentImporter.browser.test.tsx` makes in Chromium (`expect(alert).toHaveFocus()`).
- **d. Confirm the progress line is announced.** While an import is running, confirm a screen
  reader (or Firefox's own accessibility inspector) reports the changing status text — "Reading
  the selected file…", then phase labels such as "Loading the local document parser…" and
  "Reading the document locally…" — without needing to move focus. This text lives in a
  `role="status"` `aria-live="polite"` region in `DocumentImporter.tsx`.

**Record:** pass or fail for each of the four scenarios above, by date and operator.

| Date | Operator | Result | Notes |
| --- | --- | --- | --- |
| 2026-08-30 | claude-code (automated, NOT a hand run) | PASS | All four scenarios pass in Gecko. a: 12 Tabs from page top reach "Inspect document", no trap (file > title > author > publisher > source URL > license name > license URL > rights radio > acknowledge checkbox > submit). b: cancel control labelled "Cancel import for <title>"; on click the status region clears, the cancel button is removed, "Inspect document" re-enables, and the message "Document inspection cancelled. You can choose a file and try again." appears in the role=alert, not the role=status region — §2b's "status text clears" and "the message reads" are two different elements. c: a malformed .docx focuses the role=alert reading "AnyDoc could not inspect this file. malformed document: not a readable zip archive: invalid Zip archive: Could not find EOCD". d: role=status aria-live=polite moved "Loading the local document parser…" -> "Reading the document locally…" with focus never leaving body. Also confirmed a real 6000-paragraph DOCX parses in the WASM worker under Gecko and advances past the form. CAVEATS: driven by scripts/firefox-acceptance-probe.mjs under Playwright's patched Gecko build (Firefox 153.0), not stock desktop Firefox; scenario b delayed the .wasm fetch 6s to widen the click window; scenario d read the live region's DOM text, not an actual assistive technology. A human hand-run may supersede this row. |

## 3. Screen reader

Using VoiceOver or NVDA, complete one full document import end to end: the form, the findings,
the page plan, and the export.

**A worksheet exists so this is a confirmation, not an exploration.**
`node scripts/screen-reader-worksheet.mjs` prints, in order, every control, heading and live-region
announcement on this path, captured from the running app — including the three status phrases the
progress region actually emits. Running it **records nothing and closes nothing**: every item it
prints is one a screen reader would voice whether or not it means anything, which is the only
question §3 asks. Two things it surfaced that are worth listening for specifically: the destination
buttons concatenate their label and their explanation into one accessible name with no separator
("A Canvas coursePushes pages straight into a course you choose…"), and the workflow steps do the
same with their state ("Content— choose where this goes first").

**Steps:**

1. Turn on VoiceOver (macOS) or NVDA (Windows) and open the app.
2. Go through the document import form: choosing a file, the rights question, and submitting it.
3. Listen through the "Import findings" panel (if the import produced any).
4. Listen through the page plan screen: the proposed pages, titles, and any split/merge controls.
5. Complete the plan and listen through to the export/push confirmation.

**Record what was unclear, not merely pass or fail.** An announcement that is technically present
and read aloud but conveys nothing useful — an unlabeled control, a status update with no
context, a heading level that doesn't match what's on screen — is exactly the kind of defect this
check exists to surface. A bare "pass" hides that; write down what was confusing, ambiguous, or
silent, even if nothing was broken outright.

| Date | Operator | Result | Notes |
| --- | --- | --- | --- |
| 2026-08-30 | johnnylibretexts | PASS | One full document import completed end to end with VoiceOver on macOS: the import form, the findings, the page plan, and the export. Operator reported it worked fine and raised no specific confusion. Recorded as reported. NOTE, so a later reader is not misled about how much this row covers: this section asks for what was UNCLEAR rather than a verdict, and no unclear item was reported, so the Notes column is thin by circumstance rather than because every announcement was examined and found good. Two constructs that `scripts/screen-reader-worksheet.mjs` had flagged in advance were NOT reported as problems by the operator and are therefore not defects on this run's evidence — both concatenate a label and its explanation into one accessible name with no separator ("A Canvas coursePushes pages straight into a course you choose…" and "Content— choose where this goes first"). If a later run finds either confusing, that repetition is the useful evidence this table exists to collect. |

## 4. IDEA review — slice 1

1. Prepare one OpenStax chapter through Review until the queue is clear.
2. Sidebar: **IDEA — optional** is enabled; **Plan** is enabled regardless.
3. Open IDEA. The chapter's pages are readable beside the panels, with no accessibility panels
   in them. Only 7.1 is expanded. Rate all three 7.1 rows; the header reads "3 of 3 rows rated"
   and the sidebar reads **IDEA — 1 of 8 rated**. Plan shows "IDEA review — 1 of 8 rated".
4. Answer two checklist items and type a note under 7.6. Rate 7.6 "Not Applicable"; its header
   reads "rated".
5. Set the benchmark to 62 and the assessor name. Type a Summary and a Suggestion.
6. **Reload the tab.** Prepare the same chapter again. Open IDEA: every rating, note, the
   summary, the benchmark, and the assessor are still there.
7. Download Markdown. The status line names the file. Open it: header carries the textbook,
   chapter, assessor, and "62%"; the table has 10 rows (3 + 7) under Rubric 1's own area titles;
   7.6 reads "Not Applicable" with the note; unrated rows read "Not rated"; the Category count
   block sums to 10; Summary and Suggestions carry what was typed; the CC BY 4.0 attribution is
   at the foot.
8. Download JSON. `areas[0].rows` has three entries with ratings; `areas[5].rows[0].rating` is
   `"na"`; `counts` sums to 10; `summary` and `suggestions` are present.
9. Prepare a second chapter of the same book. Its review starts blank; the assessor and
   benchmark are already filled in.
10. **Forget all IDEA reviews** → confirm. Both reviews, the assessor, and the benchmark reset.
    Reload: still empty.
11. Build the cartridge. Confirm no `idea-rubric1-*` file is inside it.

## 5. IDEA review — slice 2

1. Prepare an OpenStax chapter whose text contains "suffers from" or "chairman" (Human Biology
   4.2 Nutrients, or paste a paragraph via the Text tab).
2. IDEA → 7.6 shows "N suggestions" in its header; open it. Focus the Replace button: the
   paragraph is outlined in the chapter render beside the panels and scrolled into view.
3. Replace one; it moves to Applied; the render shows "Re-checking this section…" and then the
   new wording within a second, and the Source-and-license block ends with the "Modified from the
   original" sentence.
4. Undo it; the wording and the sentence revert.
5. Replace it again. **Reload the tab** and prepare the same chapter: the replacement is already
   applied in the render, listed under Applied, and the sentence is present — without pressing
   anything. Dismiss a different suggestion, reload again: it is back.
6. Export the cartridge, unzip: the page HTML carries the replacement and the sentence; no
   `idea-rubric1-*` file is inside.
7. Answer an alt-text item in Review before step 6 if any exist: the exported page carries the
   answered alt (Task 1's lift).
8. **Forget all IDEA reviews** → confirm. Applied is empty; the render shows the original wording
   after the recompile.

## 6. IDEA review — slice 3

1. Prepare an OpenStax chapter with figures (Biology 2e, any chapter).
2. IDEA → 7.1's header reads "N images · M mention people"; open it. The first row is the summary;
   each image row shows description, caption, reference; focusing a row outlines the image in the
   chapter render beside the panels and scrolls it into view.
3. 7.7's header reads "N items"; open it: headings, key terms, and recurring names are listed.
4. Neither zone has Replace, Use this wording, or Dismiss.

## 7. IDEA review — slice 4

1. IDEA header: choose OpenRouter, paste a key, Save on this device. Reload the tab: the provider
   and model are remembered; the key field shows dots.
2. Open 7.2. The disclosure sits above "Send this section to OpenRouter". Press it; the status
   line reads "Waiting for OpenRouter…"; drafts appear with a dashed border and a "draft" chip.
3. A draft whose original matches the text has Replace; accept one; it lands in Applied and in the
   chapter render beside the panels. Reload and re-prepare: the accepted edit is still applied;
   the unaccepted drafts are gone until you send again.
4. Press "Draft a Rubric 1 review with OpenRouter". Every rubric row shows a "Model draft:" line
   beside its radios — three under 7.1, one elsewhere, "no draft" where the model gave nothing —
   and each category a notes box; the radio buttons stay unchecked; "Use this note" fills Notes
   only.
5. Paste a wrong key, Save, send again: "The provider rejected this key." No key text anywhere
   on screen or in DevTools → Network → request URL.
6. Forget key; reload: nothing is remembered. DevTools → Application → IndexedDB → oer2canvas →
   kv: no `idea.llm.settings` key; the `idea.reviews` document is untouched. Then *Forget all
   IDEA reviews*: reviews go, and a saved key would stay.
7. Network tab throughout: no request to `/relay`. Ollama Cloud is listed as "(not available)"
   and cannot be chosen; the "measured" link opens the evidence file.

## 8. IDEA review — slice 5

1. Prepare an OpenStax chapter. IDEA → 7.1 → Find an openly licensed photo. Search "students
   laboratory" on Wikimedia Commons with all four licences on. Results show titles, creators,
   and licence badges; none says NC or ND.
2. Use one. The dialog names the credit; leave alt empty and press Use: "Not saved: the
   description is empty." Type a real description; choose "After …" a paragraph; Use.
3. The chapter render beside the panels shows the image within a few seconds with the caption
   ending in "(source)". The Source-and-license block ends with "Additional image: …" and, for a
   BY-SA image, the share-alike sentence. The 7.1 Applied list shows "Image added: …" with Undo.
4. **Reload the tab** and prepare the same chapter: the image is in the render and in Applied
   without pressing anything. DevTools → Application → IndexedDB → oer2canvas → kv →
   `idea.reviews` carries the bytes.
5. Export the cartridge; unzip: `web_resources/oer2canvas/<name>` exists and the page's `<img>`
   references it with the alt text typed.
6. The Source select lists Openverse as disabled with "could not be reached from a browser when
   last measured" beneath. (If a later probe offers it: choose a Flickr-hosted result; if the host
   refuses the fetch, the dialog says which host and points to Document import; nothing is added.)
7. Network tab: requests only to commons.wikimedia.org, upload.wikimedia.org, and thumb.wikimedia.org.
   None to `/relay`.
8. *Forget all IDEA reviews* → confirm; the image leaves the render after the recompile, and the
   next export carries neither the figure nor the credit.
