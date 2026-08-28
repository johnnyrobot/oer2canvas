import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite'
import { normalizeSelfHostedCanvasOrigin } from './worker/allowlist-hosts.js'

function selfHostedCanvasOrigin(): string {
  const mode = process.env.OER2CANVAS_DEPLOYMENT_MODE?.trim() || 'public-cartridge-only'
  if (mode === 'public-cartridge-only') return ''
  if (mode !== 'self-hosted-canvas') {
    throw new Error('OER2CANVAS_DEPLOYMENT_MODE must be public-cartridge-only or self-hosted-canvas')
  }

  const raw = process.env.OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN?.trim()
  if (!raw) {
    throw new Error('self-hosted-canvas mode requires OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN')
  }

  const normalized = normalizeSelfHostedCanvasOrigin(raw)
  if (!normalized) {
    throw new Error(
      'OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN must be a public HTTPS FQDN without a path',
    )
  }
  return normalized
}

const canvasOrigin = selfHostedCanvasOrigin()

export default defineConfig({
  // Direct Canvas access is absent from the default/public UI. A self-host
  // operator opts in by pinning the one Canvas origin they also administer;
  // the Worker independently enforces the same origin at runtime.
  define: {
    __OER2CANVAS_SELF_HOSTED_CANVAS_ORIGIN__: JSON.stringify(canvasOrigin),
  },
  server: {
    proxy: {
      /**
       * `/relay` is served by the Worker, not by Vite.
       *
       * In production `wrangler.jsonc`'s `run_worker_first: ["/relay"]` routes it;
       * in dev nothing does, so `npm run dev` alone would 404 on the one request
       * the app cannot make itself — the OpenStax release manifest, which sends no
       * CORS header and is the first of three hops.
       *
       * Forwarding to `wrangler dev` (default port 8787) rather than reimplementing
       * the forward here is deliberate: `worker/allowlist-hosts.ts` carries
       * security-relevant guards, and a dev-only second copy of them would drift.
       * Run `npm run dev:relay` alongside `npm run dev`.
       */
      '/relay': {
        target: 'http://localhost:8787',
        /*
         * `changeOrigin` STAYS FALSE, AND THAT IS THE WHOLE REASON THIS IS AN
         * OBJECT RATHER THAN THE ONE-LINE STRING FORM.
         *
         * Vite's string shorthand — `'/relay': 'http://localhost:8787'`, which is
         * what this was — implies `changeOrigin: true`, rewriting the forwarded
         * `Host` to the target. The relay derives its own origin from that Host
         * and refuses any request whose `Origin` does not match it, a guard that
         * keeps browser-driven abuse off the account-wide free-tier budget. So the
         * worker concluded it lived at `:8787` while the browser said `:5173`, and
         * every write came back 403 `cross-origin request not allowed`.
         *
         * It hid for as long as it did because reads were unaffected: browsers
         * omit `Origin` on a same-origin GET but attach it to every POST. So the
         * relay looked verified by every read that went through it, and no write
         * could be exercised locally at all. Measured 2026-08-24 driving a real
         * push through `wrangler dev`, where it presented as a Canvas permissions
         * error against a token and a course that were both fine.
         *
         * Left false, the Host passes through unchanged, the worker sees the app's
         * own origin, and the comparison succeeds exactly as it does in production
         * under `run_worker_first`. The guard in `worker/relay.ts` is untouched —
         * this makes dev match production rather than weakening either.
         */
        changeOrigin: false,
      },
    },
  },
  plugins: [
    react(),
    // Build-time only: Tailwind compiles away, so the shipped app keeps its
    // three runtime dependencies.
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      /*
       * NAVIGATIONS GO TO THE NETWORK FIRST, AND THAT IS THE WHOLE POINT OF THIS
       * BLOCK.
       *
       * By default vite-plugin-pwa sets `navigateFallback: 'index.html'`, which
       * makes workbox answer every navigation from the PRECACHED index.html —
       * cache-first. The effect is that the first load after any deploy serves
       * the previous build: the new service worker installs, but the page the
       * user is looking at came out of the old precache, so a deploy appears not
       * to have landed until the load after next. It cost three false diagnoses
       * in one afternoon, twice to the person who had just deployed.
       *
       * `navigateFallback: null` removes that route; the runtime rule below
       * replaces it with NetworkFirst. Online, a navigation gets the build that
       * is actually deployed. Offline — or on a network slower than the timeout —
       * it falls back to the last HTML it saw, so the app stays installable and
       * usable without a connection, which is the reason it is a PWA at all.
       *
       * Hashed assets are untouched: they are content-addressed, so cache-first
       * is correct for them and stays that way.
       */
      workbox: {
        navigateFallback: null,
        // Catalog snapshots are several megabytes and update independently of
        // the application shell. Do not inflate every service-worker install;
        // cache only the networks an instructor actually opens.
        globIgnores: [
          '**/catalogs/**',
          // The ML runtime is an on-demand feature. Keep its browser bundle
          // and ONNX fallback binary out of the install precache so opening the
          // app does not silently download them before an instructor asks for
          // a draft; Transformers.js caches what is actually used on demand.
          '**/assets/transformers.web-*.js',
          '**/assets/ort-wasm-*.wasm',
          // Document parsers are also opt-in. Their module Workers and WASM
          // binaries are fetched only after a matching file enters the probe;
          // precaching either parser would spend 5-7 MiB at install time for a
          // capability the instructor may never use.
          '**/assets/anydoc.worker-*.js',
          '**/assets/pdf-inspector.worker-*.js',
          '**/assets/anydoc_wasm_bg-*.wasm',
          '**/assets/pdf_inspector_wasm_bg-*.wasm',
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
              sameOrigin && /\/assets\/(?:anydoc\.worker|pdf-inspector\.worker|anydoc_wasm_bg|pdf_inspector_wasm_bg)-/.test(url.pathname),
            handler: 'CacheFirst',
            options: {
              cacheName: 'oer2canvas-document-parsers-v1',
              cacheableResponse: { statuses: [200] },
              // Two Workers + two WASM binaries. Hashed filenames make 30-day
              // retention safe, while the entry bound evicts old parser builds.
              expiration: { maxEntries: 4, maxAgeSeconds: 30 * 24 * 60 * 60 },
            },
          },
          {
            urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) => sameOrigin && url.pathname.startsWith('/catalogs/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'oer2canvas-catalogs',
              networkTimeoutSeconds: 3,
              cacheableResponse: { statuses: [200] },
              expiration: { maxEntries: 20, maxAgeSeconds: 7 * 24 * 60 * 60 },
            },
          },
          {
            // Relay and health responses are Worker-controlled, not app HTML.
            // Never put either route in the app's offline navigation cache:
            // `/relay` can carry arbitrary upstream bytes and `/healthz` is a
            // live deployment probe.
            urlPattern: ({ request, url }: { request: Request; url: URL }) =>
              request.mode === 'navigate' && url.pathname !== '/relay' && url.pathname !== '/healthz',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'oer2canvas-html',
              // Short: a user on a bad connection should get the offline copy
              // rather than a spinner, but three seconds is long enough that a
              // working network essentially always wins.
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 8 },
            },
          },
        ],
      },
      manifest: {
        name: 'oer2canvas',
        short_name: 'oer2canvas',
        description: 'Open textbook chapters into accessible Canvas pages',
        theme_color: '#1f2933',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        id: '/',
        scope: '/',
        icons: [
          { src: '/icon.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icon.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
    }),
  ],
})
