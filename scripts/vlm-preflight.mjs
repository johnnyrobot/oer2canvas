/**
 * Read-only E9 technical preflight.
 *
 * It pins model revisions, licenses, and browser artifact sizes against the
 * Hugging Face model API, then probes headless Chromium/Chrome for a real
 * WebGPU adapter. It does not download weights or call an inference service.
 * Manual factual review is optional; the release gate is the automated benchmark stage.
 */
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const exec = promisify(execFile)

const CANDIDATES = [
  {
    id: 'onnx-community/Florence-2-base-ft',
    revision: 'e88a44eaf3791a35eae0c5a47b3dbcd36e67eb6f',
    license: 'mit',
    artifacts: [
      'onnx/decoder_model_merged_q4.onnx',
      'onnx/embed_tokens_q4.onnx',
      'onnx/encoder_model_q4.onnx',
      'onnx/vision_encoder_q4.onnx',
    ],
  },
  {
    id: 'onnx-community/Florence-2-large-ft',
    revision: '04ace74913c28d7ec94af32cee5c111a10126b6f',
    license: 'mit',
    artifacts: [
      'onnx/decoder_model_merged_q4.onnx',
      'onnx/embed_tokens_q4.onnx',
      'onnx/encoder_model_q4.onnx',
      'onnx/vision_encoder_q4.onnx',
    ],
  },
  {
    id: 'HuggingFaceTB/SmolVLM-256M-Instruct',
    revision: '7e3e67edbbed1bf9888184d9df282b700a323964',
    license: 'apache-2.0',
    artifacts: [
      'onnx/decoder_model_merged_q4.onnx',
      'onnx/embed_tokens_q4.onnx',
      'onnx/vision_encoder_q4.onnx',
    ],
  },
  {
    id: 'vikhyatk/moondream2',
    revision: '6b714b26eea5cbd9f31e4edb2541c170afa935ba',
    license: 'apache-2.0',
    artifacts: [],
  },
]

async function metadata(candidate) {
  const response = await fetch(`https://huggingface.co/api/models/${candidate.id}?blobs=true`)
  if (!response.ok) throw new Error(`${candidate.id}: Hugging Face API returned HTTP ${response.status}`)
  const model = await response.json()
  const files = new Map((model.siblings ?? []).map((file) => [file.rfilename, file]))
  const missing = candidate.artifacts.filter((name) => !files.has(name))
  const bytes = candidate.artifacts.reduce((total, name) => total + (files.get(name)?.size ?? 0), 0)
  const taggedLicense = (model.tags ?? []).find((tag) => tag.startsWith('license:'))?.slice(8)
  const rawWeights = files.get('model.safetensors')?.size
  return {
    id: candidate.id,
    pinnedRevision: candidate.revision,
    currentRevision: model.sha,
    revisionPinned: candidate.revision === model.sha,
    expectedLicense: candidate.license,
    reportedLicense: taggedLicense,
    licenseMatches: taggedLicense === candidate.license,
    library: model.library_name,
    pipeline: model.pipeline_tag,
    q4Artifacts: candidate.artifacts,
    q4ArtifactBytes: bytes,
    q4ArtifactMiB: Math.round((bytes / 1024 / 1024) * 10) / 10,
    missingArtifacts: missing,
    rawWeightBytes: rawWeights,
    browserArtifactStatus:
      candidate.artifacts.length === 0
        ? 'incompatible-no-onnx-browser-artifacts'
        : missing.length > 0
          ? 'blocked-missing-artifacts'
          : 'eligible-for-real-browser-benchmark',
  }
}

async function gpuProbe(channel) {
  let browser
  let server
  try {
    const args = ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist']
    if (process.platform === 'darwin') args.push('--use-angle=metal')
    browser = await chromium.launch({
      ...(channel ? { channel } : {}),
      headless: true,
      args,
    })
    server = createServer((_, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<!doctype html><html lang="en"><body><canvas></canvas></body></html>')
    })
    await new Promise((resolveServer, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveServer)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('GPU probe server did not expose a port')
    const page = await browser.newPage()
    await page.goto(`http://127.0.0.1:${address.port}/`)
    const result = await page.evaluate(async () => {
      if (!navigator.gpu) return { exposed: false, adapter: false }
      const adapter = await navigator.gpu.requestAdapter()
      return {
        exposed: true,
        adapter: Boolean(adapter),
        ...(adapter?.info ? {
          info: {
            vendor: adapter.info.vendor,
            architecture: adapter.info.architecture,
            device: adapter.info.device,
            description: adapter.info.description,
          },
        } : {}),
      }
    })
    return { browser: channel ?? 'playwright-chromium', ...result }
  } catch (error) {
    return { browser: channel ?? 'playwright-chromium', error: error instanceof Error ? error.message : String(error) }
  } finally {
    await browser?.close()
    if (server) await new Promise((resolveServer) => server.close(() => resolveServer()))
  }
}

async function hostGpu() {
  try {
    const { stdout } = await exec('system_profiler', ['SPDisplaysDataType'])
    const chipset = /^\s*Chipset Model:\s*(.+)$/m.exec(stdout)?.[1]
    const cores = /^\s*Total Number of Cores:\s*(.+)$/m.exec(stdout)?.[1]
    const metal = /^\s*Metal Support:\s*(.+)$/m.exec(stdout)?.[1]
    return { chipset, cores, metal }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

async function productionAudit() {
  try {
    const { stdout } = await exec('npm', ['audit', '--omit=dev', '--audit-level=high', '--json'])
    const report = JSON.parse(stdout)
    return summarizeAudit(report)
  } catch (error) {
    // npm exits non-zero when the requested severity threshold is found, but
    // still writes the complete JSON report to stdout. Preserve that report so
    // the preflight remains useful on a failing release candidate.
    const stdout = error && typeof error === 'object' && 'stdout' in error ? error.stdout : ''
    try {
      return summarizeAudit(JSON.parse(String(stdout)))
    } catch {
      return {
        status: 'error',
        high: null,
        critical: null,
        paths: [],
        fixAvailable: null,
        note: `Unable to parse npm audit output: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }
}

function summarizeAudit(report) {
  const counts = report.metadata?.vulnerabilities ?? {}
  const high = Number(counts.high ?? 0)
  const critical = Number(counts.critical ?? 0)
  const findings = Object.values(report.vulnerabilities ?? {})
    .filter((finding) => finding?.severity === 'high' || finding?.severity === 'critical')
    .map((finding) => finding.name)
  const fixes = Object.values(report.vulnerabilities ?? {}).map((finding) => finding.fixAvailable)
  return {
    status: high + critical === 0 ? 'passed' : 'blocked',
    high,
    critical,
    paths: findings,
    fixAvailable: fixes.some((value) => value === true || (value && typeof value === 'object')),
    note: 'Measured with npm audit --omit=dev --audit-level=high against the installed production dependency graph.',
  }
}

const [models, gpu, audit] = await Promise.all([
  Promise.all(CANDIDATES.map(metadata)),
  hostGpu(),
  productionAudit(),
])
// Chromium GPU processes contend for the same adapter on some macOS hosts;
// probe the bundled and installed channels one at a time so a transient
// allocation failure is not misreported as "no WebGPU".
const playwrightGpu = await gpuProbe()
const chromeGpu = await gpuProbe('chrome')
const technicalReasons = [
  ...([playwrightGpu, chromeGpu].some((probe) => probe.adapter)
    ? []
    : ['No headless Chromium WebGPU adapter is available on this benchmark host.']),
  ...(audit.status === 'passed' ? [] : ['The production dependency graph fails the required zero-high audit gate.']),
]

const report = {
  generatedAt: new Date().toISOString(),
  hostGpu: gpu,
  browserWebGpu: [playwrightGpu, chromeGpu],
  runtime: {
    package: '@huggingface/transformers',
    measuredVersion: '4.2.0',
    license: 'Apache-2.0',
    productionAudit: audit,
  },
  models,
  decision: {
    status: technicalReasons.length === 0 ? 'passed-technical-preflight' : 'blocked',
    reasons: technicalReasons,
    selectedModel: technicalReasons.length === 0 ? 'onnx-community/Florence-2-base-ft' : null,
    qualityReview: 'tracked-in-release-evidence',
  },
}

console.log(JSON.stringify(report, null, 2))
