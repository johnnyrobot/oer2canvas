# IDEA review — data boundary and licensing

This file states, in one place, what the IDEA phase does with data. It is kept current slice by
slice; the design is in `IDEA_REVIEW_SPEC.md`.

## Slices 1–4 (this release)

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
- **Rule checks:** the terminology, gendered-noun, and idiom lists are vendored JSON
  (`src/engine/idea/data/`, CC BY 4.0) and run in the browser over the compiled section; no
  network.
- **Edits:** an accepted suggestion is a map entry applied by a compile step on every recompile,
  including the first compile of a re-prepared chapter. The section is re-audited before it can be
  published again. Every applied edit adds one sentence to the page's Source-and-license block:
  "Modified from the original: wording updated for inclusive language."
- **Storage, extended:** edits are saved in the same IndexedDB document as the ratings and
  restored through the same validating replay; *Forget all IDEA reviews* removes them too. A
  dismissed suggestion is not saved — it is hidden for this session only.
- **The queue's answers now leave the queue screen:** Plan's count and the export describe the
  answered chapter (a pre-existing gap closed by this slice's first task).
- **Inventories:** 7.1 lists every image's alt text, caption, and preceding sentence and whether
  that text names a person (a fixed noun list — "nurse", "students", "family" — over the image's
  own text). 7.7 lists headings, glossary and defined terms, key-takeaway blocks, and capitalised
  names that recur. Neither infers anything about anyone; both exist so the assessor can tally for
  Rubric 1 from a list rather than by scrolling. Inventory rows are recomputed from the prepared
  HTML on every render and are never stored.
- **Model calls (slice 4):** go browser → the chosen provider, on click only, with the user's key
  stored in the user's browser on the user's device (IndexedDB key `idea.llm.settings`) and
  nowhere else. No key ever transits the relay. Providers offered are those a browser origin was
  measured to reach directly (`docs/evidence/idea-llm-cors-2026-09-12.md`); a provider that fails
  that probe is not offered, and there is no relay fallback. What is sent is the section's block
  text and its image and metadata inventories; for 7.1 only the image inventory. Every model
  output is `origin: 'draft'`; an item becomes an edit only when its quoted original is found
  verbatim in the section, and it then goes through the same edits map as a rule finding. The
  Rubric 1 draft is per row, rendered beside the human's radios, and cannot be copied into them;
  only its notes have a one-click "Use this note". Runs and drafts are React state and are never
  stored. *Forget key* removes the key; *Forget all IDEA reviews* does not touch it.

## Licensing of what ships

- Framework text: CC BY 4.0, ASCCC OERI, reproduced in full, attributed in the panel footer and
  THIRD-PARTY-NOTICES.md.
- The ASCCC-hosted Culturally Responsive Curriculum Assessment Tool is CC BY-NC-SA and is
  linked, never embedded.

## Later slices (not yet shipped)

- Image search goes browser → Wikimedia Commons / Openverse, query text only.
