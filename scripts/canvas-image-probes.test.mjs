import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PROBE_VARIANTS,
  buildCanvasImageProbes,
  generateCanvasImageProbes,
  validateCanvasImageProbeDirectory,
  validateProbeEntries,
} from './canvas-image-probes.mjs'

const decode = (entry) => new TextDecoder().decode(entry.data)
const entryNamed = (probe, name) => probe.entries.find((entry) => entry.name === name)
let probes

beforeAll(async () => {
  probes = await buildCanvasImageProbes()
})

test('probe variants isolate the candidate manifest layouts behind identical image references', async () => {
  expect(PROBE_VARIANTS.map(({ id }) => id)).toEqual([
    'standalone-webcontent',
    'webcontent-dependencies',
    'page-owned-files',
    'associatedcontent-dependencies',
  ])

  expect(probes).toHaveLength(PROBE_VARIANTS.length)

  const pageBodies = probes.map((probe) =>
    probe.entries
      .filter(({ name }) => name.startsWith('wiki_content/'))
      .map(decode),
  )
  for (const pages of pageBodies.slice(1)) expect(pages).toEqual(pageBodies[0])

  for (const pages of pageBodies) {
    expect(pages.join('\n')).toContain('$IMS-CC-FILEBASE$/web_resources/probe/single.png')
    expect(pages.join('\n')).not.toContain('http://')
    expect(pages.join('\n')).not.toContain('https://')
  }
})

test('fixtures cover one image, sharing, duplicate bytes, and all candidate raster types', async () => {
  const [probe] = probes
  const pages = probe.entries.filter(({ name }) => name.startsWith('wiki_content/'))
  expect(pages.map(({ name }) => name)).toEqual([
    'wiki_content/01-single-image.html',
    'wiki_content/02-shared-image-a.html',
    'wiki_content/03-shared-image-b.html',
    'wiki_content/04-raster-and-duplicates.html',
  ])

  const sharedPath = 'web_resources/probe/shared.gif'
  expect(pages.filter((page) => decode(page).includes(sharedPath))).toHaveLength(2)
  expect(entryNamed(probe, sharedPath)).toBeDefined()

  const duplicateA = entryNamed(probe, 'web_resources/probe/duplicate-a.png').data
  const duplicateB = entryNamed(probe, 'web_resources/probe/duplicate-b.png').data
  expect(Array.from(duplicateA)).toEqual(Array.from(duplicateB))

  for (const extension of ['png', 'jpg', 'gif', 'webp']) {
    expect(probe.entries.some(({ name }) => name.endsWith(`.${extension}`))).toBe(true)
  }
})

test('every probe is structurally valid and byte-deterministic', async () => {
  const expectedHashes = [
    '8dfbea00c0bd80f7699e594aa8824eab0c4c00c9fa07739e281ed235b4e0bfd1',
    'a48533090eb003b3621694170bc45f3890e7ab69423d1d3f348bdd666f847d21',
    'cc3aa03bc96a37432846ae7ddf2c8d759be054e6ec163dd0fcb642b1234e2ff3',
    'b9854b5752d7380cffcefc4412c368f70992a14d43c3ea88d6023be717701917',
  ]
  const first = probes
  const second = await buildCanvasImageProbes()

  for (let index = 0; index < first.length; index += 1) {
    const one = first[index]
    const two = second[index]
    expect(validateProbeEntries(one)).toMatchObject({
      variant: one.variant.id,
      pages: 4,
      assets: 7,
    })
    expect(Array.from(one.bytes)).toEqual(Array.from(two.bytes))
  }

  expect(first.map(({ bytes }) => createHash('sha256').update(bytes).digest('hex'))).toEqual(expectedHashes)
})

test('the generator writes reproducible cartridges, an index, and verifiable checksums', async () => {
  const output = mkdtempSync(join(tmpdir(), 'canvas-image-probes-'))
  const generated = await generateCanvasImageProbes(output)

  expect(generated.map(({ filename }) => filename)).toEqual(
    PROBE_VARIANTS.map(({ id }) => `oer2canvas-image-probe-${id}.imscc`),
  )
  expect(execFileSync('unzip', ['-t', join(output, generated[0].filename)], { encoding: 'utf8' }))
    .toContain('No errors detected')

  const checksums = readFileSync(join(output, 'SHA256SUMS.txt'), 'utf8')
  for (const probe of generated) {
    expect(checksums).toContain(`${probe.sha256}  ${probe.filename}`)
  }

  const index = JSON.parse(readFileSync(join(output, 'probe-index.json'), 'utf8'))
  expect(index.schemaVersion).toBe(1)
  expect(index.probes).toHaveLength(4)
  expect(validateCanvasImageProbeDirectory(output).map(({ sha256 }) => sha256))
    .toEqual(generated.map(({ sha256 }) => sha256))
}, 15_000)

test('structural validation refuses dangling packaged-image references', async () => {
  const [probe] = probes
  const broken = {
    ...probe,
    entries: probe.entries.filter(({ name }) => name !== 'web_resources/probe/single.png'),
  }
  expect(() => validateProbeEntries(broken)).toThrow(/missing archive entry.*single\.png/i)
})
