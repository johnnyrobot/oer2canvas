/**
 * Prove that Cloudflare rejects an abusive relay burst before the Worker runs.
 *
 * Every request intentionally omits the relay target, so requests that do reach
 * the Worker stop at its 400 guard and never contact a publisher or Canvas. The
 * zone-level WAF rule is the only production component that can return 429 for
 * this input. No Authorization header is sent.
 */

const origin = (process.env.PRODUCTION_ORIGIN ?? 'https://oer2canvas.johnnyrobot.dev').replace(/\/$/, '')
// Cloudflare's distributed counters can briefly overshoot the configured
// threshold while edge state converges. Keep enough headroom to observe the
// mitigation without turning this into a load test; every request still stops
// at the target-less Worker guard if the edge allows it through.
const attempts = 100
const batchSize = 10

async function requestOnce() {
  const response = await fetch(`${origin}/relay`, {
    headers: { accept: 'application/json' },
    redirect: 'manual',
  })
  return {
    status: response.status,
    // A Worker response carries the relay's attachment policy. Its absence on
    // the 429 is supporting evidence that the edge stopped the request first.
    reachedWorker: response.headers.get('content-disposition')?.includes('attachment') ?? false,
  }
}

async function main() {
  const results = []
  for (let offset = 0; offset < attempts; offset += batchSize) {
    results.push(...await Promise.all(Array.from({ length: batchSize }, requestOnce)))
    if (results.some((result) => result.status === 429 && !result.reachedWorker)) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }

  const edgeBlock = results.find((result) => result.status === 429 && !result.reachedWorker)
  const unexpected = results.filter((result) => result.status !== 400 && result.status !== 429)
  if (unexpected.length > 0) {
    throw new Error(`edge rate-limit probe received unexpected HTTP ${unexpected[0].status}`)
  }
  if (!edgeBlock) {
    throw new Error(`edge rate-limit probe sent ${results.length} safe requests without an edge 429`)
  }

  console.log(`edge rate-limit verification passed after ${results.length} safe requests`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
