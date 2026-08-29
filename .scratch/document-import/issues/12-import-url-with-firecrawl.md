# 12 — Import one URL using a memory-only Firecrawl key

**What to build:** Let a user deliberately send one URL to Firecrawl with their own API key, receive the extracted content directly in the browser, inspect its provenance and limitations, and pass it through the standard page-planning, accessibility-review, and export workflow.

**Blocked by:** 05 — Import Markdown and HTML safely; 10 — Let users approve and edit the proposed page plan.

**Status:** ready-for-agent

- [ ] The interface explains that the URL and API key are sent directly from the browser to Firecrawl before the user proceeds.
- [ ] The API key is held only in memory, is excluded from persistence and logs, and can be removed immediately with a Forget action.
- [ ] The feature acquires one explicit URL and does not expose a crawler, recursive site import, application relay, or hidden server fallback.
- [ ] Firecrawl output is treated as untrusted and passes through the controlled Markdown/HTML normalization policy.
- [ ] Authentication, quota, CORS, timeout, cancellation, unsupported-content, and provider errors are safe and actionable.
- [ ] A successful import records source provenance and completes the normal preview, audit, plan, and cartridge-export workflow.
