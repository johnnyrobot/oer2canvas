# 13 — Harden and release the core document importer

**What to build:** Release the browser-only document importer as a dependable product capability for its proven core formats, with transparent limits, privacy behavior, accessibility, security, artifact correctness, and regression protection.

**Blocked by:** 09 — Harden packaged assets across document formats; 10 — Let users approve and edit the proposed page plan; 11 — Import text-based PDFs and fail closed on OCR-dependent pages; 17 — Import a publisher URL.

**Status:** ready-for-agent

- [ ] The published capability table matches corpus-tested support for plain text, Markdown, HTML, DOCX, ODT, RTF, EPUB, text-based PDF, and optional URL acquisition.
- [ ] Supported browsers pass keyboard, screen-reader, focus, progress, cancellation, and error-recovery acceptance scenarios.
- [ ] Security tests cover hostile documents, HTML, URLs, archive expansion, malformed binaries, active content, and credential leakage.
- [ ] Artifact tests unzip generated cartridges and verify manifests, page bytes, assets, deterministic output, and accessibility-gate invariants.
- [ ] Documentation explains local compute, memory-only handling, publisher-URL acquisition and its allowlist boundary, unsupported OCR, resource limits, and recovery guidance.
- [ ] Dependency notices and third-party licensing obligations are complete for shipped parsers and browser components.
- [ ] Production builds, automated tests, existing publisher imports, and representative end-to-end Canvas acceptance checks all pass.
