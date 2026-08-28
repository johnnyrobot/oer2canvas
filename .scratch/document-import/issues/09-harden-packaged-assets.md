# 09 — Harden packaged assets across document formats

**What to build:** Make embedded raster assets reliable across supported document formats by deduplicating bytes, enforcing limits and media policies, preserving audit/render parity, and clearly blocking workflows that cannot yet carry the assets safely.

**Blocked by:** 08 — Ship one embedded-image import tracer.

**Status:** ready-for-agent

- [ ] Asset identity uses content hashing so duplicate and shared bytes produce deterministic package entries.
- [ ] Validated raster types are supported consistently, while SVG, active, malformed, or unsupported assets fail safely with findings.
- [ ] Blob URLs or equivalent preview-only references are revoked when assets, imports, or sessions are discarded.
- [ ] Asset counts, total bytes, unsupported assets, and accessibility findings are visible before export and obey established budgets.
- [ ] Multiple pages can reference one packaged asset without duplicate package payloads or broken Canvas rendering.
- [ ] Direct Canvas push is explicitly unavailable when an import contains embedded assets until that workflow has its own proven upload design.
- [ ] Structural, security, audit-parity, and Canvas acceptance fixtures cover the complete packaged-asset workflow.
