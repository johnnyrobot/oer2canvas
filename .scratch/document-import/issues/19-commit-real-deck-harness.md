# 19 — Commit the real-file deck harness

**What to build:** A committed way to run presentation files that real producers wrote through the real import path, so the measurement that found issue 14's two worst defects is repeatable by someone other than the person who improvised it.

**Blocked by:** 14 — Graduate presentation formats through the document workflow (resolved).

**Status:** ready-for-agent

## Why this exists

Issue 14 built eleven synthetic corpus cases, 1,537 tests, and a release gate that passed on
all seven criteria. **The final whole-branch review then ran files real producers wrote and
recommended against merging.** It found two Criticals that every synthetic test had missed:

- ordinary footer, slide-number and date placeholders refused whole decks (anydoc renders no
  text for them; the index read them anyway), measured on 4 of 15 real decks;
- a blank line in an Impress text box orphaned every block after it — 432 of 434 on a real
  13-slide deck.

A third defect surfaced the same way: anydoc drops U+200B and U+00AD from rendered text while
the deck's XML keeps them, and `\s` does not match U+200B. Four zero-width spaces refused a real
teaching deck.

Every *shape* those files found is now a fixture and a corpus case. But **the harness itself
was never committed** — it lived in `/private/tmp` and read decks from a personal filesystem.
Nothing in the repository makes the next person run it, and the next defect of this kind will
only be found the same way.

The lesson issue 14 recorded, in its own words: *for these formats, a claim about what a
producer writes is worth nothing until a producer has written it.*

## The privacy constraint, stated up front

The harness reads presentation files from the operator's own machine. **It must commit no
document bytes and no filenames**, and it must be obvious from the script and its output that
it is scanning personal files. This repository already handles source documents as
memory-only and says so in `PRIVACY.md`; a harness that quietly indexed someone's Documents
folder into a committed report would contradict that.

- [ ] A committed script under `scripts/` sweeps local presentation files and drives each through the real import path, in a real browser against the real parser — not a mocked or unit-level path.
- [ ] It reports per file: whether the import threw, which findings it raised, and which of those this module itself caused versus the shared core importer. Issue 14's refusal counts were misread until those were separated.
- [ ] It commits no document bytes and no filenames, and its own output makes clear it read personal files.
- [ ] Running it requires no arguments a reader has to guess: where it looks, and how to point it elsewhere, are documented in the script itself.
- [ ] It is NOT wired into CI — it depends on files only the operator has. `docs/RELEASE-ACCEPTANCE.md` names it as an attested check, the way that document already treats the Firefox, screen-reader and live-Canvas rows.
- [ ] A short record of what the last run measured, and when, so a later reader knows what is stale — the pattern `DOCUMENT_IMPORT_LIMIT_EVIDENCE` already uses for the parser benchmark.
