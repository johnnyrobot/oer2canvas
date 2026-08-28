# Security policy

## Reporting a vulnerability

Please report security issues privately to `johnny@johnnyrobot.ai`. Do not include Canvas
tokens, course exports, or private publisher material in a report. If a report contains a
credential, revoke it in Canvas immediately and mention only that it was revoked.

## Security boundaries

- No account, user database, analytics, or server-side content store exists.
- The public build has no Canvas address, token, course-selection, or direct-push entry point.
  Its relay refuses every Canvas API target and never forwards credentials or write methods to
  publisher hosts.
- Direct Canvas push is a default-off repository capability only for an operator who self-hosts
  and administers both this PWA/relay and its paired Canvas instance. Enabling it requires an
  explicit `self-hosted-canvas` mode and exact HTTPS Canvas origin in both the build and Worker;
  the UI address is read-only and the Worker rejects every other origin. The committed public
  mode overrides even a stale Canvas-origin binding.
- In that optional mode, Canvas tokens are session-only and never written to browser storage. A
  one-time migration removes token keys left by earlier releases from both current and legacy
  IndexedDB names; `Forget this token` clears the live field, session copy, and both database keys.
- The relay accepts only HTTPS targets, blocks private/loopback/reserved hosts, forwards an
  explicit request-header allowlist, drops cookies, re-validates GET redirects, refuses DELETE,
  rate-limits direct clients, and forces relayed responses to be sandboxed,
  attachment-delivered, and non-cacheable.
- Publisher HTML is parsed in an inert detached document. Only allowlist-repaired HTML is
  placed in the audit iframe or sent to Canvas.
- Pasted and file-selected text, Markdown, and HTML are decoded as strict UTF-8 and limited to
  2 MiB. Plain text is escaped. Markdown runs through an isolated pinned GFM parser; its raw HTML
  and direct HTML imports then share one detached `DOMParser` sanitizer. That sanitizer removes
  scripts, handlers, forms, active embeds, source styles, unsafe URL schemes, and unsupported
  elements with visible findings before any preview. The controlled result still passes through
  the same final allowlist and accessibility gate as publisher content. Source files and derived
  document data remain browser-local.
- Release-enabled text-oriented DOCX, EPUB, ODT, and RTF are limited to 16 MiB and parsed by AnyDoc in a disposable
  module Worker with a transferred buffer, a 30-second timeout, and measured input/asset/memory
  budgets. Content signatures must identify the selected format regardless of its filename or reported MIME type.
  Parser text is escaped into a fixed semantic HTML vocabulary; unsupported or embedded content
  blocks preparation instead of disappearing. Source files and derived document data remain local.
- The probe-only PDF parser uses the same disposable-Worker boundary. Parser output remains
  untrusted, and a cancelled or failed Worker is terminated.

## Operational requirements before launch

- Deploy only from a protected `main` branch after CI passes.
- Keep Workers observability/logging disabled unless a reviewed redaction policy is added;
  tokens and publisher content must never enter logs.
- Run `npm run verify:production` after every deployment.
- Keep the public build in `public-cartridge-only` mode with no Canvas origin, and keep the
  Worker's committed `DEPLOYMENT_MODE=public-cartridge-only`. `verify:production` must confirm
  Canvas push is reported disabled and Canvas-shaped relay targets are refused.
- Review Cloudflare request and CPU quotas before public promotion; move to a paid plan if
  adoption exceeds the documented free-tier budget.
