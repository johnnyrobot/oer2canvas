# 02 — Prove browser parser workers and establish import budgets

**What to build:** Prove that the selected document and PDF parsers can load lazily and run inside browser workers without server compute, then establish evidence-based browser support and resource limits for production imports.

**Blocked by:** None — can start immediately.

**Status:** ready-for-human

- [x] A production build can lazy-load AnyDoc and PDF Inspector only after the user begins a matching import.
- [x] Parsing runs in module workers and transfers file buffers without unnecessary full-buffer copies.
- [x] The probe supports progress reporting, cancellation, worker termination, and a clean retry.
- [ ] Benchmarks cover representative small, medium, and stress fixtures on the supported browser matrix.
- [ ] File-size, page-count, asset-count, timeout, and memory guardrails are selected from recorded measurements rather than guesses.
- [x] Failure to initialize WebAssembly or a worker produces a user-actionable error and does not affect existing publisher imports.

## Comments

Browser-only parsing is feasible. The production build now has probe-only AnyDoc 0.2.4 and PDF
Inspector 1.17.0 module Workers. Each source buffer is transferred, not cloned; each attempt owns a
fresh disposable Worker; and progress, cancellation, timeout, initialization failure, result
budgets, termination, and retry are covered at the public Worker boundary. Existing publisher and
plain-text imports do not invoke either probe.

The built-artifact smoke proves initial application load requests no parser code or WASM. An
AnyDoc probe loads only its Worker/WASM pair, and a PDF probe loads only its pair. The four hashed
assets are excluded from service-worker install precache and enter a bounded runtime cache only
after use.

The committed benchmark passed generated small, medium, and boundary fixtures in Chrome 151,
Playwright Firefox 153, and Playwright WebKit 26.5 desktop profiles. Provisional parser-probe limits
are 16 MiB input, 200 PDF pages, 64 assets, 8 MiB total assets, 4 MiB per asset, 30 seconds, and 128
MiB reported WASM memory. The slowest observed parse was 4,300 ms and the highest observed WASM
linear memory was 97,845,248 bytes. See
`docs/evidence/document-parser-benchmark-2026-08-27.md` and its adjacent JSON report.

Two approved-plan gates remain and require human environment access. Safari 26.4 is installed on
this host, but “Allow remote automation” is disabled; no physical mobile-class device is attached.
Chrome viewport/page-target CPU emulation does not throttle a dedicated parser Worker, so it is
recorded as diagnostic evidence rather than misrepresented as mobile evidence. Run the committed
matrix in current Safari and on physical mobile-class hardware, then re-derive or confirm the
provisional limits. Page-formation work must separately measure and select the proposed-page limit.
Until those results are recorded, this ticket is intentionally not resolved and every document
format remains `probe-only`.
