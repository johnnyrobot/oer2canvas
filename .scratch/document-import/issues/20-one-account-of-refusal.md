# 20 — Give a refused import one account of itself

**What to build:** One coherent explanation of "this file cannot be imported", so a user meets the same story wherever the refusal came from.

**Blocked by:** 13 — Harden and release the core document importer (resolved); 14 — Graduate presentation formats (resolved).

**Status:** ready-for-agent

## Why this exists

A document can be refused by two different layers, and today they produce two different
screens with no relationship to each other:

- **A parser-level blocker** — an image that cannot be packaged, an equation, a DOCX footnote —
  returns an `ImportResult`. The user lands in the plan editor, sees a preview of the page, and
  finds the Prepare button disabled.
- **A reconciler-level blocker** — a deck whose content cannot be attributed to its slides —
  **throws**. The user is bounced back to the file picker with an error and no page at all.

Both are correct in isolation, and the difference is defensible: one has trustworthy HTML to
show, the other does not, and issue 14 chose to throw precisely because the plan editor renders
its preview unconditionally and gates export on a single `disabled` attribute. But **the
difference is explained to the user nowhere**, and the two screens do not acknowledge each
other's existence.

Issue 14 carried this as a note on the map rather than an issue. It became more visible there,
because a real Impress deck containing a chart takes exactly the first path — its GDI metafile
preview cannot be packaged — while a deck whose slides do not line up takes the second.

## What this is not

This is not a request to make the two paths identical. The throw exists for a measured reason:
returning misattributed HTML would render it immediately, and the export gate is one attribute
away from letting it through. Any change here must keep the property that **nothing publishes
on a blocker**.

- [ ] A user meeting either refusal is told the same three things: that the file cannot be imported as it stands, why, and what would have to change about the file.
- [ ] A refusal that names one contained construct (an equation, one unpackageable image) is distinguishable from one that says the document and its own structure disagree — the second is not the user's mistake in the same way.
- [ ] The reconciler's blocker no longer discards the deck's other findings; a refused deck can carry its speaker-notes and untitled-slide warnings too, so the user sees everything they would have to fix, not the first thing that stopped the walk.
- [ ] The property that nothing publishes on a blocker is preserved, and is asserted rather than assumed — including that no HTML built from unattributed content reaches a preview or an export.
- [ ] The accessibility review covers whichever screens change; a refusal a screen-reader user cannot find is not a refusal.
- [ ] `docs/RELEASE-ACCEPTANCE.md`'s note about the two screens is resolved or rewritten to describe what ships.
