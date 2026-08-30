# 15 — Evaluate and conditionally enable legacy DOC and PPT files

**What to build:** Determine whether legacy DOC and PPT files can meet the same browser-only extraction, safety, semantic-quality, and Canvas-export standards as modern documents, and expose them only when the evidence supports doing so.

**Blocked by:** 13 — Harden and release the core document importer; 14 — Graduate presentation formats through the document workflow.

**Status:** claimed

- [ ] A dedicated corpus covers representative DOC and PPT content, malformed files, large files, and known conversion ambiguities.
- [ ] Browser parsing, cancellation, resource use, and extraction quality are measured against the established import budgets.
- [ ] Reading order, structure, tables, links, notes, and embedded media are compared with the source using documented criteria.
- [ ] Each legacy format receives a clear enabled, limited, or disabled decision with reproducible evidence.
- [ ] Any enabled format completes the same planning, accessibility-review, asset, and cartridge-export workflow as its modern counterpart.
- [ ] Disabled formats produce an accurate capability message and do not appear as generally supported file types.
