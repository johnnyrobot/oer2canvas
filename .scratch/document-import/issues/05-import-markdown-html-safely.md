# 05 — Import Markdown and HTML safely

**What to build:** Let a user paste or upload Markdown and HTML, convert it into inert and controlled semantic content, disclose any removed or unsupported material, and complete the same preview, remediation, review, and cartridge-export workflow as other sources.

**Blocked by:** 01 — Import plain text into a Canvas cartridge.

**Status:** resolved

- [x] A user can paste or select Markdown and HTML and receives a preview without executing source scripts, handlers, or active embeds.
- [x] Markdown is parsed through a controlled grammar and raw HTML follows the same sanitization policy as uploaded HTML.
- [x] Dangerous URLs, active content, unsupported elements, and unsafe attributes are removed or blocked with visible findings.
- [x] Headings, lists, links, tables, code blocks, and other supported semantics survive normalization predictably.
- [x] Hostile fixtures demonstrate that imported content cannot execute in preview, review, or exported-page generation.
- [x] Audited HTML bytes remain identical to the bytes written into the cartridge.

## Answer

Implemented paste and UTF-8 file import for Markdown and HTML through the existing source-neutral
document path. Markdown uses a pinned isolated Marked GFM parser; Markdown raw HTML and direct HTML
then share one detached-DOM semantic sanitizer. The importer removes active content, unsafe URLs,
unsupported elements, and unsafe attributes with stable visible findings, while preserving supported
headings, lists, links, tables, code blocks, equations, and text. A validated public HTTPS source URL
resolves relative links; private-network, IP-literal, and credential-bearing targets are rejected.
Without a base, relative links become non-link text with a warning. Markup images never issue network
requests: supplied alternative text is retained and the images remain visible blockers until packaged
assets ship in issues 08 and 09. Active-only input fails closed. The preview reports every required
semantic and unavailable-asset count.

Hostile Chromium fixtures cover both paste and file preview, the real iframe audit/review surface,
and cartridge generation without executing scripts, handlers, SVG, forms, or embeds. The cartridge
test also pins the audited fragment as the exact page-body bytes exported. Paste and file corpus
tests cover broken and deeply nested markup, long unbroken text, Unicode, RTL, CJK, equations,
private-network relationships, and file URLs; document compilation recovers supported equation
delimiters as MathML.

Verification: TypeScript checks, 100 test files / 906 tests, production build, and built-bundle smoke
test all pass. The production build retains its pre-existing chunk-size warning.
