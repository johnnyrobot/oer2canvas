# 12 — Import one URL using a memory-only Firecrawl key

**What to build:** Let a user deliberately send one URL to Firecrawl with their own API key, receive the extracted content directly in the browser, inspect its provenance and limitations, and pass it through the standard page-planning, accessibility-review, and export workflow.

**Blocked by:** 05 — Import Markdown and HTML safely; 10 — Let users approve and edit the proposed page plan.

**Status:** deferred

**Deferred 2026-08-29.** Issue 17 — Import a publisher URL took the first URL-import slice using the
relay allowlist that already exists, which is the one thing this issue's third criterion rules out.
The two are alternative answers to "how does this app reach a host a browser cannot?": 12 buys
arbitrary hosts at the cost of a third-party dependency and a user-held key; 17 buys curated hosts at
the cost of an allowlist that must be argued every time it grows. Neither subsumes the other —
Firecrawl reaches a Wikipedia page or a departmental site, and the relay never will.

This issue is left exactly as written rather than rewritten, because its criteria record a deliberate
security posture (memory-only key, browser-direct, no server fallback, no relay) and replacing that
text would delete the decision rather than supersede it. It is `deferred` because nobody has taken
the decision to accept a third-party dependency, not because the work was found wrong. Issue 13's
release no longer waits on it.

- [ ] The interface explains that the URL and API key are sent directly from the browser to Firecrawl before the user proceeds.
- [ ] The API key is held only in memory, is excluded from persistence and logs, and can be removed immediately with a Forget action.
- [ ] The feature acquires one explicit URL and does not expose a crawler, recursive site import, application relay, or hidden server fallback.
- [ ] Firecrawl output is treated as untrusted and passes through the controlled Markdown/HTML normalization policy.
- [ ] Authentication, quota, CORS, timeout, cancellation, unsupported-content, and provider errors are safe and actionable.
- [ ] A successful import records source provenance and completes the normal preview, audit, plan, and cartridge-export workflow.
