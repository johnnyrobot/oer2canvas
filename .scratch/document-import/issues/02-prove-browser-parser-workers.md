# 02 — Prove browser parser workers and establish import budgets

**What to build:** Prove that the selected document and PDF parsers can load lazily and run inside browser workers without server compute, then establish evidence-based browser support and resource limits for production imports.

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] A production build can lazy-load AnyDoc and PDF Inspector only after the user begins a matching import.
- [ ] Parsing runs in module workers and transfers file buffers without unnecessary full-buffer copies.
- [ ] The probe supports progress reporting, cancellation, worker termination, and a clean retry.
- [ ] Benchmarks cover representative small, medium, and stress fixtures on the supported browser matrix.
- [ ] File-size, page-count, asset-count, timeout, and memory guardrails are selected from recorded measurements rather than guesses.
- [ ] Failure to initialize WebAssembly or a worker produces a user-actionable error and does not affect existing publisher imports.
