# IDEA review — data boundary and licensing

This file states, in one place, what the IDEA phase does with data. It is kept current slice by
slice; the design is in `IDEA_REVIEW_SPEC.md`.

## Slices 1–5 (this release)

- **Network:** two paths, each on a click and each described below — a model call (slice 4) and an
  image search (slice 5). Nothing else: the Framework text is vendored, the rule checks and
  inventories run in the browser, and the Rubric 1 export is built in the browser and handed to
  the browser's download. Two more, each on its own click, complete OERI's Crosswalk (design:
  `IDEA_CROSSWALK_SPEC.md`): a **whole-book send** (*Across the chapters*: every prepared chapter's
  section text and image descriptions plus the instructor's Rubric 1 ratings and notes, and the
  session's Rubric 1 drafts, to the chosen provider in one request; its size is stated before Send
  and it is refused, never truncated, above the provider's ceiling) and a **per-chapter plan send**
  (*Plan the revisions*: this chapter's ratings, notes, applied edits, and this session's undecided
  drafts — no section text). These two clicks are the only ones that send the instructor's own
  words, apart from the region-served field, which, if filled, also goes into the per-section 7.4
  send (and into the book and plan prompts, and into no export). Neither result is stored; the
  downloads are the record, and the plan's instructor list also goes into the chapter's Rubric 1
  file when one exists at export time.
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
- **Image search (slice 5):** goes browser → Wikimedia Commons / Openverse, query text only, no
  key, on Search only. Only CC0, CC BY, CC BY-SA, and public-domain results are shown; a result
  whose licence metadata does not parse is dropped, not shown with a warning, and Commons
  categories that mark a file as not for reuse drop it too. Providers offered are those a browser
  origin was measured to reach (`docs/evidence/idea-image-api-<date>.md`); Openverse is listed
  but not offered while its anonymous tier times out from page script, and there is no relay.
  Unsplash and Pexels are not integrated (non-CC licences; Unsplash's hotlink rule conflicts with
  packaging). The chosen image's bytes are fetched by the browser from the result's host, put
  through the same sniff/hash/name path as every imported image, and packaged into the cartridge;
  a host that refuses the fetch is named, with Document import as the way out. Placement requires
  alt text and checks it with the same rules the queue's Save uses. The caption and the
  Source-and-license block carry Title · Author · Source · License; CC BY-SA adds the
  share-alike sentence. No ranking or filtering by anything the Framework would call identity.
- **Storage, extended (slice 5):** an image added through IDEA is stored with its bytes in the
  same document as the reviews and edits, so it survives a reload; an image edit whose bytes are
  missing is dropped on restore rather than exported as a broken reference. *Forget all IDEA
  reviews* removes the bytes too.

## Licensing of what ships

- Framework text: CC BY 4.0, ASCCC OERI, reproduced in full, attributed in the panel footer and
  THIRD-PARTY-NOTICES.md.
- The ASCCC-hosted Culturally Responsive Curriculum Assessment Tool is CC BY-NC-SA and is
  linked, never embedded.
- Images added through the IDEA review carry the licence each result declares; the page credits
  each one, and the project does not relicense them.

## Deferred (not shipped; spec §9)

- Image generation, for the case where no suitable open-licensed photo exists — deferred by
  decision. Rubric 2 (new-OER guide) mode. No further network path is planned.
