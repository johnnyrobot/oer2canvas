import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'
import { crc32, writeZip } from '../src/engine/export/zip.ts'

const FILEBASE = '$IMS-CC-FILEBASE$'
const CC11_NS = 'http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1'
const CC11_LOM = 'http://ltsc.ieee.org/xsd/imsccv1p1/LOM/resource'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export const PROBE_VARIANTS = Object.freeze([
  {
    id: 'standalone-webcontent',
    description: 'Each asset is a standalone webcontent resource; pages declare no dependencies.',
    assetResourceType: 'webcontent',
    dependencies: false,
    pageOwnedFiles: false,
  },
  {
    id: 'webcontent-dependencies',
    description: 'Each asset is a webcontent resource and every page declares its asset dependencies.',
    assetResourceType: 'webcontent',
    dependencies: true,
    pageOwnedFiles: false,
  },
  {
    id: 'page-owned-files',
    description: 'Assets are file children of the pages that use them, without standalone resources.',
    assetResourceType: null,
    dependencies: false,
    pageOwnedFiles: true,
  },
  {
    id: 'associatedcontent-dependencies',
    description: 'Each asset is associatedcontent and every page declares its asset dependencies.',
    assetResourceType: 'associatedcontent/imscc_xmlv1p1/learning-application-resource',
    dependencies: true,
    pageOwnedFiles: false,
  },
])

const image = (path, mediaType, base64) => ({
  path: `web_resources/probe/${path}`,
  mediaType,
  data: Uint8Array.from(Buffer.from(base64, 'base64')),
})

export const ASSETS = Object.freeze([
  image(
    'single.png',
    'image/png',
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQ4jWO4Zm7+nxLMMGrA/9EwMB8NA/NhEQYAI3hDH1ULU2MAAAAASUVORK5CYII=',
  ),
  image(
    'shared.gif',
    'image/gif',
    'R0lGODlhEAAQAIAAAExpcfWmIyH5BAUAAAAALAAAAAAQABAAAAIOjI+py+0Po5y02ouzPgUAOw==',
  ),
  image(
    'raster.png',
    'image/png',
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQ4jWNo9Nz3nxLMMGrA/9Ew2DcaBp7DIgwAkX+HH2ldhTQAAAAASUVORK5CYII=',
  ),
  image(
    'raster.jpg',
    'image/jpeg',
    '/9j/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAAQABADAREAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFgEBAQEAAAAAAAAAAAAAAAAAAAcI/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AiJozUAAA/9k=',
  ),
  image('raster.webp', 'image/webp', 'UklGRh4AAABXRUJQVlA4TBEAAAAvD8ADAAfQscpUuv+BiOh/AAA='),
  image(
    'duplicate-a.png',
    'image/png',
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQ4jWOIT874TwlmGDXg/2gYZIyGQfKwCAMAm04pH2XzQkQAAAAASUVORK5CYII=',
  ),
  image(
    'duplicate-b.png',
    'image/png',
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAHUlEQVQ4jWOIT874TwlmGDXg/2gYZIyGQfKwCAMAm04pH2XzQkQAAAAASUVORK5CYII=',
  ),
])

const assetByPath = new Map(ASSETS.map((asset) => [asset.path, asset]))
const assetPath = (name) => `web_resources/probe/${name}`

export const PAGES = Object.freeze([
  {
    id: 'page-single',
    path: 'wiki_content/01-single-image.html',
    title: '01 Single image',
    images: [{ asset: assetPath('single.png'), alt: 'Red square PNG — single image probe' }],
  },
  {
    id: 'page-shared-a',
    path: 'wiki_content/02-shared-image-a.html',
    title: '02 Shared image A',
    images: [{ asset: assetPath('shared.gif'), alt: 'Orange square GIF — shared image probe A' }],
  },
  {
    id: 'page-shared-b',
    path: 'wiki_content/03-shared-image-b.html',
    title: '03 Shared image B',
    images: [{ asset: assetPath('shared.gif'), alt: 'Orange square GIF — shared image probe B' }],
  },
  {
    id: 'page-raster-duplicates',
    path: 'wiki_content/04-raster-and-duplicates.html',
    title: '04 Raster types and duplicate bytes',
    images: [
      { asset: assetPath('raster.png'), alt: 'Purple square PNG raster probe' },
      { asset: assetPath('raster.jpg'), alt: 'Green square JPEG raster probe' },
      { asset: assetPath('raster.webp'), alt: 'Blue square WebP raster probe' },
      { asset: assetPath('duplicate-a.png'), alt: 'Gray square duplicate bytes A' },
      { asset: assetPath('duplicate-b.png'), alt: 'Gray square duplicate bytes B' },
    ],
  },
])

function xml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function resourceIdForAsset(path) {
  return `asset-${path.split('/').at(-1).replace(/[^A-Za-z0-9._-]/g, '-')}`
}

function imageReference(path) {
  if (!assetByPath.has(path)) throw new Error(`probe: unknown controlled asset path "${path}"`)
  return `${FILEBASE}/${path}`
}

function pageDocument(page) {
  const figures = page.images
    .map(
      ({ asset, alt }) =>
        `<figure><img src="${imageReference(asset)}" alt="${xml(alt)}" width="16" height="16"/>` +
        `<figcaption>${xml(asset.split('/').at(-1))}</figcaption></figure>`,
    )
    .join('')
  return (
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/>' +
    `<title>${xml(page.title)}</title>` +
    `<meta name="identifier" content="${page.id}"/>` +
    '<meta name="editing_roles" content="teachers"/>' +
    '<meta name="workflow_state" content="active"/>' +
    `</head><body><h2>${xml(page.title)}</h2>${figures}</body></html>`
  )
}

function moduleMeta() {
  const items = PAGES.map(
    (page, index) =>
      `    <item identifier="item-${page.id}">\n` +
      '      <content_type>WikiPage</content_type>\n' +
      '      <workflow_state>active</workflow_state>\n' +
      `      <title>${xml(page.title)}</title>\n` +
      `      <identifierref>${page.id}</identifierref>\n` +
      `      <position>${index + 1}</position>\n` +
      '      <indent>0</indent>\n' +
      '    </item>',
  ).join('\n')
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<modules xmlns="http://canvas.instructure.com/xsd/cccv1p0"\n' +
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
    '  <module identifier="probe-module">\n' +
    '    <title>oer2canvas embedded-image probe</title>\n' +
    '    <workflow_state>active</workflow_state>\n' +
    '    <position>1</position>\n' +
    '    <require_sequential_progress>false</require_sequential_progress>\n' +
    `${items}\n` +
    '  </module>\n' +
    '</modules>\n'
  )
}

function manifestFor(variant) {
  const organizationItems = PAGES.map(
    (page) =>
      `        <item identifier="item-${page.id}" identifierref="${page.id}">\n` +
      `          <title>${xml(page.title)}</title>\n` +
      '        </item>',
  ).join('\n')

  const pageResources = PAGES.map((page) => {
    const files = variant.pageOwnedFiles
      ? page.images.map(({ asset }) => `      <file href="${asset}"/>`).join('\n')
      : ''
    const dependencies = variant.dependencies
      ? [...new Set(page.images.map(({ asset }) => asset))]
          .map((asset) => `      <dependency identifierref="${resourceIdForAsset(asset)}"/>`)
          .join('\n')
      : ''
    const children = [files, dependencies].filter(Boolean).join('\n')
    return (
      `    <resource identifier="${page.id}" type="webcontent" href="${page.path}">\n` +
      `      <file href="${page.path}"/>\n` +
      (children ? `${children}\n` : '') +
      '    </resource>'
    )
  }).join('\n')

  const assetResources = variant.assetResourceType
    ? ASSETS.map(
        (asset) =>
          `    <resource identifier="${resourceIdForAsset(asset.path)}" ` +
          `type="${variant.assetResourceType}" href="${asset.path}">\n` +
          `      <file href="${asset.path}"/>\n` +
          '    </resource>',
      ).join('\n')
    : ''

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<manifest identifier="oer2canvas-image-probe"\n' +
    `  xmlns="${CC11_NS}"\n` +
    `  xmlns:lom="${CC11_LOM}"\n` +
    '  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
    '  <metadata>\n' +
    '    <schema>IMS Common Cartridge</schema>\n' +
    '    <schemaversion>1.1.0</schemaversion>\n' +
    '  </metadata>\n' +
    '  <organizations>\n' +
    '    <organization identifier="probe-organization" structure="rooted-hierarchy">\n' +
    '      <item identifier="probe-root">\n' +
    '        <title>oer2canvas embedded-image probes</title>\n' +
    `${organizationItems}\n` +
    '      </item>\n' +
    '    </organization>\n' +
    '  </organizations>\n' +
    '  <resources>\n' +
    '    <resource identifier="canvas-settings" type="associatedcontent/imscc_xmlv1p1/learning-application-resource" href="course_settings/canvas_export.txt">\n' +
    '      <file href="course_settings/module_meta.xml"/>\n' +
    '      <file href="course_settings/canvas_export.txt"/>\n' +
    '    </resource>\n' +
    `${pageResources}\n` +
    (assetResources ? `${assetResources}\n` : '') +
    '  </resources>\n' +
    '</manifest>\n'
  )
}

function entriesFor(variant) {
  return [
    { name: 'imsmanifest.xml', data: encoder.encode(manifestFor(variant)) },
    {
      name: 'course_settings/canvas_export.txt',
      data: encoder.encode('oer2canvas deterministic embedded-image probe\n'),
    },
    { name: 'course_settings/module_meta.xml', data: encoder.encode(moduleMeta()) },
    ...PAGES.map((page) => ({ name: page.path, data: encoder.encode(pageDocument(page)) })),
    ...ASSETS.map((asset) => ({ name: asset.path, data: asset.data })),
  ]
}

function assertXmlWellFormed(name, text) {
  try {
    execFileSync('xmllint', ['--noout', '-'], { input: text, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) {
    const detail = error.stderr?.toString().trim() || error.message
    throw new Error(`probe: ${name} is not well-formed XML: ${detail}`)
  }
}

function assertImageSignature(asset) {
  const b = asset.data
  const valid =
    (asset.mediaType === 'image/png' && b[0] === 0x89 && decoder.decode(b.slice(1, 4)) === 'PNG') ||
    (asset.mediaType === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8 && b.at(-2) === 0xff && b.at(-1) === 0xd9) ||
    (asset.mediaType === 'image/gif' && decoder.decode(b.slice(0, 6)).match(/^GIF8[79]a$/)) ||
    (asset.mediaType === 'image/webp' && decoder.decode(b.slice(0, 4)) === 'RIFF' && decoder.decode(b.slice(8, 12)) === 'WEBP')
  if (!valid) throw new Error(`probe: ${asset.path} does not match ${asset.mediaType}`)
}

export function validateProbeEntries(probe) {
  const names = probe.entries.map(({ name }) => name)
  const nameSet = new Set(names)
  if (nameSet.size !== names.length) throw new Error('probe: duplicate archive entry names')
  for (const name of names) {
    if (name.startsWith('/') || name.split('/').includes('..') || name.includes('\\')) {
      throw new Error(`probe: unsafe archive entry "${name}"`)
    }
  }
  const expectedNames = [
    'imsmanifest.xml',
    'course_settings/canvas_export.txt',
    'course_settings/module_meta.xml',
    ...PAGES.map(({ path }) => path),
    ...ASSETS.map(({ path }) => path),
  ]
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    const missing = expectedNames.find((name) => !nameSet.has(name))
    if (missing) throw new Error(`probe: missing archive entry ${missing}`)
    throw new Error('probe: archive entries or their deterministic order drifted')
  }

  const manifestEntry = probe.entries.find(({ name }) => name === 'imsmanifest.xml')
  const moduleEntry = probe.entries.find(({ name }) => name === 'course_settings/module_meta.xml')
  if (!manifestEntry || !moduleEntry) throw new Error('probe: missing required cartridge XML')
  const manifest = decoder.decode(manifestEntry.data)
  assertXmlWellFormed('imsmanifest.xml', manifest)
  assertXmlWellFormed('course_settings/module_meta.xml', decoder.decode(moduleEntry.data))

  const fileHrefs = [...manifest.matchAll(/<file href="([^"]+)"\/>/g)].map((match) => match[1])
  for (const href of fileHrefs) {
    if (!nameSet.has(href)) throw new Error(`probe: missing archive entry for manifest file href ${href}`)
  }
  for (const asset of ASSETS) {
    if (!fileHrefs.includes(asset.path)) {
      throw new Error(`probe: asset is not declared by the manifest: ${asset.path}`)
    }
    const entry = probe.entries.find(({ name }) => name === asset.path)
    assertImageSignature({ ...asset, data: entry.data })
  }

  const resourceIds = [...manifest.matchAll(/<resource identifier="([^"]+)"/g)].map((match) => match[1])
  if (new Set(resourceIds).size !== resourceIds.length) {
    throw new Error('probe: duplicate manifest resource identifiers')
  }
  const identifierRefs = [...manifest.matchAll(/identifierref="([^"]+)"/g)].map((match) => match[1])
  for (const identifierRef of identifierRefs) {
    if (!resourceIds.includes(identifierRef)) {
      throw new Error(`probe: dangling manifest identifierref: ${identifierRef}`)
    }
  }

  const pageEntries = probe.entries.filter(({ name }) => name.startsWith('wiki_content/'))
  const referencedAssets = new Set()
  for (const page of pageEntries) {
    const html = decoder.decode(page.data)
    const expectedPage = PAGES.find(({ path }) => path === page.name)
    const sources = [...html.matchAll(/<img [^>]*src="([^"]+)"/g)].map((match) => match[1])
    const expectedSources = expectedPage.images.map(({ asset }) => imageReference(asset))
    if (JSON.stringify(sources) !== JSON.stringify(expectedSources)) {
      throw new Error(`probe: ${page.name} image topology drifted`)
    }
    for (const src of sources) {
      const prefix = `${FILEBASE}/`
      if (!src.startsWith(prefix) || src.indexOf(FILEBASE, prefix.length) !== -1) {
        throw new Error(`probe: page has a non-canonical packaged-image reference: ${src}`)
      }
      const path = src.slice(prefix.length)
      if (!nameSet.has(path)) throw new Error(`probe: missing archive entry for image reference ${path}`)
      referencedAssets.add(path)
    }
  }
  for (const asset of ASSETS) {
    if (!referencedAssets.has(asset.path)) throw new Error(`probe: unreferenced asset ${asset.path}`)
  }

  const dependencyCount = (manifest.match(/<dependency /g) || []).length
  const assetResourceCount = resourceIds.filter((id) => id.startsWith('asset-')).length
  if (probe.variant.pageOwnedFiles) {
    if (dependencyCount !== 0 || assetResourceCount !== 0) {
      throw new Error('probe: page-owned-files variant contains standalone asset metadata')
    }
  } else {
    if (assetResourceCount !== ASSETS.length) {
      throw new Error(`probe: ${probe.variant.id} does not declare every standalone asset resource`)
    }
    if (probe.variant.dependencies !== (dependencyCount > 0)) {
      throw new Error(`probe: ${probe.variant.id} dependency shape drifted`)
    }
  }

  return { variant: probe.variant.id, pages: pageEntries.length, assets: ASSETS.length }
}

export async function buildCanvasImageProbes() {
  return Promise.all(
    PROBE_VARIANTS.map(async (variant) => {
      const probe = { variant, entries: entriesFor(variant) }
      validateProbeEntries(probe)
      return { ...probe, bytes: await writeZip(probe.entries) }
    }),
  )
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

function readGeneratedZip(bytes) {
  const archive = Buffer.from(bytes)
  const entries = []
  let offset = 0
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    if (offset + 30 > archive.length) throw new Error('probe: truncated local zip header')
    const flags = archive.readUInt16LE(offset + 6)
    const method = archive.readUInt16LE(offset + 8)
    const expectedCrc = archive.readUInt32LE(offset + 14)
    const compressedSize = archive.readUInt32LE(offset + 18)
    const rawSize = archive.readUInt32LE(offset + 22)
    const nameSize = archive.readUInt16LE(offset + 26)
    const extraSize = archive.readUInt16LE(offset + 28)
    if (flags !== 0 || (method !== 0 && method !== 8)) {
      throw new Error(`probe: unsupported zip flags or method at byte ${offset}`)
    }
    const nameStart = offset + 30
    const payloadStart = nameStart + nameSize + extraSize
    const payloadEnd = payloadStart + compressedSize
    if (payloadEnd > archive.length) throw new Error('probe: truncated zip payload')
    const name = archive.subarray(nameStart, nameStart + nameSize).toString('utf8')
    const payload = archive.subarray(payloadStart, payloadEnd)
    const data = Uint8Array.from(method === 8 ? inflateRawSync(payload) : payload)
    if (data.length !== rawSize || crc32(data) !== expectedCrc) {
      throw new Error(`probe: corrupt zip entry ${name}`)
    }
    entries.push({ name, data })
    offset = payloadEnd
  }
  if (entries.length === 0 || archive.readUInt32LE(offset) !== 0x02014b50) {
    throw new Error('probe: local zip entries do not lead to a central directory')
  }
  return entries
}

export async function generateCanvasImageProbes(outputDirectory) {
  const directory = resolve(outputDirectory)
  mkdirSync(directory, { recursive: true })
  const probes = await buildCanvasImageProbes()
  const generated = probes.map((probe) => {
    const filename = `oer2canvas-image-probe-${probe.variant.id}.imscc`
    writeFileSync(resolve(directory, filename), probe.bytes)
    return {
      id: probe.variant.id,
      description: probe.variant.description,
      filename,
      sha256: sha256(probe.bytes),
      pages: PAGES.length,
      assets: ASSETS.length,
    }
  })
  writeFileSync(
    resolve(directory, 'SHA256SUMS.txt'),
    `${generated.map((probe) => `${probe.sha256}  ${probe.filename}`).join('\n')}\n`,
  )
  writeFileSync(
    resolve(directory, 'probe-index.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        generator: 'scripts/canvas-image-probes.mjs',
        filebaseReference: `${FILEBASE}/web_resources/probe/<filename>`,
        probes: generated,
      },
      null,
      2,
    )}\n`,
  )
  validateCanvasImageProbeDirectory(directory)
  return generated
}

export function validateCanvasImageProbeDirectory(outputDirectory) {
  const directory = resolve(outputDirectory)
  const index = JSON.parse(readFileSync(resolve(directory, 'probe-index.json'), 'utf8'))
  if (index.schemaVersion !== 1 || !Array.isArray(index.probes)) {
    throw new Error('probe: unsupported or malformed probe-index.json')
  }
  const checksumLines = readFileSync(resolve(directory, 'SHA256SUMS.txt'), 'utf8')
    .trim()
    .split('\n')
  const expectedChecksums = new Map(
    checksumLines.map((line) => {
      const match = line.match(/^([a-f0-9]{64})  ([^/]+\.imscc)$/)
      if (!match) throw new Error(`probe: malformed checksum line: ${line}`)
      return [match[2], match[1]]
    }),
  )
  if (index.probes.length !== PROBE_VARIANTS.length) {
    throw new Error(`probe: expected ${PROBE_VARIANTS.length} cartridges, found ${index.probes.length}`)
  }

  return index.probes.map((probe, position) => {
    const variant = PROBE_VARIANTS[position]
    if (probe.id !== variant.id) throw new Error('probe: variant order or id drifted')
    const expectedFilename = `oer2canvas-image-probe-${variant.id}.imscc`
    if (probe.filename !== expectedFilename) throw new Error(`probe: unexpected filename ${probe.filename}`)
    const path = resolve(directory, probe.filename)
    const bytes = readFileSync(path)
    const actualSha256 = sha256(bytes)
    if (probe.sha256 !== actualSha256 || expectedChecksums.get(probe.filename) !== actualSha256) {
      throw new Error(`probe: checksum mismatch for ${probe.filename}`)
    }
    execFileSync('unzip', ['-t', path], { stdio: ['ignore', 'pipe', 'pipe'] })
    const externalEntries = execFileSync('unzip', ['-Z1', path], { encoding: 'utf8' }).trim().split('\n')
    if (!externalEntries.includes('imsmanifest.xml') || !externalEntries.includes('course_settings/module_meta.xml')) {
      throw new Error(`probe: ${probe.filename} is missing required cartridge entries`)
    }
    const entries = readGeneratedZip(bytes)
    if (JSON.stringify(entries.map(({ name }) => name)) !== JSON.stringify(externalEntries)) {
      throw new Error(`probe: zip directory and local entries disagree for ${probe.filename}`)
    }
    validateProbeEntries({ variant, entries })
    return probe
  })
}

async function main() {
  const validating = process.argv[2] === '--validate'
  const outputDirectory = validating
    ? process.argv[3] || 'artifacts/canvas-image-probes'
    : process.argv[2] || 'artifacts/canvas-image-probes'
  const probes = validating
    ? validateCanvasImageProbeDirectory(outputDirectory)
    : await generateCanvasImageProbes(outputDirectory)
  console.log(`${validating ? 'Validated' : 'Generated and validated'} ${probes.length} Canvas image probes in ${resolve(outputDirectory)}`)
  for (const probe of probes) console.log(`${probe.sha256}  ${probe.filename}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
