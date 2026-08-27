# Production operations

## Ownership and release

The production owner is `johnny@johnnyrobot.ai`. Production is the Cloudflare Worker
`oer2canvas` at `https://oer2canvas.johnnyrobot.dev`; `workers.dev` is disabled so there is
one public origin. Deploy from a clean, reviewed `main` commit through the manual GitHub
`production` environment, or locally with `npm run deploy` when recovering that workflow.
Every deployment must finish with:

```sh
npm run verify:production
```

The maintained public deployment is cartridge-only. Build in the default
`public-cartridge-only` mode without a Canvas origin, and keep the Worker's committed
`DEPLOYMENT_MODE=public-cartridge-only`; this explicit mode overrides even a stale remote Canvas
origin. The verifier must report Canvas push disabled and show that an API-shaped unknown host
is refused. The direct-push mode documented in `README.md` belongs only to an independent
operator who administers both a separately hosted PWA/relay and its pinned self-hosted Canvas
instance.

The GitHub `production` environment accepts protected branches only and contains scoped
`CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` secrets. The token uses Cloudflare's
**Edit Cloudflare Workers** template and is restricted to the `johnnyrobot.dev` zone and the
production account. Do not copy the local Wrangler OAuth credential into GitHub. See Cloudflare's
[GitHub Actions authentication guide](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).

The verifier is read-only. It checks the app, install metadata and icons, static LibreTexts
and Pressbooks catalogs, hashed-asset and service-worker cache policies, `/healthz`, relay
guards, and one public publisher response per E8 adapter without sending a Canvas token.

## Publisher catalog refresh

Committed static snapshots keep search traffic off publisher servers. Refresh them manually
with `npm run catalogs`, review the changed book counts and URLs, run the full verification
suite, and deploy the reviewed commit. The current snapshot contains 1,000 LibreTexts books
and 6,639 Pressbooks books across 15 networks. The PWA caches only catalogs a user opens and
expires those runtime entries after seven days.

At runtime, Pressbooks browsing uses one TOC request and a selected entry uses one typed-content
request. LibreTexts public fallback uses one root request to list chapters, expands only the
selected chapter, and refuses traversal at 250 pages with explicit failure copy.

Do not enable an unattended schedule until the LibreTexts and Pressbooks operators approve
the crawl cadence. That consent gate deliberately remains open in the release checklist;
the public application does not need a cron job to browse the committed snapshots.

## Capacity and cost ceiling

Keep the Worker on the Free plan until the owner explicitly approves a paid-plan change.
Current Cloudflare limits are 100,000 Worker requests per day, 10 ms CPU per HTTP request,
50 external subrequests per invocation, and six simultaneous outbound connections. Static
Asset requests are free and unlimited. Sources:

- [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)

Review account-level request usage in the Cloudflare dashboard weekly after public promotion.
At 50,000 dynamic requests in a UTC day, investigate traffic and publisher request volume. At
80,000, pause promotion and choose between rate controls and a reviewed paid-plan move. Never
enable Workers Caching for the static assets: it would turn normally free asset requests into
billable Worker requests.

Two independent limits protect the public relay:

1. The `johnnyrobot.dev` zone has one Free-plan WAF rate-limiting rule named
   `oer2canvas relay quota guard`. It matches `http.request.uri.path eq "/relay"`, counts by
   source IP, allows 20 requests per 10 seconds, and blocks for 10 seconds. This rule runs before
   the Worker and is the boundary that reduces abusive Worker invocations. Free-plan WAF rules
   cannot provide a daily global accounting ceiling, so dashboard quota review remains required.
2. The Worker declares the Cloudflare `RELAY_LIMITER` binding in `wrangler.jsonc`: 60 relay
requests per 60-second window for each client key in each Cloudflare location. The key uses
Cloudflare's `cf-connecting-ip` value, falling back to one shared anonymous bucket when no client
identity is available. This is an abuse boundary, not an accounting system; the binding is
eventually consistent and does not replace the daily quota review. A missing binding fails the
relay closed with HTTP 503, so a deploy cannot silently revert to an unbounded public route.

After `npm run verify:production`, run `npm run verify:edge-rate-limit`. The probe sends only
target-less `/relay` requests with no Authorization header. Requests that reach the Worker stop
at HTTP 400 without an upstream call; the check passes only when Cloudflare produces an edge 429.
It runs last because the source IP remains blocked for the ten-second mitigation window.

If the account moves to a paid Workers plan, restore an explicit `limits.cpu_ms` value in
`wrangler.jsonc` before the move. The Free plan currently enforces the 10 ms ceiling itself
and rejects that configuration field.

## Incident and abuse response

The relay stores nothing and observability remains disabled. The public relay refuses Canvas
credentials, while an independently enabled self-host relay may handle them. For an incident:

1. Run `npm run verify:production` and record the failing check and UTC time.
2. Inspect aggregate request/CPU counts in Cloudflare without enabling request-body or header
   logging.
3. For an application regression, roll back to the last verified deployment.
4. For relay abuse, pause public promotion and disable the custom-domain trigger in Cloudflare
   while preserving the deployed version for investigation.
5. If the relay returns HTTP 429, keep the limiter in place, inspect aggregate request counts,
   and do not increase the limit until the source volume and legitimate workflow impact are
   understood.
6. If a Canvas token may have appeared anywhere outside the intended request path, revoke it in
   Canvas immediately; do not copy it into an issue or log.

## Rollback

List deployments and roll back using Wrangler:

```sh
npx wrangler deployments list
npx wrangler rollback <known-good-version-id>
npm run verify:production
```

Rollback changes the Worker version but does not rewrite git history. Open a follow-up change
that records the failed version, the known-good version, and the production-verification result.
Do not delete Canvas pages as part of rollback: a partial push is resumed from its journal and
the product deliberately has no destructive Canvas operation.
