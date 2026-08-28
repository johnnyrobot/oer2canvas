# 04 — Enable EPUB, ODT, and RTF structured imports

**What to build:** Extend the proven browser document workflow to EPUB, ODT, and RTF, enabling each format only when its representative corpus preserves useful reading order and semantic structure well enough for accessible Canvas-page remediation.

**Blocked by:** 03 — Import a text-only DOCX end to end.

**Status:** resolved

- [x] EPUB, ODT, and RTF files are identified by validated content and parsed locally through the shared worker workflow.
- [x] Each format has representative fixtures for headings, lists, links, tables, long documents, and malformed input.
- [x] The capability shown to users is generated from tested format support rather than an unconditional extension list.
- [x] Formats or individual documents that fail the quality threshold produce explicit limitations or blocking findings.
- [x] Passing fixtures complete preview, accessibility review, planning, and cartridge export through the shared path.
- [x] No imported file contents or parse results are transmitted to an application server.

## Answer

EPUB, ODT, and RTF now join DOCX in one release-enabled structured-document importer for desktop
Chrome and Firefox. Each file is size-checked before reading, content-signature validated rather
than trusted by name or MIME type, hashed locally, and transferred to a fresh cancellable AnyDoc
WebAssembly Worker. Parser output is rendered into the same controlled semantic HTML and then uses
the existing preview, accessibility review, Plan, and Common Cartridge path.

One capability table generates the accepted file types, visible format summary, selected-format
label, and format-specific limitation. The representative per-format corpus covers headings,
lists, links, accessible data tables, long input, and malformed input. Malformed or mismatched
files fail explicitly; embedded or unsupported content remains a visible blocker. Tests assert
that parsing makes no network request and the privacy/security documentation records that source
bytes, parser results, hashes, and derived pages stay in the browser.

Verification: TypeScript checks, the full test suite, production build, and built-bundle smoke test
pass. The built smoke keeps parser assets lazy, drives a real EPUB through the production UI, and
opens the downloaded cartridge to verify its heading, table text, and table semantics. The build
retains its pre-existing chunk-size warning.
