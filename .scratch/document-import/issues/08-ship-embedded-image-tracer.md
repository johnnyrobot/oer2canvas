# 08 — Ship one embedded-image import tracer

**What to build:** Let a user import one EPUB or DOCX containing a PNG image, preview and audit the image as part of the remediated page, and export a cartridge that renders the same image correctly after Canvas import using the validated packaging strategy.

**Blocked by:** 04 — Enable EPUB, ODT, and RTF structured imports; 07 — Validate embedded-image behavior in a real Canvas sandbox.

**Status:** ready-for-agent

- [ ] A PNG extracted locally from a supported document is represented as an imported asset with stable identity and provenance.
- [ ] The preview and accessibility audit resolve the packaged image safely without weakening the exported HTML policy.
- [ ] Missing alternative text or other required image metadata produces a remediation finding before export.
- [ ] The cartridge contains the image, required manifest entries, and the validated app-generated reference form.
- [ ] The exact HTML bytes that passed the gate are written into the cartridge without post-audit rewriting.
- [ ] The acceptance fixture imports into Canvas and renders its packaged image successfully.
