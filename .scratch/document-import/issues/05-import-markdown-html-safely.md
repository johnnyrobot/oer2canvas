# 05 — Import Markdown and HTML safely

**What to build:** Let a user paste or upload Markdown and HTML, convert it into inert and controlled semantic content, disclose any removed or unsupported material, and complete the same preview, remediation, review, and cartridge-export workflow as other sources.

**Blocked by:** 01 — Import plain text into a Canvas cartridge.

**Status:** ready-for-agent

- [ ] A user can paste or select Markdown and HTML and receives a preview without executing source scripts, handlers, or active embeds.
- [ ] Markdown is parsed through a controlled grammar and raw HTML follows the same sanitization policy as uploaded HTML.
- [ ] Dangerous URLs, active content, unsupported elements, and unsafe attributes are removed or blocked with visible findings.
- [ ] Headings, lists, links, tables, code blocks, and other supported semantics survive normalization predictably.
- [ ] Hostile fixtures demonstrate that imported content cannot execute in preview, review, or exported-page generation.
- [ ] Audited HTML bytes remain identical to the bytes written into the cartridge.
