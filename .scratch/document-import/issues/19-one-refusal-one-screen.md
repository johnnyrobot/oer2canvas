# 19 — Explain a refused file once, on one screen

**What to build:** Make "this file cannot be imported" arrive the same way every time, so a user is
not sent to two different screens by two refusals that mean the same thing to them.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

**The two paths, both currently correct in isolation.** `src/import/document.ts:101` finds a blocker
in the reconciler's findings and throws, which lands the user back at the file picker with a message
and no partial page — right, because there is no page whose slide attribution would be safe to show.
`src/components/ImportPlanEditor.tsx:148` collects blockers and disables Prepare, keeping the user in
the plan editor — also right, because that page's attribution *is* trustworthy and the user may want
to see what they have.

The reasoning is sound and the user never sees it. They see the same sentence — this file cannot be
imported — delivered by two different screens, with no explanation of why one kept their work and the
other threw it away.

**It became visible in issue 14 and is recorded in two places already.** `map.md` carries it as
debt with no issue; `docs/RELEASE-ACCEPTANCE.md` §0 tells a human running the screen-reader check to
listen for it specifically, which is an admission that the difference is currently something a user
has to infer. A real Impress deck containing a chart takes the second path, because the GDI metafile
preview LibreOffice saves beside the chart cannot be packaged — so this is an ordinary file, not a
contrived one.

- [ ] The two refusal paths are described in one place, with the property that actually distinguishes them stated in a user's terms rather than the implementation's.
- [ ] A user who hits either path is told which one they are on and why, without needing to know what a reconciler is.
- [ ] A refusal that discards the user's work says so before discarding it, or stops discarding it.
- [ ] The distinction is announced, not merely rendered — this is exactly the case §0 flags for the screen-reader pass.
- [ ] Both paths are covered by a test that asserts what the user is told, not only that an error was raised.
- [ ] If the conclusion is that the two paths should converge into one screen, that is an acceptable outcome and the issue says so rather than preserving the split for its own sake.
