# 08 — Ship one embedded-image import tracer

**What to build:** Let a user import one EPUB or DOCX containing a PNG image, preview and audit the image as part of the remediated page, and export a cartridge that renders the same image correctly after Canvas import using the validated packaging strategy.

**Blocked by:** 04 — Enable EPUB, ODT, and RTF structured imports; 07 — Validate embedded-image behavior in a real Canvas sandbox.

**Design:** [08-embedded-image-tracer-design.md](../08-embedded-image-tracer-design.md)

**Scope note:** The design covers PNG, JPEG, GIF and WebP across EPUB, DOCX, ODT and RTF — the media
types issue 07 validated individually, and the four formats that share one parser path. It also
takes issue 09's direct-push criterion, because the hazard is created here. Issue 09 was rescoped
accordingly.

**Status:** resolved

- [x] A PNG extracted locally from a supported document is represented as an imported asset with stable identity and provenance.
- [x] The preview and accessibility audit resolve the packaged image safely without weakening the exported HTML policy.
- [x] Missing alternative text or other required image metadata produces a remediation finding before export.
- [x] The cartridge contains the image, required manifest entries, and the validated app-generated reference form.
- [x] The exact HTML bytes that passed the gate are written into the cartridge without post-audit rewriting.
- [x] Direct Canvas push is explicitly unavailable while an import carries packaged assets, because that path cannot upload files.
- [x] The acceptance fixture imports into Canvas and renders its packaged image successfully.

## Answer

Embedded raster images are publishable end to end. The anydoc parser extracts them at import,
verifies what the bytes actually are by sniffing the signature rather than trusting the document's
declared media type, and emits `$IMS-CC-FILEBASE$/oer2canvas/<name>` with intrinsic `width`/`height`
decoded from the image header. The exporter packages the bytes and declares each asset as a standalone
`<resource type="webcontent">` — the shape issue 07 measured as working — and refuses to build a
cartridge whose HTML references a file the archive does not contain.

The token is written before the accessibility gate runs, so the bytes that passed the gate are the
bytes in the cartridge, verbatim. That is what the `width`/`height` attributes are for: the audit
frame reserves the image's true box without fetching a token no browser can resolve. Preview surfaces
resolve the token to a `blob:` URL in the live DOM only, never mutating stored HTML.

Scope covers PNG, JPEG, GIF and WebP across DOCX, EPUB, ODT and RTF. Anything that cannot be
packaged — an unsupported or corrupt signature, missing bytes, or an asset over the existing
`PARSER_PROBE_LIMITS` budgets — keeps the `embedded-content` blocker and its visible placeholder, so
nothing publishes with a silent hole. Direct Canvas push is blocked while packaged assets are present,
because `src/canvas/client.ts` writes `wiki_page.body` and has no upload path at all; cartridge export
is unaffected.

Two findings worth carrying forward. anydoc never returns `undefined` for `Inline.alt` — it returns
`''` for a genuinely empty alt and for a format with no alt carrier alike — so an empty alt is treated
as undescribed, which routes the image to the `alt` ("describe this") remediation queue rather than
`confirm-decorative`. And external images, which previously could never reach output because every
image blocked, are now fenced to public hosts through the same `isPublicNetworkUrl` check the
Markdown/HTML importer uses.

Live acceptance: `docs/evidence/packaged-image-tracer-2026-08-28.md`. A cartridge built by the real
pipeline imported into a live Canvas with zero migration issues and rendered its image with alt text
intact. Canvas placed the file at `course files/oer2canvas`, confirming in production that it strips
the `web_resources/` prefix.

Verification: both TypeScript projects and the full suite — 108 test files, 1040 tests — pass.
