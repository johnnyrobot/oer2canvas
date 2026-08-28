# 16 — Decide and gate spreadsheet imports

**What to build:** Establish whether browser-parsed spreadsheets preserve enough worksheet identity, cell provenance, and table structure to produce accessible Canvas content; either define a narrow implementable spreadsheet tracer or keep the capability explicitly disabled with evidence.

**Blocked by:** 13 — Harden and release the core document importer.

**Status:** ready-for-agent

- [ ] The evaluation corpus covers multiple worksheets, headings, merged cells, formulas, hidden content, sparse ranges, and large tables.
- [ ] The browser parser is assessed for worksheet identity, cell order, provenance, displayed values, and resource usage.
- [ ] An accessibility policy defines when a worksheet can become an HTML table and when it must be split, summarized, or rejected.
- [ ] Security and privacy checks cover formulas, external references, macros, hidden data, and unexpected embedded content.
- [ ] The outcome is a documented enablement decision backed by fixtures and measurements.
- [ ] If feasible, the decision includes acceptance-ready boundaries for a narrow vertical implementation ticket; otherwise spreadsheet selection remains unavailable with an accurate explanation.
