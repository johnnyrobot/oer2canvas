# 04 — Enable EPUB, ODT, and RTF structured imports

**What to build:** Extend the proven browser document workflow to EPUB, ODT, and RTF, enabling each format only when its representative corpus preserves useful reading order and semantic structure well enough for accessible Canvas-page remediation.

**Blocked by:** 03 — Import a text-only DOCX end to end.

**Status:** ready-for-agent

- [ ] EPUB, ODT, and RTF files are identified by validated content and parsed locally through the shared worker workflow.
- [ ] Each format has representative fixtures for headings, lists, links, tables, long documents, and malformed input.
- [ ] The capability shown to users is generated from tested format support rather than an unconditional extension list.
- [ ] Formats or individual documents that fail the quality threshold produce explicit limitations or blocking findings.
- [ ] Passing fixtures complete preview, accessibility review, planning, and cartridge export through the shared path.
- [ ] No imported file contents or parse results are transmitted to an application server.
