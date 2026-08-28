# 10 — Let users approve and edit the proposed page plan

**What to build:** Turn an imported document into a deterministic proposed set of Canvas pages that the user can inspect, rename, include or exclude, split, merge, and reorder before confirming it for accessibility review and export.

**Blocked by:** 01 — Import plain text into a Canvas cartridge; 04 — Enable EPUB, ODT, and RTF structured imports; 05 — Import Markdown and HTML safely.

**Status:** ready-for-agent

- [ ] The same imported content produces stable page identities and page boundaries across repeated runs.
- [ ] A user can preview, rename, include, exclude, split, merge, and reorder proposed pages without reparsing the source file.
- [ ] Page-editing controls are fully keyboard operable, expose meaningful accessible names, and announce important state changes.
- [ ] Document title, attribution, source URL when present, and rights metadata remain editable and flow into the export plan.
- [ ] Reconfirming a changed plan invalidates stale compiled or audited output and sends only the confirmed pages into review.
- [ ] Empty plans, duplicate names, invalid splits, cancellation, and restoration after a recoverable error have clear behavior.
