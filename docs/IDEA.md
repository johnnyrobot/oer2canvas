# IDEA review — data boundary and licensing

This file states, in one place, what the IDEA phase does with data. It is kept current slice by
slice; the design is in `IDEA_REVIEW_SPEC.md`.

## Slice 1 (this release)

- **Network:** none. The Framework text is vendored; the Rubric 1 export is built in the browser
  and handed to the browser's download.
- **Storage:** the review (ratings, checklist answers, notes, summary, suggestions, per chapter),
  the assessor, and the benchmark are written to the app's IndexedDB database
  (`oer2canvas`, key `idea.reviews`) on this device, debounced after each change. They are read
  back on load through a validating restore that replays them through the reducers, so a stale or
  edited document degrades to "nothing recorded", never to a rating nobody clicked. *Forget all
  IDEA reviews* removes the document. Clearing the prepared output does not: reviews are keyed by
  chapter identity, so a re-prepared chapter finds its own review and a different book starts
  blank.
- **Inference:** none. The app never infers race, ethnicity, gender, or disability from anything.
  Every rating and checklist answer is entered by the instructor.
- **Gate:** none. `phaseAvailability(...).plan` reads no IDEA field. IDEA never blocks Plan.
- **What is shown:** the chapter's gated, repaired HTML — the same bytes Review approved — beside
  the rubric. Nothing from the raw or un-audited compile is rendered there.

## Licensing of what ships

- Framework text: CC BY 4.0, ASCCC OERI, reproduced in full, attributed in the panel footer and
  THIRD-PARTY-NOTICES.md.
- The ASCCC-hosted Culturally Responsive Curriculum Assessment Tool is CC BY-NC-SA and is
  linked, never embedded.

## Later slices (not yet shipped)

- Rule checks and inventories run in the browser with no network.
- Model calls go browser → the chosen provider, on click only, with the user's key stored in
  the user's browser on the user's device and nowhere else. No key ever transits the relay.
- Image search goes browser → Wikimedia Commons / Openverse, query text only.
