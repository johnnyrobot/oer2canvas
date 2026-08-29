# 09 — Harden packaged assets across document formats

**What to build:** Make embedded raster assets reliable across supported document formats by deduplicating bytes, enforcing limits and media policies, preserving audit/render parity, and clearly blocking workflows that cannot yet carry the assets safely.

**Blocked by:** 08 — Ship one embedded-image import tracer.

**Design:** [09-harden-packaged-assets-design.md](../09-harden-packaged-assets-design.md)

**Status:** ready-for-agent

**Rescoped 2026-08-28.** Issue 08's design absorbed five of the seven criteria below, because
unblocking all four validated media types and all four anydoc formats made them part of the tracer
rather than a hardening pass on top of it. They are recorded as satisfied, with the reason, so the
history shows they were met deliberately rather than dropped. What remains is genuine hardening.

Satisfied by issue 08:

- [x] Asset identity uses content hashing — issue 08 identifies assets by `sha256` and dedupes across chapters.
- [x] Blob URLs are revoked when assets or imports are discarded — issue 08 revokes on unmount. Session-discard revocation remains open below.
- [x] Multiple pages reference one packaged asset without duplicate payloads — issue 08 dedupes by content hash; issue 07 measured that Canvas resolves the shared reference to a single File.
- [x] Direct Canvas push is unavailable when an import contains embedded assets — moved into issue 08, which is what creates the hazard.
- [x] Validated raster types are supported consistently — issue 08 covers PNG, JPEG, GIF and WebP. Active and malformed asset handling remains open below.

Remaining:

- [ ] SVG and other active-content assets fail safely with findings, refused on their content rather than on their extension.
- [ ] Malformed and adversarial assets — truncated headers, declared/actual type mismatches, decompression bombs — fail closed with findings.
- [ ] Asset counts, total bytes, and unsupported-asset findings are visible before export and obey established byte budgets.
- [ ] Preview references are revoked when a session or import is discarded, not only when a component unmounts.
- [ ] Direct Canvas push gains a proven Files-API upload design, or issue 08's block is made permanent and documented as such.
- [ ] Structural, security, audit-parity, and Canvas acceptance fixtures cover the complete packaged-asset workflow across all four formats.
