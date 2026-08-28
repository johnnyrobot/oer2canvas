# 07 — Validate embedded-image behavior in a real Canvas sandbox

**What to build:** Run the deterministic image probes against a controlled Canvas sandbox and record enough evidence to select the manifest and page-reference strategy that the production exporter can safely implement.

**Blocked by:** 06 — Generate deterministic Canvas embedded-image probe cartridges.

**Status:** resolved

- [x] Every probe variant is imported into a real Canvas sandbox using the documented procedure.
- [x] Evidence records rendered pages, stored page HTML, resulting Files paths, shared-image behavior, and Canvas re-export results.
- [x] The winning manifest layout and URL-reference strategy are identified explicitly, including any media-type limitations.
- [x] Unexpected Canvas rewriting or loss is documented with a reproducible probe rather than inferred from documentation.
- [x] The evidence states whether a second Canvas environment or version produced materially different behavior.
- [x] Production image packaging remains blocked if no probe strategy survives import and re-export acceptably.

## Answer

All four probe cartridges were imported into a live Canvas instance from their recorded SHA-256
hashes. Each variant got three clean courses — import, course-copy destination, and re-export
reimport — twelve in total, created and deleted by the run.

**`standalone-webcontent` is the shape production may implement.** `webcontent-dependencies` also
passed every required behavior; the recommendation breaks the tie toward the simpler manifest.
`page-owned-files` and `associatedcontent-dependencies` failed outright: Canvas reported
`completed`, emitted four `Missing links found in imported content` warnings, and attached **no
course files at all**, leaving every reference unresolved.

Production must declare each asset as a standalone `<resource type="webcontent">`; page-owned
`<file>` children and `associatedcontent` do not work. Page `<dependency>` elements are optional and
changed nothing. References should be emitted as `$IMS-CC-FILEBASE$/<path relative to
web_resources/>` — Canvas accepted the archive-root form the probes packaged but its own export
emits the `web_resources`-relative form, and both import. Canvas strips `web_resources/` when placing
files, so `web_resources/probe/single.png` becomes `course files/probe/single.png`. Byte-identical
files were **not** deduplicated. One asset shared by two pages resolved to a single Canvas File from
both and stayed single through a course copy.

PNG, JPEG, GIF, and WebP each decoded on all three measured surfaces and are decided individually.
Canvas rewrites the reference to an absolute `/courses/<id>/files/<id>/preview` URL and adds
`loading="lazy"` plus `data-api-*` attributes; alt text, width, and height survived unchanged.
Re-exporting a course imported through a failing shape produced a corrupt hybrid
(`http://<canvas>/courses/<id>/file_contents/$IMS-CC-FILEBASE$/...`, downgraded to `http`) containing
no image entries, so a failing shape breaks Canvas's own export and not just rendering.

Evidence is checked in at `docs/evidence/canvas-image-probes-2026-08-28.md` and
`docs/evidence/canvas-image-probes-2026-08-28.json`. Screenshots and re-export archives stay in the
ignored `artifacts/canvas-image-probe-evidence/` and are reproducible with
`npm run probe:canvas-images:run`.

**Limitation:** one Canvas environment only, so nothing here is cross-version evidence. Fixtures are
16×16 synthetic rasters and bound nothing about large images, animated GIFs, or upload limits.

Verification: both TypeScript projects, 24 focused evidence-rule tests, and the full suite pass. The
four probe hashes are unchanged from issue 06, so this run measured exactly those cartridges.
