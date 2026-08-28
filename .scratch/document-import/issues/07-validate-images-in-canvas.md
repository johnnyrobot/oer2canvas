# 07 — Validate embedded-image behavior in a real Canvas sandbox

**What to build:** Run the deterministic image probes against a controlled Canvas sandbox and record enough evidence to select the manifest and page-reference strategy that the production exporter can safely implement.

**Blocked by:** 06 — Generate deterministic Canvas embedded-image probe cartridges.

**Status:** ready-for-human

- [ ] Every probe variant is imported into a real Canvas sandbox using the documented procedure.
- [ ] Evidence records rendered pages, stored page HTML, resulting Files paths, shared-image behavior, and Canvas re-export results.
- [ ] The winning manifest layout and URL-reference strategy are identified explicitly, including any media-type limitations.
- [ ] Unexpected Canvas rewriting or loss is documented with a reproducible probe rather than inferred from documentation.
- [ ] The evidence states whether a second Canvas environment or version produced materially different behavior.
- [ ] Production image packaging remains blocked if no probe strategy survives import and re-export acceptably.
